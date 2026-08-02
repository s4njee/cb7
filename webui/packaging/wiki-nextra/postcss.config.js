// Nextra ships its theme CSS precompiled, so this site needs no PostCSS plugins.
// A present (even empty) config is also what stops postcss-load-config from
// searching UP the tree and picking up the parent webui/postcss.config.js, which
// pulls in tailwindcss + autoprefixer. Those resolve from webui/node_modules in a
// local checkout but are absent in CI (which installs only this package, with
// --ignore-workspace), so the leak breaks the GitHub Pages build. Keep this here.
module.exports = { plugins: {} }
