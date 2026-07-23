'use strict';

// Silence structured console output during tests unless VERBOSE_TESTS is set, so the
// provisioner's operational logging does not clutter the Jest report.
if (!process.env.VERBOSE_TESTS) {
  const noop = () => {};
  jest.spyOn(console, 'log').mockImplementation(noop);
  jest.spyOn(console, 'info').mockImplementation(noop);
  jest.spyOn(console, 'warn').mockImplementation(noop);
  jest.spyOn(console, 'error').mockImplementation(noop);
  jest.spyOn(console, 'debug').mockImplementation(noop);
}
