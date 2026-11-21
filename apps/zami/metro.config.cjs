// Expo's Metro config. The app's own code is small (the shell); Zam's code is in the web
// app, which Vite builds (@-/com.leonsilicon.zami.web).
const { getDefaultConfig } = require("expo/metro-config");

module.exports = getDefaultConfig(__dirname);
