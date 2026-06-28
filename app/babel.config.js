// Babel do app Expo. `babel-preset-expo` cobre React Native + JSX + TS.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
  };
};
