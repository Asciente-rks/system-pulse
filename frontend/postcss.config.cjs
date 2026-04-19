const tailwindPlugin = (() => {
  try {
    return require("@tailwindcss/postcss");
  } catch (e) {
    return require("tailwindcss");
  }
})();

module.exports = {
  plugins: [tailwindPlugin, require("autoprefixer")],
};
