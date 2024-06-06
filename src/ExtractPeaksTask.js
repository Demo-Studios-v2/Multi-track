import InlineWorker from "inline-worker";
import ExtractPeaksWorker from "./ExtractPeaksWorker";

const peaksPromises = {};
const numPeaksWorkers = 8;
const workerPool = new Array(numPeaksWorkers).fill(null).map(() => {
  const worker = new InlineWorker(ExtractPeaksWorker);
  worker.onmessage = (e) => {
    const { peaks, taskId } = e.data;
    peaksPromises[taskId].resolve(peaks);
    delete peaksPromises[taskId];
  };
  worker.onerror = (err) => {
    console.error(err);
  };
  return worker;
});
let currentPeaksTaskId = 0;

export default async function (
  source,
  samplesPerPixelArray,
  isMono,
  cueIn,
  cueOut,
  bits
) {
  return new Promise((resolve, reject) => {
    const numChan = source.numberOfChannels;
    let sourceArr = [];
    for (let c = 0; c < numChan; c++) {
      sourceArr.push(source.getChannelData(c));
    }
    source = sourceArr;
    workerPool[currentPeaksTaskId % numPeaksWorkers].postMessage({
      source,
      samplesPerPixelArray,
      isMono,
      cueIn,
      cueOut,
      bits,
      taskId: currentPeaksTaskId,
      numChan,
    });
    peaksPromises[currentPeaksTaskId] = { resolve, reject };
    currentPeaksTaskId++;
  });
}
