/**
 * Static Frontend Helpers (Improvement.md P1.3)
 *
 * When the Bridge serves bruno-app's production build itself (instead of
 * the frontend being hosted separately), the build is static — it can't
 * know at build time whether it will be mounted at the origin root or
 * behind a reverse proxy path prefix. `injectRuntimeConfig` stamps that
 * information into `index.html` at request time, replacing the old dead
 * `window.__BRUNO_SERVER_PORT__` global that nothing ever set
 * (packages/bruno-app/src/utils/common/ipc-transport.js read it, but no
 * code anywhere wrote it).
 */

const injectRuntimeConfig = (html, runtimeConfig) => {
  const script = `<script>window.__BRUNO_RUNTIME_CONFIG__=${JSON.stringify(runtimeConfig)};</script>`;
  if (html.includes('</head>')) {
    return html.replace('</head>', `${script}</head>`);
  }
  // No <head> tag (e.g. a hand-rolled index.html) — prepend so the config is
  // still defined before any of the page's own scripts run.
  return script + html;
};

module.exports = { injectRuntimeConfig };
