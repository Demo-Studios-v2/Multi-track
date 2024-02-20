import Loader from "./Loader";

export default class extends Loader {
  /*
   * Loads an audio file via a FileReader
   */
  load(handleProgress = (percent) => {}) {
    return new Promise((resolve, reject) => {
      if (
        this.src.type.match(/audio.*/) ||
        // added for problems with Firefox mime types + ogg.
        this.src.type.match(/video\/ogg/)
      ) {
        const fr = new FileReader();

        fr.readAsArrayBuffer(this.src);

        fr.addEventListener("progress", (e) => {
          super.fileProgress(e);

          const progressInPercents = (e.loaded / e.total) * 100

          console.log('progress', progressInPercents)

          console.log('progress fn', handleProgress(progressInPercents))

          handleProgress(progressInPercents);
        });

        fr.addEventListener("load", (e) => {
          const decoderPromise = super.fileLoad(e);

          decoderPromise
            .then((audioBuffer) => {
              resolve(audioBuffer);
            })
            .catch(reject);
        });

        fr.addEventListener("error", reject);
      } else {
        reject(Error(`Unsupported file type ${this.src.type}`));
      }
    });
  }
}
