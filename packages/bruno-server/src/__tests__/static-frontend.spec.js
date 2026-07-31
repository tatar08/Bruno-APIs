const { injectRuntimeConfig } = require('../static-frontend');

describe('injectRuntimeConfig', () => {
  it('injects a script tag defining window.__BRUNO_RUNTIME_CONFIG__ before </head>', () => {
    const html = '<html><head><title>Bruno</title></head><body></body></html>';
    const result = injectRuntimeConfig(html, { basePath: '/bridge' });

    expect(result).toContain('<script>window.__BRUNO_RUNTIME_CONFIG__={"basePath":"/bridge"};</script></head>');
    expect(result.indexOf('__BRUNO_RUNTIME_CONFIG__')).toBeLessThan(result.indexOf('<body>'));
  });

  it('serializes the exact config object passed in, unmodified', () => {
    const html = '<head></head>';
    const result = injectRuntimeConfig(html, { basePath: '', extra: 42 });

    expect(result).toContain(JSON.stringify({ basePath: '', extra: 42 }));
  });

  it('prepends the script when there is no </head> tag to anchor on', () => {
    const html = '<body>no head here</body>';
    const result = injectRuntimeConfig(html, { basePath: '' });

    expect(result.startsWith('<script>window.__BRUNO_RUNTIME_CONFIG__={"basePath":""};</script>')).toBe(true);
  });

  it('leaves the rest of the document untouched', () => {
    const html = '<html><head><meta charset="utf-8"></head><body><div id="root"></div></body></html>';
    const result = injectRuntimeConfig(html, { basePath: '/x' });

    expect(result).toContain('<meta charset="utf-8">');
    expect(result).toContain('<div id="root"></div>');
  });
});
