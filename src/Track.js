import _assign from "lodash.assign";
import _forOwn from "lodash.forown";

import { v4 as uuidv4 } from "uuid";
import h from "virtual-dom/h";

import { FADEIN, FADEOUT } from "fade-maker";
import extractPeaks from "webaudio-peaks";

import stateClasses from "./track/states";
import { secondsToPixels, secondsToSamples } from "./utils/conversions";

import ExtractPeaksTask from "./ExtractPeaksTask";
import CanvasHook from "./render/CanvasHook";
import FadeCanvasHook from "./render/FadeCanvasHook";
import StereoPanSliderHook from "./render/StereoPanSliderHook";
import VolumeSliderHook from "./render/VolumeSliderHook";
const MAX_CANVAS_WIDTH = 1000;

export default class {
  constructor() {
    this.name = "Untitled";
    this.customClass = undefined;
    this.waveOutlineColor = undefined;
    this.gain = 1;
    this.fades = {};
    this.peakData = {
      type: "WebAudio",
      mono: false,
    };
    this.peakDataPerZoom = {};
    this.initialDuration = 0;
    this.cueIn = 0;
    this.cueOut = 0;
    this.duration = 0;
    this.startTime = 0;
    this.endTime = 0;
    this.stereoPan = 0;
    this.id = "";
  }

  setEventEmitter(ee) {
    this.ee = ee;
  }

  setName(name) {
    this.name = name;
  }

  setInitialDuration(duration) {
    this.initialDuration = duration;
  }

  setId(id) {
    this.id = id;
  }
  setCustomClass(className) {
    this.customClass = className;
  }

  setWaveOutlineColor(color) {
    this.waveOutlineColor = color;
  }

  setCues(cueIn, cueOut) {
    this.cueIn = cueIn;
    this.cueOut = cueOut;

    this.duration = this.cueOut - this.cueIn;
    this.endTime = this.startTime + this.duration;
  }

  /*
   *   start, end in seconds relative to the entire playlist.
   */
  trim(start, end) {
    const trackStart = this.getStartTime(); // track position on timeline
    const trackEnd = trackStart + (this.cueOut - this.cueIn); // track end position on timeline

    // Ensure start and end are within valid timeline bounds
    const minTrackLength = 0.01;
    if (start < 0) start = 0;
    if (end < start + minTrackLength) end = start + minTrackLength;

    // Convert absolute timeline positions to relative cues
    let newCueIn = this.cueIn + (start - trackStart);
    let newCueOut = this.cueOut + (end - trackEnd);

    // Clamp to original buffer limits [0, initialDuration]
    if (newCueIn < 0) {
      // Adjust start to avoid exceeding the left buffer limit
      start += -newCueIn; // shift track right
      newCueIn = 0;
    }

    if (newCueOut > this.initialDuration) {
      // Adjust end to avoid exceeding the right buffer limit
      end -= newCueOut - this.initialDuration; // shift track left
      newCueOut = this.initialDuration;
    }

    // Ensure after adjustments we didn't invert the range
    if (end - start < minTrackLength) {
      end = start + minTrackLength;
      newCueOut = newCueIn + minTrackLength;
      if (newCueOut > this.initialDuration) {
        newCueOut = this.initialDuration;
        newCueIn = newCueOut - minTrackLength;
        start = trackStart - (this.cueIn - newCueIn);
      }
    }

    // Finally, set the cues and new start time
    this.setCues(newCueIn, newCueOut);
    this.setStartTime(start);
    this.ee.emit("crop", this);
  }

  setStartTime(start) {
    this.startTime = start;
    this.endTime = start + this.duration;
  }

  setPlayout(playout) {
    this.playout = playout;
  }

  setOfflinePlayout(playout) {
    this.offlinePlayout = playout;
  }

  setEnabledStates(enabledStates = {}) {
    const defaultStatesEnabled = {
      cursor: true,
      fadein: true,
      fadeout: true,
      select: true,
      shift: true,
    };

    this.enabledStates = _assign({}, defaultStatesEnabled, enabledStates);
  }

  setFadeIn(duration, shape = "logarithmic") {
    if (duration > this.duration) {
      throw new Error("Invalid Fade In");
    }

    const fade = {
      shape,
      start: 0,
      end: duration,
    };

    if (this.fadeIn) {
      this.removeFade(this.fadeIn);
      this.fadeIn = undefined;
    }

    this.fadeIn = this.saveFade(FADEIN, fade.shape, fade.start, fade.end);
  }

  setFadeOut(duration, shape = "logarithmic") {
    if (duration > this.duration) {
      throw new Error("Invalid Fade Out");
    }

    const fade = {
      shape,
      start: this.duration - duration,
      end: this.duration,
    };

    if (this.fadeOut) {
      this.removeFade(this.fadeOut);
      this.fadeOut = undefined;
    }

    this.fadeOut = this.saveFade(FADEOUT, fade.shape, fade.start, fade.end);
  }

  saveFade(type, shape, start, end) {
    const id = uuidv4();

    this.fades[id] = {
      type,
      shape,
      start,
      end,
    };

    return id;
  }

  removeFade(id) {
    delete this.fades[id];
  }

  setBuffer(buffer) {
    this.buffer = buffer;
  }

  setPeakData(data) {
    this.peakData = data;
  }
  cropPeaks(precalculatedPeaks, cueIn, cueOut, samplesPerPixel) {
    const peakStart = Math.floor(cueIn / samplesPerPixel) * 2;
    const peakEnd = Math.ceil(cueOut / samplesPerPixel) * 2;

    return {
      data: precalculatedPeaks.data.map((channelPeaks) =>
        channelPeaks.slice(peakStart, peakEnd)
      ),
      length: (peakEnd - peakStart) / 2,
      bits: precalculatedPeaks.bits,
    };
  }
  defaultNumber(value, defaultNumber) {
    if (typeof value === "number") {
      return value;
    } else {
      return defaultNumber;
    }
  }
  calculatePeaks(samplesPerPixel, sampleRate) {
    let cueIn = secondsToSamples(this.cueIn, sampleRate);
    let cueOut = secondsToSamples(this.cueOut, sampleRate);
    if (this.peakDataPerZoom[samplesPerPixel]) {
      cueIn = this.defaultNumber(cueIn, 0);
      cueOut = this.defaultNumber(cueOut, this.buffer.length);
      this.setPeaks(
        this.cropPeaks(
          this.peakDataPerZoom[samplesPerPixel],
          cueIn,
          cueOut,
          samplesPerPixel
        )
      );
      return;
    }
    this.setPeaks(
      extractPeaks(
        this.buffer,
        samplesPerPixel,
        this.peakData.mono,
        cueIn,
        cueOut
      )
    );
  }
  async calculatePeaksPerZoom(samplesPerPixelArray, sampleRate) {
    const cueIn = secondsToSamples(this.cueIn, sampleRate);
    const cueOut = secondsToSamples(this.cueOut, sampleRate);
    this.peakDataPerZoom = await ExtractPeaksTask(
      this.buffer,
      samplesPerPixelArray,
      this.peakData.mono,
      undefined,
      undefined
    );
  }

  setPeaks(peaks) {
    this.peaks = peaks;
  }

  setState(state) {
    this.state = state;

    if (this.state && this.enabledStates[this.state]) {
      const StateClass = stateClasses[this.state];
      this.stateObj = new StateClass(this);
    } else {
      this.stateObj = undefined;
    }
  }

  getStartTime() {
    return this.startTime;
  }

  getEndTime() {
    return this.endTime;
  }

  getDuration() {
    return this.duration;
  }

  isPlaying() {
    return this.playout.isPlaying();
  }

  setShouldPlay(bool) {
    this.playout.setShouldPlay(bool);
  }

  setGainLevel(level) {
    this.gain = level;
    this.playout.setVolumeGainLevel(level);
  }

  setMasterGainLevel(level) {
    this.playout.setMasterGainLevel(level);
  }

  setStereoPanValue(value) {
    this.stereoPan = value;
    this.playout.setStereoPanValue(value);
  }

  setEffects(effectsGraph) {
    this.effectsGraph = effectsGraph;
    this.playout.setEffects(effectsGraph);
  }

  /*
    startTime, endTime in seconds (float).
    segment is for a highlighted section in the UI.

    returns a Promise that will resolve when the AudioBufferSource
    is either stopped or plays out naturally.
  */
  schedulePlay(now, startTime, endTime, config) {
    let start;
    let duration;
    let when = now;
    let segment = endTime ? endTime - startTime : undefined;

    const defaultOptions = {
      shouldPlay: true,
      masterGain: 1,
      isOffline: false,
    };

    const options = _assign({}, defaultOptions, config);
    const playoutSystem = options.isOffline
      ? this.offlinePlayout
      : this.playout;

    // 1) track has no content to play.
    // 2) track does not play in this selection.
    if (
      this.endTime <= startTime ||
      (segment && startTime + segment < this.startTime)
    ) {
      // return a resolved promise since this track is technically "stopped".
      return Promise.resolve();
    }

    // track should have something to play if it gets here.

    // the track starts in the future or on the cursor position
    if (this.startTime >= startTime) {
      start = 0;
      // schedule additional delay for this audio node.
      when += this.startTime - startTime;

      if (endTime) {
        segment -= this.startTime - startTime;
        duration = Math.min(segment, this.duration);
      } else {
        duration = this.duration;
      }
    } else {
      start = startTime - this.startTime;

      if (endTime) {
        duration = Math.min(segment, this.duration - start);
      } else {
        duration = this.duration - start;
      }
    }

    start += this.cueIn;
    const relPos = startTime - this.startTime;
    const sourcePromise = playoutSystem.setUpSource();

    // param relPos: cursor position in seconds relative to this track.
    // can be negative if the cursor is placed before the start of this track etc.
    _forOwn(this.fades, (fade) => {
      let fadeStart;
      let fadeDuration;

      // only apply fade if it's ahead of the cursor.
      if (relPos < fade.end) {
        if (relPos <= fade.start) {
          fadeStart = now + (fade.start - relPos);
          fadeDuration = fade.end - fade.start;
        } else if (relPos > fade.start && relPos < fade.end) {
          fadeStart = now - (relPos - fade.start);
          fadeDuration = fade.end - fade.start;
        }

        switch (fade.type) {
          case FADEIN: {
            playoutSystem.applyFadeIn(fadeStart, fadeDuration, fade.shape);
            break;
          }
          case FADEOUT: {
            playoutSystem.applyFadeOut(fadeStart, fadeDuration, fade.shape);
            break;
          }
          default: {
            throw new Error("Invalid fade type saved on track.");
          }
        }
      }
    });

    playoutSystem.setVolumeGainLevel(this.gain);
    playoutSystem.setShouldPlay(options.shouldPlay);
    playoutSystem.setMasterGainLevel(options.masterGain);
    playoutSystem.setStereoPanValue(this.stereoPan);
    playoutSystem.play(when, start, duration);

    return sourcePromise;
  }

  scheduleStop(when = 0) {
    this.playout.stop(when);
  }

  renderOverlay(data) {
    const channelPixels = secondsToPixels(
      data.playlistLength,
      data.resolution,
      data.sampleRate
    );

    const config = {
      attributes: {
        style: `position: absolute; top: 0; right: 0; bottom: 0; left: 0; width: ${channelPixels}px; z-index: 9;`,
      },
    };

    let overlayClass = "";

    if (this.stateObj) {
      this.stateObj.setup(data.resolution, data.sampleRate);
      const StateClass = stateClasses[this.state];
      const events = StateClass.getEvents();

      events.forEach((event) => {
        config[`on${event}`] = this.stateObj[event].bind(this.stateObj);
      });

      overlayClass = StateClass.getClass();
    }
    // use this overlay for track event cursor position calculations.
    return h(`div.playlist-overlay${overlayClass}`, config);
  }

  renderControls(data) {
    const muteClass = data.muted ? ".active" : "";
    const soloClass = data.soloed ? ".active" : "";
    const isCollapsed = data.collapsed;
    const numChan = this.peaks.data.length;
    const widgets = data.controls.widgets;

    const removeTrack = h(
      "button.btn.btn-danger.btn-xs.track-remove",
      {
        attributes: {
          type: "button",
          title: "Remove track",
        },
        onclick: () => {
          this.ee.emit("removeTrack", this);
        },
      },
      [h("i.fas.fa-times")]
    );

    const trackName = h("span", [this.name]);

    const collapseTrack = h(
      "button.btn.btn-info.btn-xs.track-collapse",
      {
        attributes: {
          type: "button",
          title: isCollapsed ? "Expand track" : "Collapse track",
        },
        onclick: () => {
          this.ee.emit("changeTrackView", this, {
            collapsed: !isCollapsed,
          });
        },
      },
      [h(`i.fas.${isCollapsed ? "fa-caret-down" : "fa-caret-up"}`)]
    );

    const headerChildren = [];

    if (widgets.remove) {
      headerChildren.push(removeTrack);
    }
    headerChildren.push(trackName);
    if (widgets.collapse) {
      headerChildren.push(collapseTrack);
    }

    const controls = [h("div.track-header", headerChildren)];

    if (!isCollapsed) {
      if (widgets.muteOrSolo) {
        controls.push(
          h("div.btn-group", [
            h(
              `button.btn.btn-outline-dark.btn-xs.btn-mute${muteClass}`,
              {
                attributes: {
                  type: "button",
                },
                onclick: () => {
                  this.ee.emit("mute", this);
                },
              },
              ["Mute"]
            ),
            h(
              `button.btn.btn-outline-dark.btn-xs.btn-solo${soloClass}`,
              {
                onclick: () => {
                  this.ee.emit("solo", this);
                },
              },
              ["Solo"]
            ),
          ])
        );
      }

      if (widgets.volume) {
        controls.push(
          h("label.volume", [
            h("input.volume-slider", {
              attributes: {
                "aria-label": "Track volume control",
                type: "range",
                min: 0,
                max: 100,
                value: 100,
              },
              hook: new VolumeSliderHook(this.gain),
              oninput: (e) => {
                this.ee.emit("volumechange", e.target.value, this);
              },
            }),
          ])
        );
      }

      if (widgets.stereoPan) {
        controls.push(
          h("label.stereopan", [
            h("input.stereopan-slider", {
              attributes: {
                "aria-label": "Track stereo pan control",
                type: "range",
                min: -100,
                max: 100,
                value: 100,
              },
              hook: new StereoPanSliderHook(this.stereoPan),
              oninput: (e) => {
                this.ee.emit("stereopan", e.target.value / 100, this);
              },
            }),
          ])
        );
      }
    }

    return h(
      "div.controls",
      {
        attributes: {
          style: `height: ${numChan * data.height}px; width: ${
            data.controls.width
          }px; position: absolute; left: 0; z-index: 10;`,
        },
      },
      controls
    );
  }

  render(data) {
    const width = this.peaks.length;
    const playbackX = secondsToPixels(
      data.playbackSeconds,
      data.resolution,
      data.sampleRate
    );
    const startX = secondsToPixels(
      this.startTime,
      data.resolution,
      data.sampleRate
    );
    const endX = secondsToPixels(
      this.endTime,
      data.resolution,
      data.sampleRate
    );
    let progressWidth = 0;
    const numChan = this.peaks.data.length;
    const scale = Math.ceil(window.devicePixelRatio);

    if (playbackX > 0 && playbackX > startX) {
      if (playbackX < endX) {
        progressWidth = playbackX - startX;
      } else {
        progressWidth = width;
      }
    }

    const waveformChildren = [
      h("div.cursor", {
        attributes: {
          style: `position: absolute; width: 1px; margin: 0; padding: 0; top: 0; left: ${playbackX}px; bottom: 0; z-index: 5;`,
        },
      }),
    ];

    const channels = Object.keys(this.peaks.data).map((channelNum) => {
      const channelChildren = [
        h("div.channel-progress", {
          attributes: {
            style: `position: absolute; width: ${progressWidth}px; height: ${
              data.height - 2
            }px; z-index: 2;`,
          },
        }),
      ];
      let offset = 0;
      let totalWidth = width;
      const peaks = this.peaks.data[channelNum];
      while (totalWidth > 0) {
        const currentWidth = Math.min(totalWidth, MAX_CANVAS_WIDTH);
        const canvasColor = this.waveOutlineColor
          ? this.waveOutlineColor
          : data.colors.waveOutlineColor;

        channelChildren.push(
          h("canvas", {
            attributes: {
              width: currentWidth * scale,
              height: data.height * scale,
              style: `float: left; position: relative; margin: 0; padding: 0; z-index: 3; width: ${currentWidth}px; height: ${
                data.height - 2
              }px;`,
            },
            hook: new CanvasHook(
              peaks,
              offset,
              this.peaks.bits,
              canvasColor,
              scale,
              data.height,
              data.barWidth,
              data.barGap
            ),
          })
        );

        totalWidth -= currentWidth;
        offset += MAX_CANVAS_WIDTH;
      }

      // if there are fades, display them.
      if (this.fadeIn) {
        const fadeIn = this.fades[this.fadeIn];
        const fadeWidth = secondsToPixels(
          fadeIn.end - fadeIn.start,
          data.resolution,
          data.sampleRate
        );

        channelChildren.push(
          h(
            "div.wp-fade.wp-fadein",
            {
              attributes: {
                style: `position: absolute; height: ${data.height}px; width: ${fadeWidth}px; top: 0; left: 0; z-index: 4;`,
              },
            },
            [
              h("canvas", {
                attributes: {
                  width: fadeWidth,
                  height: data.height,
                },
                hook: new FadeCanvasHook(
                  fadeIn.type,
                  fadeIn.shape,
                  fadeIn.end - fadeIn.start,
                  data.resolution
                ),
              }),
            ]
          )
        );
      }

      if (this.fadeOut) {
        const fadeOut = this.fades[this.fadeOut];
        const fadeWidth = secondsToPixels(
          fadeOut.end - fadeOut.start,
          data.resolution,
          data.sampleRate
        );

        channelChildren.push(
          h(
            "div.wp-fade.wp-fadeout",
            {
              attributes: {
                style: `position: absolute; height: ${data.height}px; width: ${fadeWidth}px; top: 0; right: 0; z-index: 4;`,
              },
            },
            [
              h("canvas", {
                attributes: {
                  width: fadeWidth,
                  height: data.height,
                },
                hook: new FadeCanvasHook(
                  fadeOut.type,
                  fadeOut.shape,
                  fadeOut.end - fadeOut.start,
                  data.resolution
                ),
              }),
            ]
          )
        );
      }

      return h(
        `div.channel.channel-${channelNum}`,
        {
          attributes: {
            style: `height: ${data.height - 2}px; width: ${width}px; top: ${
              channelNum * data.height
            }px; left: ${startX}px; position: absolute; margin: 0; padding: 0; z-index: 1;`,
          },
        },
        channelChildren
      );
    });

    waveformChildren.push(channels);
    waveformChildren.push(this.renderOverlay(data));

    // draw cursor selection on active track.
    if (data.isActive === true) {
      const cStartX = secondsToPixels(
        data.timeSelection.start,
        data.resolution,
        data.sampleRate
      );
      const cEndX = secondsToPixels(
        data.timeSelection.end,
        data.resolution,
        data.sampleRate
      );
      const cWidth = cEndX - cStartX + 1;
      const cClassName = cWidth > 1 ? ".segment" : ".point";

      waveformChildren.push(
        h(`div.selection${cClassName}`, {
          attributes: {
            style: `position: absolute; width: ${cWidth}px; bottom: 0; top: 0; left: ${cStartX}px; z-index: 4;`,
          },
        })
      );
    }

    const waveform = h(
      "div.waveform",
      {
        attributes: {
          style: `height: ${numChan * data.height}px; position: relative;`,
        },
      },
      waveformChildren
    );

    const channelChildren = [];
    let channelMargin = 0;

    if (data.controls.show) {
      channelChildren.push(this.renderControls(data));
      channelMargin = data.controls.width;
    }

    channelChildren.push(waveform);

    const audibleClass = data.shouldPlay ? "" : ".silent";
    const customClass =
      this.customClass === undefined ? "" : `.${this.customClass}`;
    return h(
      `div.channel-wrapper${audibleClass}${customClass}`,
      {
        attributes: {
          style: `margin-left: ${channelMargin}px; height: ${
            data.height * numChan
          }px;`,
        },
      },
      channelChildren
    );
  }

  getTrackDetails() {
    const info = {
      src: this.src,
      start: this.startTime,
      end: this.endTime,
      name: this.name,
      customClass: this.customClass,
      cuein: this.cueIn,
      cueout: this.cueOut,
      stereoPan: this.stereoPan,
      gain: this.gain,
      effects: this.effectsGraph,
    };

    if (this.fadeIn) {
      const fadeIn = this.fades[this.fadeIn];

      info.fadeIn = {
        shape: fadeIn.shape,
        duration: fadeIn.end - fadeIn.start,
      };
    }

    if (this.fadeOut) {
      const fadeOut = this.fades[this.fadeOut];

      info.fadeOut = {
        shape: fadeOut.shape,
        duration: fadeOut.end - fadeOut.start,
      };
    }

    return info;
  }
}
