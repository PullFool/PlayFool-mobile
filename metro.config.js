const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// youtubei.js (and a few others) use the modern package.json "exports" field
// with a "react-native" condition. Metro ignores it by default — enable it.
config.resolver.unstable_enablePackageExports = true;
config.resolver.unstable_conditionNames = ['react-native', 'browser', 'require'];

module.exports = config;
