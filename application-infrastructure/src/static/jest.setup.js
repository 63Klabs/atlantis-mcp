// Console suppression for static site tests
if (!process.env.VERBOSE_TESTS) {
  const noop = () => {};
  global.console = {
    ...console,
    log: noop,
    info: noop,
    warn: noop,
    error: noop,
    debug: noop
  };
}
