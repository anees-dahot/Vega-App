/* eslint-env jest */
// Default for tests that load code using storage. The native MMKV module does
// not exist in Jest, so storage is an in-memory map. A test that needs
// something else mocks this module itself.
jest.mock('react-native-mmkv-storage', () => ({
  MMKVLoader: class {
    withInstanceID() {
      return this;
    }
    initialize() {
      const store = new Map();
      return {
        getString: key => (store.has(key) ? store.get(key) : undefined),
        setString: (key, value) => {
          store.set(key, value);
        },
        getBool: key => (store.has(key) ? store.get(key) : undefined),
        setBool: (key, value) => {
          store.set(key, value);
        },
        getInt: key => (store.has(key) ? store.get(key) : undefined),
        setInt: (key, value) => {
          store.set(key, value);
        },
        removeItem: key => {
          store.delete(key);
        },
        clearStore: () => store.clear(),
        indexer: {
          hasKey: key => store.has(key),
          getKeys: async () => Array.from(store.keys()),
        },
      };
    }
  },
}));

// The native file system module is not available in Jest.
jest.mock('@dr.pogodin/react-native-fs', () => ({
  CachesDirectoryPath: '/cache',
  DocumentDirectoryPath: '/documents',
  ExternalDirectoryPath: '/external',
  exists: jest.fn(async () => false),
  unlink: jest.fn(async () => undefined),
  readDir: jest.fn(async () => []),
  mkdir: jest.fn(async () => undefined),
  copyFile: jest.fn(async () => undefined),
  moveFile: jest.fn(async () => undefined),
  stat: jest.fn(async () => ({size: 0, isDirectory: () => false})),
  readFile: jest.fn(async () => ''),
  writeFile: jest.fn(async () => undefined),
}));

// Animations and gestures are native; their test setup comes with the libraries.
jest.mock('react-native-worklets', () => ({
  __esModule: true,
  runOnJS: fn => fn,
  runOnUI: fn => fn,
  scheduleOnRN: fn => fn,
  scheduleOnUI: fn => fn,
}));
require('react-native-gesture-handler/jestSetup');

// Screens read navigation state. Outside a navigator the hooks answer simply;
// the rest of the library stays real.
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  const navigation = {
    navigate: jest.fn(),
    goBack: jest.fn(),
    setOptions: jest.fn(),
    addListener: jest.fn(() => () => undefined),
    getParent: jest.fn(() => undefined),
    isFocused: jest.fn(() => true),
  };
  return {
    ...actual,
    useNavigation: () => navigation,
    useRoute: () => ({params: {}}),
    useIsFocused: () => true,
    useFocusEffect: () => undefined,
  };
});

jest.mock('react-native-haptic-feedback', () => ({
  __esModule: true,
  default: {trigger: jest.fn()},
  trigger: jest.fn(),
  HapticFeedbackTypes: {},
}));
