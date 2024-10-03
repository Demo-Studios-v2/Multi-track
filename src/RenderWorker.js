export default function () {
  let canvases = {};
  function drawFrame(cc, h2, x, minPeak, maxPeak, width, gap) {
    const min = Math.abs(minPeak * h2);
    const max = Math.abs(maxPeak * h2);

    // draw max
    cc.fillRect(x, 0, width, h2 - max);
    // draw min
    cc.fillRect(x, h2 + min, width, h2 - min);
    // draw gap
    if (gap !== 0) {
      cc.fillRect(x + width, 0, gap, h2 * 2);
    }
  }
  onmessage = async function (e) {
    const {
      scale,
      len,
      canvas,
      h2,
      maxValue,
      width,
      gap,
      peaks,
      offset,
      color,
      taskId,
      returnTaskId,
      type,
    } = e.data;
    if (type === "destroy") {
      delete canvases[taskId];
      return;
    }
    if (canvas) {
      canvases[taskId] = canvas;
    }
    canvases[taskId].width = len * scale;
    const cc = (canvas ?? canvases[taskId]).getContext("2d");
    const barStart = width + gap;
    cc.fillStyle = color;
    cc.scale(scale, scale);
    cc.clearRect(0, 0, canvases[taskId].width, canvases[taskId].height);
    for (let pixel = 0; pixel < len; pixel += barStart) {
      const minPeak = peaks[(pixel + offset) * 2] / maxValue;
      const maxPeak = peaks[(pixel + offset) * 2 + 1] / maxValue;
      drawFrame(cc, h2, pixel, minPeak, maxPeak, width, gap);
    }
    postMessage({ taskId: returnTaskId });
  };
}
