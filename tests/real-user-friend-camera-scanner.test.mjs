import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'shared/js/phone/real-user-camera-scanner.js'), 'utf8');

function makeRuntime(options = {}) {
  const listeners = {};
  const documentListeners = {};
  const intervals = new Map();
  let nextInterval = 1;
  let requests = 0;
  let constraints = null;
  let stopCount = 0;
  const tracks = [{ stop() { stopCount += 1; } }];
  const stream = { getTracks: () => tracks };
  const video = {
    srcObject: null, videoWidth: 640, videoHeight: 480,
    setAttribute() {}, async play() {}, pause() { this.paused = true; }
  };
  const overlay = { hidden: true };
  const closeButton = {
    handlers: {},
    addEventListener(type, fn) { this.handlers[type] = fn; },
    removeEventListener(type) { delete this.handlers[type]; }
  };
  const mediaDevices = {
    async getUserMedia(value) {
      requests += 1;
      constraints = value;
      if (options.cameraError) throw options.cameraError;
      return stream;
    }
  };
  const document = {
    hidden: false,
    head: { appendChild(script) { script.onerror && script.onerror(); } },
    createElement(name) {
      if (name === 'canvas') return { width: 0, height: 0, getContext: () => null };
      return {};
    },
    addEventListener(type, fn) { documentListeners[type] = fn; },
    removeEventListener(type) { delete documentListeners[type]; }
  };
  const window = {
    location: { href: 'https://mao.example/chat/contacts/contacts.html', origin: 'https://mao.example' },
    navigator: { mediaDevices },
    BarcodeDetector: class {
      async detect() { return options.decoded ? [{ rawValue: options.decoded }] : []; }
    },
    setInterval(fn) { const id = nextInterval++; intervals.set(id, fn); return id; },
    clearInterval(id) { intervals.delete(id); },
    addEventListener(type, fn) { listeners[type] = fn; },
    removeEventListener(type) { delete listeners[type]; }
  };
  vm.runInNewContext(SOURCE, { window, Promise, Error, String, Number, Math, URL }, {
    filename: 'real-user-camera-scanner.js'
  });
  const messages = [];
  const scanner = window.PhoneRealUserCameraScanner.create({
    document, video, overlay, closeButton, mediaDevices,
    onStatus: (message) => messages.push(message),
    onError: (error) => messages.push(error.name || error.message),
    onScan: options.onScan || (() => true)
  });
  return {
    scanner, tracks, stream, video, overlay, closeButton, documentListeners,
    listeners, intervals, messages,
    get requests() { return requests; },
    get constraints() { return constraints; },
    get stopCount() { return stopCount; }
  };
}

test('camera access begins only after explicit start and stop releases every media track', async () => {
  const app = makeRuntime();
  assert.equal(app.requests, 0);
  assert.equal(await app.scanner.start(), true);
  assert.equal(app.requests, 1);
  assert.equal(app.constraints.audio, false);
  assert.equal(app.constraints.video.facingMode.ideal, 'environment');
  assert.equal(app.overlay.hidden, false);
  app.scanner.stop();
  assert.equal(app.stopCount, 1);
  assert.equal(app.video.srcObject, null);
  assert.equal(app.overlay.hidden, true);
  assert.equal(app.intervals.size, 0);
});

test('repeated start clicks do not create a second camera stream', async () => {
  const app = makeRuntime();
  await app.scanner.start();
  await app.scanner.start();
  assert.equal(app.requests, 1);
  app.scanner.stop();
  assert.equal(app.stopCount, 1);
});

test('a decoded QR is passed to the validator and then the camera is stopped', async () => {
  const link = 'https://mao.example/chat/contacts/contacts.html#mao-friend=' + 'a'.repeat(64);
  let received = '';
  const app = makeRuntime({
    decoded: link,
    onScan: (value) => { received = value; return true; }
  });
  await app.scanner.start();
  const tick = app.intervals.values().next().value;
  await tick();
  assert.equal(received, link);
  assert.equal(app.stopCount, 1);
  assert.equal(app.video.srcObject, null);
  assert.equal(app.overlay.hidden, true);
});

test('hiding the page stops the camera and invalidates the active session', async () => {
  const app = makeRuntime();
  await app.scanner.start();
  app.documentListeners.visibilitychange();
  assert.equal(app.stopCount, 1);
  assert.equal(app.video.srcObject, null);
  assert.equal(app.overlay.hidden, true);
});


test('closing while the browser permission prompt is pending stops the late stream', async () => {
  let resolvePermission;
  let stopped = 0;
  const pendingStream = { getTracks: () => [{ stop() { stopped += 1; } }] };
  const listeners = {};
  const documentListeners = {};
  const intervals = new Map();
  const video = { srcObject: null, setAttribute() {}, async play() {}, pause() {} };
  const overlay = { hidden: true };
  const closeButton = { addEventListener(type, fn) { listeners[type] = fn; }, removeEventListener(type) { delete listeners[type]; } };
  const document = {
    hidden: false,
    createElement() { return {}; },
    addEventListener(type, fn) { documentListeners[type] = fn; },
    removeEventListener(type) { delete documentListeners[type]; }
  };
  const window = {
    location: { href: 'https://mao.example/chat/contacts/contacts.html', origin: 'https://mao.example' },
    navigator: {},
    BarcodeDetector: class {},
    setInterval(fn) { intervals.set(1, fn); return 1; },
    clearInterval(id) { intervals.delete(id); },
    addEventListener() {}, removeEventListener() {}
  };
  const mediaDevices = {
    getUserMedia() {
      return new Promise(resolve => { resolvePermission = resolve; });
    }
  };
  vm.runInNewContext(SOURCE, { window, Promise, Error, String, Number, Math, URL }, {
    filename: 'real-user-camera-scanner.js'
  });
  const scanner = window.PhoneRealUserCameraScanner.create({
    document, video, overlay, closeButton, mediaDevices,
    fallbackScriptUrl: '/jsQR.js',
    onStatus() {}
  });
  const started = scanner.start();
  await Promise.resolve();
  await Promise.resolve();
  scanner.stop();
  assert.equal(overlay.hidden, true);
  resolvePermission(pendingStream);
  assert.equal(await started, false);
  assert.equal(stopped, 1);
  assert.equal(video.srcObject, null);
  assert.equal(intervals.size, 0);
});


test('unsupported browsers keep the scan overlay closed and do not request a camera', async () => {
  const app = makeRuntime({ mediaDevices: {} });
  assert.equal(await app.scanner.start(), false);
  assert.equal(app.requests, 0);
  assert.equal(app.overlay.hidden, true);
  assert.ok(app.messages.some(message => String(message).includes('无法使用摄像头')));
});

test('camera permission errors leave manual invitation entry available', async () => {
  const denied = Object.assign(new Error('permission denied'), { name: 'NotAllowedError' });
  const app = makeRuntime({ cameraError: denied });
  await app.scanner.start();
  assert.ok(app.messages.includes('NotAllowedError'));
  assert.equal(app.overlay.hidden, true);
  assert.equal(app.stopCount, 0);
});
