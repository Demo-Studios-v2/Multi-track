import _defaults from "lodash.defaultsdeep";

import InlineWorker from "inline-worker";
import diff from "virtual-dom/diff";
import h from "virtual-dom/h";
import patch from "virtual-dom/patch";
import { AudioReader } from "./utils/audioReader";

import Playout from "./Playout";
import TimeScale from "./TimeScale";
import Track from "./Track";
import AnnotationList from "./annotation/AnnotationList";
import ScrollHook from "./render/ScrollHook";
import LoaderFactory from "./track/loader/LoaderFactory";
import { resampleAudioBuffer } from "./utils/audioData";
import { pixelsToSeconds } from "./utils/conversions";

import ExportWavWorkerFunction from "./utils/exportWavWorker";
import RecorderWorkerFunction from "./utils/recorderWorker";
export default class {
  constructor() {
    this.renderInterval = undefined;
    this.intervalCounter = 0;
    this.totalTracks = 0;
    this.initMutedTracks = [];
    this.initSoloTracks = [];
    this.tracks = [];
    this.soloedTracks = [];
    this.mutedTracks = [];
    this.collapsedTracks = [];
    this.playoutPromises = [];

    this.cursor = 0;
    this.playbackSeconds = 0;
    this.duration = 0;
    this.scrollLeft = 0;
    this.scrollTimer = undefined;
    this.showTimescale = false;
    // whether a user is scrolling the waveform
    this.isScrolling = false;

    this.fadeType = "logarithmic";
    this.masterGain = 1;
    this.annotations = [];
    this.durationFormat = "hh:mm:ss.uuu";
    this.isAutomaticScroll = false;
    this.resetDrawTimer = undefined;
  }

  // TODO extract into a plugin
  initExporter() {
    this.exportWorker = new InlineWorker(ExportWavWorkerFunction);
  }

  // TODO extract into a plugin
  initRecorder(stream) {
    this.mediaRecorder = new MediaRecorder(stream);

    this.mediaRecorder.onstart = () => {
      const track = new Track();
      track.id = this.recordId;
      track.setName("Recording");
      track.setEnabledStates();
      track.setEventEmitter(this.ee);
      track.setStartTime(this.getCurrentTime());
      this.recordingTrack = track;
      this.tracks.push(track);
      this.recordingBlob = null;
      this.chunks = [];
      this.working = false;
    };

    this.mediaRecorder.ondataavailable = (e) => {
      this.chunks.push(e.data);

      // throttle peaks calculation
      if (!this.working) {
        const recording = new Blob(this.chunks, {
          type: "audio/ogg; codecs=opus",
        });
        this.recordingBlob = recording;
        const loader = LoaderFactory.createLoader(recording, this.ac);
        loader
          .load()
          .then((audioBuffer) => {
            // ask web worker for peaks.
            this.recorderWorker.postMessage({
              samples: audioBuffer.getChannelData(0),
              samplesPerPixel: this.samplesPerPixel,
            });
            this.recordingTrack.setCues(0, audioBuffer.duration);
            this.recordingTrack.setBuffer(audioBuffer);
            this.recordingTrack.setPlayout(
              new Playout(this.ac, audioBuffer, this.masterGainNode)
            );
            this.adjustDuration();
          })
          .catch(() => {
            this.working = false;
          });
        this.working = true;
      }
    };

    this.mediaRecorder.onstop = () => {
      this.chunks = [];
      this.working = false;
    };

    this.recorderWorker = new InlineWorker(RecorderWorkerFunction);
    // use a worker for calculating recording peaks.
    this.recorderWorker.onmessage = (e) => {
      this.recordingTrack.setPeaks(e.data);
      this.working = false;
      this.drawRequest();
    };
  }

  setShowTimeScale(show) {
    this.showTimescale = show;
  }

  setMono(mono) {
    this.mono = mono;
  }

  setExclSolo(exclSolo) {
    this.exclSolo = exclSolo;
  }

  setSeekStyle(style) {
    this.seekStyle = style;
  }

  getSeekStyle() {
    return this.seekStyle;
  }

  setSampleRate(sampleRate) {
    this.sampleRate = sampleRate;
  }

  setSamplesPerPixel(samplesPerPixel) {
    this.samplesPerPixel = samplesPerPixel;
  }

  setAudioContext(ac) {
    this.ac = ac;
    this.masterGainNode = ac.createGain();
  }

  getAudioContext() {
    return this.ac;
  }

  async decodeAudioBuffer(buffer, usePolyfillReader) {
    return new Promise((resolve, reject) => {
      if (usePolyfillReader) {
        AudioReader(buffer, this.ac).then(({ buffer }) => {
          resolve(buffer);
        });
      } else {
        this.ac.decodeAudioData(
          buffer,
          (audioBuffer) => {
            resolve(audioBuffer);
          },
          (err) => {
            if (err === null) {
              // Safari issues with null error
              reject(Error("MediaDecodeAudioDataUnknownContentType"));
            } else {
              reject(err);
            }
          }
        );
      }
    });
  }
  setControlOptions(controlOptions) {
    this.controls = controlOptions;
  }

  setWaveHeight(height) {
    this.waveHeight = height;
  }

  setCollapsedWaveHeight(height) {
    this.collapsedWaveHeight = height;
  }

  setColors(colors) {
    this.colors = colors;
  }

  setBarWidth(width) {
    this.barWidth = width;
  }

  setBarGap(width) {
    this.barGap = width;
  }

  setAnnotations(config) {
    const controlWidth = this.controls.show ? this.controls.width : 0;
    this.annotationList = new AnnotationList(
      this,
      config.annotations,
      config.controls,
      config.editable,
      config.linkEndpoints,
      config.isContinuousPlay,
      controlWidth
    );
  }
  setEffects(effectsGraph) {
    this.effectsGraph = effectsGraph;
  }

  setEventEmitter(ee) {
    this.ee = ee;
  }

  getEventEmitter() {
    return this.ee;
  }

  setUpEventEmitter() {
    const ee = this.ee;

    ee.on("automaticscroll", (val) => {
      this.isAutomaticScroll = val;
    });

    ee.on("durationformat", (format) => {
      this.durationFormat = format;
      this.drawRequest();
    });

    ee.on("select", (start, end, track) => {
      if (this.isPlaying()) {
        this.lastSeeked = start;
        this.pausedAt = undefined;
        this.restartPlayFrom(start);
      } else {
        // reset if it was paused.
        this.seek(start, end, track);
        this.ee.emit("timeupdate", start);
        this.drawRequest();
      }
    });

    ee.on("startaudiorendering", (type) => {
      this.startOfflineRender(type);
    });

    ee.on("statechange", (state) => {
      this.setState(state);
      this.drawRequest();
    });

    ee.on("shift", (deltaTime, track) => {
      track.setStartTime(track.getStartTime() + deltaTime);
      this.adjustDuration();
      this.drawRequest();
    });

    ee.on("record", () => {
      this.record();
    });

    ee.on("play", (start, end) => {
      this.play(start, end);
    });

    ee.on("pause", () => {
      this.pause();
    });

    ee.on("stop", () => {
      this.stop();
    });

    ee.on("rewind", () => {
      this.rewind();
    });

    ee.on("fastforward", () => {
      this.fastForward();
    });

    ee.on("clear", () => {
      this.clear().then(() => {
        this.drawRequest();
      });
    });

    ee.on("solo", (trackObj) => {
      const track = trackObj.track;
      const index = trackObj.index;
      this.soloTrack(track, index);
      if (track) {
        this.adjustTrackPlayout();
        this.drawRequest();
      }
    });

    ee.on("mute", (trackObj) => {
      const track = trackObj.track;
      const index = trackObj.index;
      this.muteTrack(track, index);
      if (track) {
        this.adjustTrackPlayout();
        this.drawRequest();
      }
    });

    ee.on("removeTrack", (track) => {
      this.removeTrack(track);
      this.adjustTrackPlayout();
      this.drawRequest();
    });

    ee.on("changeTrackView", (track, opts) => {
      this.collapseTrack(track, opts);
      this.drawRequest();
    });

    ee.on("volumechange", (volume, track) => {
      track.setGainLevel(volume / 100);
      this.drawRequest();
    });

    ee.on("mastervolumechange", (volume) => {
      this.masterGain = volume / 100;
      this.tracks.forEach((track) => {
        track.setMasterGainLevel(this.masterGain);
      });
    });

    ee.on("fadein", (duration, track) => {
      track.setFadeIn(duration, this.fadeType);
      this.drawRequest();
    });

    ee.on("fadeout", (duration, track) => {
      track.setFadeOut(duration, this.fadeType);
      this.drawRequest();
    });

    ee.on("stereopan", (panvalue, track) => {
      track.setStereoPanValue(panvalue);
      this.drawRequest();
    });

    ee.on("fadetype", (type) => {
      this.fadeType = type;
    });

    ee.on("newtrack", (file) => {
      this.load([
        {
          src: file,
          name: file.name,
        },
      ]);
    });

    ee.on("trim", () => {
      const track = this.getActiveTrack();
      const timeSelection = this.getTimeSelection();

      track.trim(timeSelection.start, timeSelection.end);
      track.calculatePeaks(this.samplesPerPixel, this.sampleRate);

      this.setTimeSelection(0, 0);
      this.adjustDuration();
      this.drawRequest();
    });

    ee.on("zoomin", () => {
      const zoomIndex = Math.max(0, this.zoomIndex - 1);
      const zoom = this.zoomLevels[zoomIndex];

      if (zoom !== this.samplesPerPixel) {
        this.setZoom(zoom);
        this.drawRequest();
      }
    });

    ee.on("zoomout", () => {
      const zoomIndex = Math.min(
        this.zoomLevels.length - 1,
        this.zoomIndex + 1
      );
      const zoom = this.zoomLevels[zoomIndex];

      if (zoom !== this.samplesPerPixel) {
        this.setZoom(zoom);
        this.drawRequest();
      }
    });

    ee.on("scroll", () => {
      this.isScrolling = true;
      this.drawRequest();
      clearTimeout(this.scrollTimer);
      this.scrollTimer = setTimeout(() => {
        this.isScrolling = false;
      }, 200);
    });
  }

  load(trackList, handleProgress = () => {}, handleIsRendered = () => {}) {
    if (!this.renderInterval) {
      this.renderInterval = setInterval(() => {
        this.intervalCounter += 1;
        this.drawRequest();
        if (this.totalTracks <= this.tracks.filter((t) => t).length) {
          clearInterval(this.renderInterval);
          this.renderInterval = undefined;
        }
      }, 250);
    }
    const initialLength = this.totalTracks;
    this.totalTracks = initialLength + trackList.length;
    const loadPromises = trackList.map((trackInfo, i) => {
      const loader = LoaderFactory.createLoader(
        trackInfo.src,
        this.ac,
        this.ee,
        trackInfo.usePolyfillReader
      );
      return loader
        .load(handleProgress)
        .then((audioBuffer) => {
          if (audioBuffer.sampleRate === this.sampleRate) {
            return audioBuffer;
          } else {
            return resampleAudioBuffer(audioBuffer, this.sampleRate);
          }
        })
        .then((audioBuffer) => {
          const info = trackInfo;
          const id = info.trackId || "";
          const name = info.name || "Untitled";
          const start = info.start || 0;
          const states = info.states || {};
          const fadeIn = info.fadeIn;
          const fadeOut = info.fadeOut;
          const cueIn = info.cuein || 0;
          const cueOut = info.cueout || audioBuffer.duration;
          const gain = info.gain || 1;
          const muted = info.muted || this.initMutedTracks[i] || false;
          const soloed = info.soloed || this.initSoloTracks[i] || false;
          const selection = info.selected;
          const peaks = info.peaks || { type: "WebAudio", mono: this.mono };
          const customClass = info.customClass || undefined;
          const waveOutlineColor = info.waveOutlineColor || undefined;
          const stereoPan = info.stereoPan || 0;
          const effects = info.effects || null;

          // webaudio specific playout for now.
          const playout = new Playout(
            this.ac,
            audioBuffer,
            this.masterGainNode
          );

          const track = new Track();
          track.src = info.src;
          track.setBuffer(audioBuffer);
          track.setName(name);
          track.setEventEmitter(this.ee);
          track.setEnabledStates(states);
          track.setCues(cueIn, cueOut);
          track.setCustomClass(customClass);
          track.setWaveOutlineColor(waveOutlineColor);
          track.setId(id);
          if (fadeIn !== undefined) {
            track.setFadeIn(fadeIn.duration, fadeIn.shape);
          }

          if (fadeOut !== undefined) {
            track.setFadeOut(fadeOut.duration, fadeOut.shape);
          }

          if (selection !== undefined) {
            this.setActiveTrack(track);
            this.setTimeSelection(selection.start, selection.end);
          }

          if (peaks !== undefined) {
            track.setPeakData(peaks);
          }

          track.setState(this.getState());
          track.setStartTime(start);
          track.setPlayout(playout);

          track.setGainLevel(gain);
          track.setStereoPanValue(stereoPan);
          if (effects) {
            track.setEffects(effects);
          }

          if (muted) {
            this.muteTrack(track);
          }

          if (soloed) {
            this.soloTrack(track);
          }
          track.calculatePeaksPerZoom(this.zoomLevels, this.sampleRate);
          // extract peaks with AudioContext for now.
          track.calculatePeaks(this.samplesPerPixel, this.sampleRate);
          this.tracks[i + initialLength] = track;
          this.adjustDuration();
          // this.drawRequest();

          return track;
        });
    });
    handleIsRendered();
    this.ee.emit("audiosourcesrendered");
    return Promise.resolve();
  }

  /*
    track instance of Track.
  */
  setActiveTrack(track) {
    this.activeTrack = track;
  }

  getActiveTrack() {
    return this.activeTrack;
  }

  isSegmentSelection() {
    return this.timeSelection.start !== this.timeSelection.end;
  }

  /*
    start, end in seconds.
  */
  setTimeSelection(start = 0, end) {
    this.timeSelection = {
      start,
      end: end === undefined ? start : end,
    };

    this.cursor = start;
  }

  async startOfflineRender(type) {
    if (this.isRendering) {
      return;
    }

    this.isRendering = true;
    this.offlineAudioContext = new (window.OfflineAudioContext ||
      window.webkitOfflineAudioContext)(2, 44100 * this.duration, 44100);

    const setUpChain = [];

    this.ee.emit(
      "audiorenderingstarting",
      this.offlineAudioContext,
      setUpChain
    );

    const currentTime = this.offlineAudioContext.currentTime;
    const mg = this.offlineAudioContext.createGain();

    this.tracks.forEach((track) => {
      const playout = new Playout(this.offlineAudioContext, track.buffer, mg);
      playout.setEffects(track.effectsGraph);
      playout.setMasterEffects(this.effectsGraph);
      track.setOfflinePlayout(playout);

      track.schedulePlay(currentTime, 0, 0, {
        shouldPlay: this.shouldTrackPlay(track),
        masterGain: 1,
        isOffline: true,
      });
    });

    /*
      TODO cleanup of different audio playouts handling.
    */
    await Promise.all(setUpChain);
    const audioBuffer = await this.offlineAudioContext.startRendering();

    if (type === "buffer") {
      this.ee.emit("audiorenderingfinished", type, audioBuffer);
      this.isRendering = false;
    } else if (type === "wav") {
      this.exportWorker.postMessage({
        command: "init",
        config: {
          sampleRate: 44100,
        },
      });

      // callback for `exportWAV`
      this.exportWorker.onmessage = (e) => {
        this.ee.emit("audiorenderingfinished", type, e.data);
        this.isRendering = false;

        // clear out the buffer for next renderings.
        this.exportWorker.postMessage({
          command: "clear",
        });
      };

      // send the channel data from our buffer to the worker
      this.exportWorker.postMessage({
        command: "record",
        buffer: [audioBuffer.getChannelData(0), audioBuffer.getChannelData(1)],
      });

      // ask the worker for a WAV
      this.exportWorker.postMessage({
        command: "exportWAV",
        type: "audio/wav",
      });
    }
  }

  getTimeSelection() {
    return this.timeSelection;
  }

  setState(state) {
    this.state = state;

    this.tracks.forEach((track) => {
      track.setState(state);
    });
  }

  getState() {
    return this.state;
  }

  setZoomIndex(index) {
    this.zoomIndex = index;
  }

  setZoomLevels(levels) {
    this.zoomLevels = levels;
  }

  setZoom(zoom) {
    this.samplesPerPixel = zoom;
    this.zoomIndex = this.zoomLevels.indexOf(zoom);
    this.tracks.forEach((track) => {
      track.calculatePeaks(zoom, this.sampleRate);
    });
  }

  muteTrack(track, trackIndex) {
    if (track) {
      const index = this.mutedTracks.indexOf(track);
      if (index > -1) {
        this.mutedTracks.splice(index, 1);
      } else {
        this.mutedTracks.push(track);
      }
    } else {
      this.initMutedTracks[trackIndex] = !this.initMutedTracks[trackIndex];
    }
  }

  soloTrack(track, trackIndex) {
    if (track) {
      const index = this.soloedTracks.indexOf(track);

      if (index > -1) {
        this.soloedTracks.splice(index, 1);
      } else if (this.exclSolo) {
        this.soloedTracks = [track];
      } else {
        this.soloedTracks.push(track);
      }
    } else {
      this.initSoloTracks[trackIndex] = !this.initSoloTracks[trackIndex];
    }
  }

  collapseTrack(track, opts) {
    if (opts.collapsed) {
      this.collapsedTracks.push(track);
    } else {
      const index = this.collapsedTracks.indexOf(track);

      if (index > -1) {
        this.collapsedTracks.splice(index, 1);
      }
    }
  }

  removeTrack(track) {
    if (track.isPlaying()) {
      track.scheduleStop();
    }

    const trackLists = [
      this.mutedTracks,
      this.soloedTracks,
      this.collapsedTracks,
      this.tracks,
    ];
    let trackFound = false;
    trackLists.forEach((list) => {
      const index = list.indexOf(track);
      if (index > -1) {
        list.splice(index, 1);
        trackFound = true;
      }
    });
    if (trackFound && this.totalTracks) {
      this.totalTracks--;
    }
    this.adjustDuration();
  }

  adjustTrackPlayout() {
    this.tracks.forEach((track) => {
      track.setShouldPlay(this.shouldTrackPlay(track));
    });
  }

  adjustDuration() {
    this.duration = this.tracks.reduce(
      (duration, track) => Math.max(duration, track.getEndTime()),
      0
    );
  }

  shouldTrackPlay(track) {
    let shouldPlay;
    // if there are solo tracks, only they should play.
    if (this.soloedTracks.length > 0) {
      shouldPlay = false;
      if (this.soloedTracks.indexOf(track) > -1) {
        shouldPlay = true;
      }
    } else {
      // play all tracks except any muted tracks.
      shouldPlay = true;
      if (this.mutedTracks.indexOf(track) > -1) {
        shouldPlay = false;
      }
    }

    return shouldPlay;
  }

  isPlaying() {
    return this.tracks.reduce(
      (isPlaying, track) => isPlaying || track.isPlaying(),
      false
    );
  }

  /*
   *   returns the current point of time in the playlist in seconds.
   */
  getCurrentTime() {
    const cursorPos = this.lastSeeked || this.pausedAt || this.cursor;

    return cursorPos + this.getElapsedTime();
  }

  getElapsedTime() {
    return (this.ac.currentTime || 0) - (this.lastPlay || 0);
  }

  setMasterGain(gain) {
    this.ee.emit("mastervolumechange", gain);
  }

  restartPlayFrom(start, end) {
    this.stopAnimation();

    this.tracks.forEach((editor) => {
      editor.scheduleStop();
    });

    return Promise.all(this.playoutPromises).then(
      this.play.bind(this, start, end)
    );
  }

  play(startTime, endTime) {
    clearTimeout(this.resetDrawTimer);

    const currentTime = this.ac.currentTime;
    const selected = this.getTimeSelection();
    const playoutPromises = [];

    const start =
      startTime === 0 ? 0 : startTime || this.pausedAt || this.cursor;
    let end = endTime;

    if (!end && selected.end !== selected.start && selected.end > start) {
      end = selected.end;
    }

    if (this.isPlaying()) {
      return this.restartPlayFrom(start, end);
    }

    // TODO refector this in upcoming modernisation.
    if (this.effectsGraph)
      this.tracks && this.tracks[0].playout.setMasterEffects(this.effectsGraph);

    this.tracks.forEach((track) => {
      track.setState("cursor");
      playoutPromises.push(
        track.schedulePlay(currentTime, start, end, {
          shouldPlay: this.shouldTrackPlay(track),
          masterGain: this.masterGain,
        })
      );
    });

    this.lastPlay = currentTime;
    // use these to track when the playlist has fully stopped.
    this.playoutPromises = playoutPromises;
    this.startAnimation(start);

    return Promise.all(this.playoutPromises);
  }

  pause() {
    if (!this.isPlaying()) {
      return Promise.all(this.playoutPromises);
    }

    this.pausedAt = this.getCurrentTime();
    return this.playbackReset();
  }

  stopRecording() {
    if (this.mediaRecorder && this.mediaRecorder.state === "recording") {
      this.mediaRecorder.stop();
    }
  }

  stop() {
    if (this.mediaRecorder && this.mediaRecorder.state === "recording") {
      this.mediaRecorder.stop();
    }

    this.pausedAt = undefined;
    this.playbackSeconds = 0;
    return this.playbackReset();
  }

  playbackReset() {
    this.lastSeeked = undefined;
    this.stopAnimation();

    this.tracks.forEach((track) => {
      track.scheduleStop();
      track.setState(this.getState());
    });

    // TODO improve this.
    //this.masterGainNode.disconnect();
    this.drawRequest();
    return Promise.all(this.playoutPromises);
  }

  rewind() {
    return this.stop().then(() => {
      this.scrollLeft = 0;
      this.ee.emit("select", 0, 0);
    });
  }

  fastForward() {
    return this.stop().then(() => {
      if (this.viewDuration < this.duration) {
        this.scrollLeft = this.duration - this.viewDuration;
      } else {
        this.scrollLeft = 0;
      }

      this.ee.emit("select", this.duration, this.duration);
    });
  }

  clear() {
    return this.stop().then(() => {
      this.tracks = [];
      this.soloedTracks = [];
      this.mutedTracks = [];
      this.playoutPromises = [];

      this.cursor = 0;
      this.playbackSeconds = 0;
      this.duration = 0;
      this.scrollLeft = 0;

      this.seek(0, 0, undefined);
    });
  }

  record(id) {
    this.recordId = id;
    const playoutPromises = [];
    this.mediaRecorder.start(300);

    // this.tracks.forEach((track) => {
    //   track.setState("none");
    //   playoutPromises.push(
    //     track.schedulePlay(this.ac.currentTime, 0, undefined, {
    //       shouldPlay: this.shouldTrackPlay(track),
    //     })
    //   );
    // });

    // this.playoutPromises = playoutPromises;
  }

  startAnimation(startTime) {
    this.lastDraw = this.ac.currentTime;
    this.animationRequest = window.requestAnimationFrame(() => {
      this.updateEditor(startTime);
    });
  }

  stopAnimation() {
    window.cancelAnimationFrame(this.animationRequest);
    this.lastDraw = undefined;
  }

  seek(start, end, track) {
    if (this.isPlaying()) {
      this.lastSeeked = start;
      this.pausedAt = undefined;
      this.restartPlayFrom(start);
    } else {
      // reset if it was paused.
      this.setActiveTrack(track || this.tracks[0]);
      this.pausedAt = start;
      this.setTimeSelection(start, end);
      if (this.getSeekStyle() === "fill") {
        this.playbackSeconds = start;
      }
    }
  }

  /*
   * Animation function for the playlist.
   * Keep under 16.7 milliseconds based on a typical screen refresh rate of 60fps.
   */
  updateEditor(cursor) {
    const currentTime = this.ac.currentTime;
    const selection = this.getTimeSelection();
    const cursorPos = cursor || this.cursor;
    const elapsed = currentTime - this.lastDraw;

    if (this.isPlaying()) {
      const playbackSeconds = cursorPos + elapsed;
      this.ee.emit("timeupdate", playbackSeconds, true);
      this.animationRequest = window.requestAnimationFrame(() => {
        this.updateEditor(playbackSeconds);
      });

      this.playbackSeconds = playbackSeconds;
      this.draw(this.render());
      this.lastDraw = currentTime;
    } else {
      if (
        cursorPos + elapsed >=
        (this.isSegmentSelection() ? selection.end : this.duration)
      ) {
        this.ee.emit("finished");
      }

      this.stopAnimation();

      this.resetDrawTimer = setTimeout(() => {
        this.pausedAt = undefined;
        this.lastSeeked = undefined;
        this.setState(this.getState());

        this.playbackSeconds = 0;
        this.draw(this.render());
      }, 0);
    }
  }

  drawRequest() {
    window.requestAnimationFrame(() => {
      this.draw(this.render());
    });
  }

  draw(newTree) {
    const patches = diff(this.tree, newTree);
    this.rootNode = patch(this.rootNode, patches);
    this.tree = newTree;

    // use for fast forwarding.
    this.viewDuration = pixelsToSeconds(
      this.rootNode.clientWidth - this.controls.width,
      this.samplesPerPixel,
      this.sampleRate
    );
  }

  getTrackRenderData(data = {}) {
    const defaults = {
      height: this.waveHeight,
      resolution: this.samplesPerPixel,
      sampleRate: this.sampleRate,
      controls: this.controls,
      isActive: false,
      timeSelection: this.getTimeSelection(),
      playlistLength: this.duration,
      playbackSeconds: this.isPlaying() ? this.playbackSeconds : this.pausedAt,
      colors: this.colors,
      barWidth: this.barWidth,
      barGap: this.barGap,
    };

    return _defaults({}, data, defaults);
  }

  isActiveTrack(track) {
    const activeTrack = this.getActiveTrack();

    if (this.isSegmentSelection()) {
      return activeTrack === track;
    }

    return true;
  }

  renderAnnotations() {
    return this.annotationList.render();
  }

  renderTimeScale() {
    const controlWidth = this.controls.show ? this.controls.width : 0;
    const timeScale = new TimeScale(
      this.duration,
      this.scrollLeft,
      this.samplesPerPixel,
      this.sampleRate,
      controlWidth,
      this.colors
    );

    return timeScale.render();
  }
  renderTrackLoader() {
    return h(
      "div",
      {
        style: `margin-left: ${15}px;height: ${
          this.waveHeight
        }px;display: flex; align-items: center; gap: 7px`,
      },
      [
        h("div", {
          style: ` width: 3px;height: ${
            this.waveHeight / 6
          }px;background: white;opacity: 0.8;border-radius: 27%;visibility: ${
            this.intervalCounter % 3 === 0 ? "visible" : "hidden"
          }`,
        }),
        h("div", {
          style: ` width: 3px;height: ${
            this.waveHeight / 4
          }px;background: white;opacity: 0.8;border-radius: 27%;visibility: ${
            this.intervalCounter % 3 === 1 ? "visible" : "hidden"
          }`,
        }),
        h("div", {
          style: ` width: 3px;height: ${
            this.waveHeight / 2
          }px;background:white;opacity: 0.8;border-radius: 27%;visibility: ${
            this.intervalCounter % 3 === 2 ? "visible" : "hidden"
          }`,
        }),
        // h("div", {
        //   style: ` width: 2px;height: ${
        //     (Math.random() * this.waveHeight) / 2
        //   }px;background: white;opacity: 0.8;border-radius: 25%;`,
        // }),
        // h("div", {
        //   style: ` width: 2px;height: ${
        //     (Math.random() * this.waveHeight) / 2
        //   }px;background: white;opacity: 0.8;border-radius: 25%`,
        // }),
        // h("div", {
        //   style: ` width: 2px;height: ${
        //     (Math.random() * this.waveHeight) / 2
        //   }px;background:white;opacity: 0.8;border-radius: 25%`,
        // }),
        // h(
        //   "div",
        //   {
        //     style: `margin-left: ${5}px;height: 100%;color: white;align-content: center;font-size: 100%;`,
        //   },
        //   ["Stem Loading"]
        // ),
      ]
    );
  }
  renderTrackSection() {
    const trackElements = [];
    for (let i = 0; i < this.tracks.length; i++) {
      const track = this.tracks[i];
      if (track) {
        const collapsed = this.collapsedTracks.indexOf(track) > -1;
        trackElements.push(
          track.render(
            this.getTrackRenderData({
              isActive: this.isActiveTrack(track),
              shouldPlay: this.shouldTrackPlay(track),
              soloed: this.soloedTracks.indexOf(track) > -1,
              muted: this.mutedTracks.indexOf(track) > -1,
              collapsed,
              height: collapsed ? this.collapsedWaveHeight : this.waveHeight,
              barGap: this.barGap,
              barWidth: this.barWidth,
            })
          )
        );
      } else {
        trackElements.push(this.renderTrackLoader());
      }
    }
    for (let i = trackElements.length; i < this.totalTracks; i++) {
      trackElements.push(this.renderTrackLoader());
    }

    return h(
      "div.playlist-tracks",
      {
        attributes: {
          style: "",
        },
        onscroll: (e) => {
          this.scrollLeft = pixelsToSeconds(
            e.target.scrollLeft,
            this.samplesPerPixel,
            this.sampleRate
          );

          this.ee.emit("scroll");
        },
        hook: new ScrollHook(this),
      },
      trackElements
    );
  }

  render() {
    const containerChildren = [];

    if (this.showTimescale) {
      containerChildren.push(this.renderTimeScale());
    }

    containerChildren.push(this.renderTrackSection());

    if (this.annotationList.length) {
      containerChildren.push(this.renderAnnotations());
    }

    return h(
      "div.playlist",
      {
        attributes: {
          style: "position: relative;",
        },
      },
      containerChildren
    );
  }

  getInfo() {
    const tracks = [];

    this.tracks.forEach((track) => {
      tracks.push(track.getTrackDetails());
    });

    return {
      tracks,
      effects: this.effectsGraph,
    };
  }
}
