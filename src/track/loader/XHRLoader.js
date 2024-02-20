import Loader from "./Loader";

export default class extends Loader {
  /**
   * Loads an audio file via XHR.
   */
  load(handleProgress = (percent) => {}) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      xhr.open("GET", this.src, true);
      xhr.responseType = "arraybuffer";
      xhr.send();

      xhr.addEventListener("progress", (e) => {
        super.fileProgress(e);

        console.log('loaded', e.loaded)
        console.log('total', e.total)
        console.log('total', (e.loaded / e.total) * 100)

        handleProgress((e.loaded / e.total) * 100);
      });

      xhr.addEventListener("load", (e) => {
        const decoderPromise = super.fileLoad(e);

        decoderPromise
          .then((audioBuffer) => {
            resolve(audioBuffer);
          })
          .catch(reject);
      });

      xhr.addEventListener("error", () => {
        reject(Error(`Track ${this.src} failed to load`));
      });
    });
  }
}
