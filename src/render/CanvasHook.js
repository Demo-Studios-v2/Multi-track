/*
 * virtual-dom hook for drawing to the canvas element.
 */
import InlineWorker from "inline-worker";
import RenderWorker from "../RenderWorker";
const numRenderWorkers = 8;
let renderPromises = {};
let renderWorkerPool = new Array(numRenderWorkers).fill(null).map(() => {
  const worker = new InlineWorker(RenderWorker);
  worker.onmessage = (e) => {
    const { taskId } = e.data;
    renderPromises[taskId].resolve();
    delete renderPromises[taskId];
  };
  worker.onerror = (err) => {
    console.error(err);
  };
  return worker;
});
let currentRenderTaskId = 0;
let currentThreadAllocation = 0;

const observer = new MutationObserver((mutationsList, observer) => {
  for (let mutation of mutationsList) {
    // Check if child nodes are removed
    if (mutation.type === "childList") {
      mutation.removedNodes.forEach((removedNode) => {
        if (removedNode.taskId) {
          console.log(removedNode.taskId, "removed");
          renderWorkerPool[removedNode.taskId % numRenderWorkers].postMessage({
            type: "destroy",
            taskId: removedNode.taskId,
          });
        }
      });
    }
  }
});

// Configure the observer to watch for child node removal
const config = { childList: true, subtree: true };

// Start observing the parent of the target element
observer.observe(document.body, config);
class CanvasHook {
  constructor(peaks, offset, bits, color, scale, height, barWidth, barGap) {
    this.peaks = peaks;
    // http://stackoverflow.com/questions/6081483/maximum-size-of-a-canvas-element
    this.offset = offset;
    this.color = color;
    this.bits = bits;
    this.scale = scale;
    this.height = height;
    this.barWidth = barWidth;
    this.barGap = barGap;
  }

  hook(canvas, prop, prev) {
    // canvas is up to date
    if (
      prev !== undefined &&
      prev.peaks === this.peaks &&
      prev.scale === this.scale &&
      prev.height === this.height
    ) {
      return;
    }
    const prevBackground = canvas.style.backgroundColor;
    canvas.style.backgroundColor = this.color;
    const scale = this.scale;
    const len = canvas.width / scale;
    const h2 = canvas.height / scale / 2;
    const maxValue = 2 ** (this.bits - 1);
    const width = this.barWidth;
    const gap = this.barGap;
    let offscreenCanvas = undefined;
    if (canvas.taskId === undefined) {
      canvas.taskId = currentThreadAllocation++;
      offscreenCanvas = canvas.transferControlToOffscreen();
    }
    console.log(canvas.taskId);
    let returnTaskId = currentRenderTaskId++;
    renderWorkerPool[canvas.taskId % numRenderWorkers].postMessage(
      {
        type: "render",
        scale,
        len,
        canvas: offscreenCanvas,
        h2,
        maxValue,
        width,
        gap,
        peaks: this.peaks,
        offset: this.offset,
        color: this.color,
        taskId: canvas.taskId,
        returnTaskId,
      },
      offscreenCanvas ? [offscreenCanvas] : []
    );

    renderPromises[returnTaskId] = {
      resolve: () => {
        setTimeout(() => {
          canvas.style.backgroundColor = prevBackground;
        }, 40);
      },
    };
  }
}

export default CanvasHook;
