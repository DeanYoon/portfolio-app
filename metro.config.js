const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// victory-native 36.x depends on victory-vendor, which uses package exports.
// Newer versions of Metro/Expo can have trouble resolving these without special handling.
config.resolver.unstable_enablePackageExports = true;

module.exports = config;
