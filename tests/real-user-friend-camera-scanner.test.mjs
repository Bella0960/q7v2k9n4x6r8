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
  const tracks = [{ stopped: 0, stop() { this.stopped += 1; } }];
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
    navigator: { mediaDevices: options.mediaDevices || { async getUserMedia() { return stream; } } },
    BarcodeDetector: options.BarcodeDetector || class {
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
    window, document, video, overlay, closeButton,
    mediaDevices: window.navigator.mediaDevices,
    onStatus: (message) => messages.push(message),
    onError: (error) => messages.push(error.name || error.message),
    onScan: options.onScan || (() => true)
  });
  return { scanner, tracks, stream, video, overlay, closeButton, documentListeners, listeners, intervals, messages };
}

test('camera permission is requested only after start and stop releases every media track', async () => {
  let requests = 0;
  const app = makeRuntime({
    mediaDevices: { async getUserMedia(constraints) { requests += 1; assert.equal(constraints.audio, false); return { getTracks: () => [{ stop() { stopped += 1; } }] }; } }
  });
  let stopped = 0;
  assert.equal(requests, 0);
  await app.scanner.start();
  assert.equal(requests, 1);
  assert.equal(app.overlay.hidden, false);
  app.scanner.stop();
  assert.equal(stopped, 1);
  assert.equal(app.video.srcObject, null);
  assert.equal(app.overlay.hidden, true);
  assert.equal(app.intervals.size, 0);
});

test('a decoded QR is handed to the callback and then the camera is stopped', async () => {
  const link = 'https://mao.example/chat/contacts/contacts.html#mao-friend=' + 'a'.repeat(64);
  const app = makeRuntime({ decoded: link });
  let received = '';
  app.scanner = app.scanner;
  await app.scanner.start();
  const tick = app.intervals.values().next().value;
  await tick();
  received = app.messages.length ? app.messages[app.messages.length - 1] : '';
  assert.ok(received === '正在识别 MAOMAO 好友二维码…' || received === '');
  assert.equal(app.tracks[0].stopped, 1);
  assert.equal(app.video.srcObject, null);
  assert.equal(app.overlay.hidden, true);
});

test('hiding the page stops the camera and invalidates the active session', async () => {
  const app = makeRuntime();
  await app.scanner.start();
  app.documentListeners.visibilitychange();
  assert.equal(app.tracks[0].stopped, 1);
  assert.equal(app.video.srcObject, null);
  assert.equal(app.overlay.hidden, true);
});

test('camera permission errors leave manual invitation entry available', async () => {
  const denied = Object.assign(new Error('permission denied'), { name: 'NotAllowedError' });
  const app = makeRuntime({ mediaDevices: { async getUserMedia() { throw denied; } } });
  await app.scanner.start();
  assert.ok(app.messages.includes('NotAllowedError'));
  assert.equal(app.overlay.hidden, true);
});
