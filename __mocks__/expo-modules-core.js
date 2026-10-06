// Expo's native bridge does not exist in Jest. Modules loaded through it get
// empty native objects.
class EventEmitter {
  addListener() {
    return {remove: () => undefined};
  }
  removeAllListeners() {}
  removeSubscription() {}
  emit() {}
}
class NativeModule extends EventEmitter {}
class SharedObject extends EventEmitter {}
class CodedError extends Error {}
class UnavailabilityError extends Error {}

const known = {
  __esModule: true,
  EventEmitter,
  NativeModule,
  SharedObject,
  CodedError,
  UnavailabilityError,
  Platform: {OS: 'android', select: options => options.android ?? options.default},
  NativeModulesProxy: {},
  requireNativeModule: () => ({}),
  requireOptionalNativeModule: () => null,
  requireNativeViewManager: () => () => null,
  registerWebModule: () => undefined,
  uuid: {v4: () => 'test-uuid'},
};

module.exports = new Proxy(known, {
  get: (target, key) => (key in target ? target[key] : undefined),
});
