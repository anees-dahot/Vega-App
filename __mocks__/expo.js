// The real "expo" package installs runtime globals (fetch, streams) that need
// the native runtime. Tests only need the few helpers apps import from it.
module.exports = {
  __esModule: true,
  registerRootComponent: () => undefined,
  requireNativeModule: () => ({}),
  requireOptionalNativeModule: () => null,
  reloadAppAsync: async () => undefined,
};
