// Experimental local state model; no browser integration.
class VerificationSession {
  constructor({ threshold = 90 } = {}) {
    this.threshold = threshold;
    this.revision = 0;
    this.code = '';
    this.imageLoaded = false;
    this.manual = false;
    this.pending = null;
    this.awaitingRefresh = false;
  }
  get phase() {
    if (this.pending) return 'submitting';
    if (this.awaitingRefresh) return 'waiting-for-refresh';
    if (!this.revision) return 'idle';
    if (!this.imageLoaded) return 'loading-image';
    if (this.manual) return 'manual';
    return this.code ? 'auto-ready' : 'recognizing';
  }
  beginImageLoad() {
    this.revision += 1;
    this.imageLoaded = false;
    this.code = '';
    return this.revision;
  }
  imageReady(revision) {
    if (revision !== this.revision || !revision) return false;
    this.imageLoaded = true;
    return true;
  }
  acceptRecognition(revision, text, confidence) {
    if (revision !== this.revision || this.phase !== 'recognizing') return false;
    if (!/^[a-z]{4}$/.test(text) || !Number.isFinite(confidence) || confidence < this.threshold) {
      this.manual = true;
      this.code = '';
      return false;
    }
    this.code = text;
    return true;
  }
  enterManually(revision, text) {
    if (revision !== this.revision || this.phase !== 'manual') return false;
    this.code = text;
    return true;
  }
  submit(currentRevision) {
    if (currentRevision !== this.revision || !['auto-ready', 'manual'].includes(this.phase) ||
        !/^[a-z]{4}$/.test(this.code)) return null;
    this.pending = { revision: this.revision, code: this.code, source: this.manual ? 'manual' : 'auto' };
    this.manual = true;
    this.code = '';
    return { ...this.pending };
  }
  reject(submittedRevision) {
    if (this.pending?.revision !== submittedRevision) return false;
    this.pending = null;
    this.code = '';
    this.awaitingRefresh = true;
    return true;
  }
  // Caller must FIRST observe the post-response page and finish image loading.
  // Never call this based on a guessed timeout or URL equality alone.
  settleAfterRejection(currentRevision) {
    if (!this.awaitingRefresh || currentRevision !== this.revision || !this.imageLoaded) return false;
    this.awaitingRefresh = false;
    return true;
  }
}
module.exports = { VerificationSession };
