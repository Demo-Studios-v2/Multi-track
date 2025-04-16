import { pixelsToSeconds } from "../../utils/conversions";

export default class {
  constructor(track) {
    this.track = track;
    this.active = false;
  }

  setup(samplesPerPixel, sampleRate) {
    this.samplesPerPixel = samplesPerPixel;
    this.sampleRate = sampleRate;
  }

  emitShift(x) {
    const deltaX = x - this.prevX;
    const deltaTime = pixelsToSeconds(
      deltaX,
      this.samplesPerPixel,
      this.sampleRate
    );
    this.prevX = x;
    this.track.ee.emit("shift", deltaTime, this.track);
  }

  complete(x) {
    this.emitShift(x);
    this.active = false;
  }

  mousedown(e) {
    const target = e.target;
    target && target.parentNode && Array.from(target.parentNode.children);
    const channelSibling =
      target &&
      target.parentNode &&
      Array.from(target.parentNode.children).find(
        (sibling) => sibling !== target && sibling.classList.contains("channel")
      );
    const cursorSibling =
      target &&
      target.parentNode &&
      Array.from(target.parentNode.children).find(
        (sibling) => sibling !== target && sibling.classList.contains("cursor")
      );
    const leftOfCursor = cursorSibling?.style.left
      ? parseFloat(cursorSibling?.style.left)
      : 0;
    const distanceFromCursor = Math.abs(leftOfCursor - e.offsetX);
    const leftOfChannel = channelSibling?.style.left
      ? parseFloat(channelSibling?.style.left)
      : 0;
    const widthOfChannel = channelSibling?.style.width
      ? parseFloat(channelSibling?.style.width)
      : 0;
    if (
      distanceFromCursor <= 4 ||
      leftOfChannel > e.offsetX ||
      leftOfChannel + widthOfChannel < e.offsetX
    ) {
      return;
    }
    e.preventDefault();
    this.active = true;
    this.el = e.target;
    this.prevX = e.offsetX;
  }

  mousemove(e) {
    if (this.active) {
      e.preventDefault();
      this.emitShift(e.offsetX);
    }
  }

  mouseup(e) {
    if (this.active) {
      e.preventDefault();
      this.complete(e.offsetX);
    }
  }

  mouseleave(e) {
    if (this.active) {
      e.preventDefault();
      this.complete(e.offsetX);
    }
  }

  static getClass() {
    return ".state-shift";
  }

  static getEvents() {
    return ["mousedown", "mousemove", "mouseup", "mouseleave"];
  }
}
