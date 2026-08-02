global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// jsdom implements neither window.crypto.subtle nor Blob.prototype.arrayBuffer
// (both are standard in every real browser) — polyfill them so tests can
// exercise ipc-transport.js's checksum verification (Improvement.md P1.1
// Transfer Center checksums), which relies on both in production code.
if (typeof global.crypto !== 'undefined' && !global.crypto.subtle) {
  global.crypto.subtle = require('crypto').webcrypto.subtle;
}
if (typeof Blob !== 'undefined' && !Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function () {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
}

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: jest.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn()
  }))
});

jest.mock('nanoid', () => {
  return {
    nanoid: () => {}
  };
});

jest.mock('strip-json-comments', () => {
  return {
    stripJsonComments: (str) => str
  };
});
