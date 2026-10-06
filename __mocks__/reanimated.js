// A light stand-in for react-native-reanimated: values are plain objects and
// animations finish at once. Enough to render screens in tests.
const RN = require('react-native');

const identity = value => value;
const noop = () => undefined;
const Animated = {
  View: RN.View,
  Text: RN.Text,
  Image: RN.Image,
  ScrollView: RN.ScrollView,
  FlatList: RN.FlatList,
  createAnimatedComponent: component => component,
  addWhitelistedUIProps: noop,
  addWhitelistedNativeProps: noop,
};
const animation = {
  duration: () => animation,
  delay: () => animation,
  springify: () => animation,
  damping: () => animation,
  withCallback: () => animation,
};
// Shared values are read with .value or .get() and written with .set().
const makeShared = initial => ({
  value: initial,
  get() {
    return this.value;
  },
  set(next) {
    this.value = typeof next === 'function' ? next(this.value) : next;
  },
});

const known = {
  __esModule: true,
  default: Animated,
  ...Animated,
  useSharedValue: initial => makeShared(initial),
  useDerivedValue: fn => makeShared(fn()),
  useAnimatedStyle: fn => fn(),
  useAnimatedProps: fn => fn(),
  useAnimatedRef: () => ({current: null}),
  useAnimatedScrollHandler: () => noop,
  useAnimatedReaction: noop,
  withTiming: identity,
  withSpring: identity,
  withDecay: identity,
  withDelay: (_delay, value) => value,
  withRepeat: identity,
  withSequence: (...values) => values[values.length - 1],
  cancelAnimation: noop,
  runOnJS: fn => fn,
  runOnUI: fn => fn,
  interpolate: (_value, _input, output) => output[0],
  interpolateColor: (_value, _input, output) => output[0],
  Extrapolation: {CLAMP: 'clamp', EXTEND: 'extend', IDENTITY: 'identity'},
  Easing: new Proxy({}, {get: () => () => identity}),
  FadeIn: animation,
  FadeOut: animation,
  FadeInDown: animation,
  FadeInUp: animation,
  Layout: animation,
  LinearTransition: animation,
};

module.exports = new Proxy(known, {
  get: (target, key) => (key in target ? target[key] : identity),
});
