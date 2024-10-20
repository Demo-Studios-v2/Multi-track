import BlobLoader from "./BlobLoader";
import IdentityLoader from "./IdentityLoader";
import XHRLoader from "./XHRLoader";

export default class {
  static createLoader(src, audioContext, ee, usePolyfillReader = false) {
    let loader;
    if (src instanceof Blob) {
      loader = new BlobLoader(src, audioContext, ee);
    } else if (src instanceof AudioBuffer) {
      loader = new IdentityLoader(src, audioContext, ee);
    } else if (typeof src === "string") {
      loader = new XHRLoader(src, audioContext, ee);
    }
    loader.usePolyfillReader = usePolyfillReader;
    return loader;
    throw new Error("Unsupported src type");
  }
}
