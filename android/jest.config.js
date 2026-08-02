module.exports = {
  preset: '@react-native/jest-preset',
  // The RN preset's default only whitelists react-native itself for
  // transforming; navigation and its native-module dependencies ship
  // untranspiled ESM too and need to be added to the same allow-list.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-navigation|react-native-.*)[^/]*/)',
  ],
  // react-native-gesture-handler ships its own Jest mock for the native
  // module it requires at import time; without it, any test that imports
  // App.tsx (which uses GestureHandlerRootView) fails outside a real app.
  setupFiles: ['./node_modules/react-native-gesture-handler/jestSetup.js'],
};
