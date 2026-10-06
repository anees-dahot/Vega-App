module.exports = {
  preset: '@react-native/jest-preset',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: {
    '^@expo/ui/jetpack-compose$':
      '<rootDir>/__mocks__/expo-ui-jetpack-compose.js',
    '^@expo/ui/jetpack-compose/modifiers$':
      '<rootDir>/__mocks__/expo-ui-jetpack-compose-modifiers.js',
    '\\.css$': '<rootDir>/__mocks__/style-mock.js',
    '^@expo/vector-icons(/.*)?$': '<rootDir>/__mocks__/vector-icons.js',
    '^react-native-reanimated$': '<rootDir>/__mocks__/reanimated.js',
    '^expo-modules-core$': '<rootDir>/__mocks__/expo-modules-core.js',
    '^expo$': '<rootDir>/__mocks__/expo.js',
    '^expo-constants$': '<rootDir>/__mocks__/expo-constants.js',
    '^expo-crypto$': '<rootDir>/__mocks__/expo-crypto.js',
    '^expo-file-system(/legacy)?$': '<rootDir>/__mocks__/expo-file-system.js',
    '^@notifee/react-native$': '<rootDir>/__mocks__/notifee.js',
    '^(react-native-webview|react-native-video|react-native-google-cast|react-native-orientation-locker|react-native-fullscreen-chz|react-native-bootsplash|react-native-permissions|react-native-linear-gradient|@react-native-community/blur|react-native-edge-to-edge|@preeternal/react-native-cookie-manager|react-native-image-colors|expo-video-thumbnails|expo-brightness|expo-navigation-bar|expo-system-ui|expo-intent-launcher|expo-document-picker|expo-application|expo-updates|react-native-volume-manager|react-native-fs)$': '<rootDir>/__mocks__/native-stub.js',
  },
  // Packages that ship ES modules must be transformed too.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-navigation|expo(nent)?|@expo(nent)?|expo-[^/]+|react-native-[^/]+|@shopify/flash-list|@gorhom|@notifee|@tanstack|@dr.pogodin|@preeternal|@react-native-tvos|@himanshu8443|memoize-one|nativewind)/)',
  ],
};
