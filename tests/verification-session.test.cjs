const test = require('node:test');
const assert = require('node:assert/strict');
const { VerificationSession } = require('../verification-session.cjs');

function loadedSession() {
  const session = new VerificationSession({ threshold: 90 });
  const revision = session.beginImageLoad();
  session.imageReady(revision);
  return { session, revision };
}

// Catches auto submission of a stale result after the image changes.
test('late recognition for the previous image cannot fill the current code', () => {
  const { session, revision } = loadedSession();
  const current = session.beginImageLoad();
  session.imageReady(current);
  assert.equal(session.phase, 'recognizing');
  assert.equal(session.acceptRecognition(revision, 'abcd', 99), false);
  assert.equal(session.code, '');
});

// Catches late OCR overwriting text that the user is already typing.
test('uncertain recognition hands over permanently for this challenge', () => {
  const { session, revision } = loadedSession();
  session.acceptRecognition(revision, 'abcd', 20);
  assert.equal(session.phase, 'manual');
  assert.equal(session.enterManually(revision, 'wx'), true);
  assert.equal(session.acceptRecognition(revision, 'abcd', 99), false);
  assert.equal(session.code, 'wx');
});

// Catches opening the manual field before a rejection-triggered refresh finishes.
test('rejection waits for the refreshed image before accepting manual input', () => {
  const { session, revision } = loadedSession();
  session.acceptRecognition(revision, 'abcd', 99);
  assert.deepEqual(session.submit(revision), { revision, code: 'abcd', source: 'auto' });
  session.reject(revision);
  assert.equal(session.phase, 'waiting-for-refresh');
  assert.equal(session.enterManually(revision, 'wxyz'), false);
  const current = session.beginImageLoad();
  assert.equal(session.settleAfterRejection(current), false);
  session.imageReady(current);
  assert.equal(session.settleAfterRejection(revision), false);
  assert.equal(session.settleAfterRejection(current), true);
  assert.equal(session.phase, 'manual');
  session.enterManually(current, 'wxyz');
  assert.deepEqual(session.submit(current), { revision: current, code: 'wxyz', source: 'manual' });
});

// Catches the reverse event order: image loading before the response handler runs.
test('an image refresh during a pending request stays blocked until its response settles', () => {
  const { session, revision } = loadedSession();
  session.acceptRecognition(revision, 'abcd', 99);
  session.submit(revision);
  const current = session.beginImageLoad();
  session.imageReady(current);
  assert.equal(session.phase, 'submitting');
  assert.equal(session.enterManually(current, 'wxyz'), false);
  assert.equal(session.reject(revision), true);
  assert.equal(session.phase, 'waiting-for-refresh');
  session.settleAfterRejection(current);
  assert.equal(session.phase, 'manual');
});

// Catches a dead end when the server rejects but retains the same image.
test('same-image rejection permits manual entry only after explicit fresh observation', () => {
  const { session, revision } = loadedSession();
  session.acceptRecognition(revision, 'abcd', 99);
  session.submit(revision);
  session.reject(revision);
  assert.equal(session.enterManually(revision, 'wxyz'), false);
  assert.equal(session.settleAfterRejection(revision), true);
  assert.equal(session.enterManually(revision, 'wxyz'), true);
});

// Catches repeated submit events creating duplicate requests.
test('a pending submission cannot be submitted twice', () => {
  const { session, revision } = loadedSession();
  session.acceptRecognition(revision, 'abcd', 99);
  assert.ok(session.submit(revision));
  assert.equal(session.submit(revision), null);
  assert.equal(session.reject(revision + 1), false);
  assert.equal(session.phase, 'submitting');
});

// Catches sending partially typed or invalid codes based on confidence alone.
test('malformed recognition switches to manual and incomplete manual input cannot submit', () => {
  const { session, revision } = loadedSession();
  session.acceptRecognition(revision, 'abc', 99);
  assert.equal(session.phase, 'manual');
  session.enterManually(revision, 'xy');
  assert.equal(session.submit(revision), null);
  session.enterManually(revision, 'x1yz');
  assert.equal(session.submit(revision), null);
});

// Catches stale manual input being sent after another image refresh.
test('refresh while typing clears the entry and keeps manual ownership', () => {
  const { session, revision } = loadedSession();
  session.acceptRecognition(revision, 'abcd', 0);
  session.enterManually(revision, 'wxy');
  const current = session.beginImageLoad();
  assert.equal(session.code, '');
  assert.equal(session.enterManually(revision, 'wxyz'), false);
  session.imageReady(current);
  assert.equal(session.phase, 'manual');
  assert.equal(session.acceptRecognition(current, 'abcd', 99), false);
  assert.equal(session.submit(revision), null);
});
