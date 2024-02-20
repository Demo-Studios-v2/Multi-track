import Loader from "./Loader";

export default class IdentityLoader extends Loader {
  load() {
    console.log('identity')

    return Promise.resolve(this.src);
  }
}
