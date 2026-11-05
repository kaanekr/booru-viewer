const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Run real project modules while substituting only their external boundaries.
exports.createLoader = function createLoader(mocks = {}, globals = {}) {
  const cache = new Map();
  function load(filename) {
    filename = path.resolve(filename);
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} };
    cache.set(filename, module);
    const js = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.React, esModuleInterop: true,
      },
    }).outputText;
    vm.runInNewContext(js, {
      module, exports: module.exports, console, setTimeout, clearTimeout,
      setInterval, clearInterval, URL, URLSearchParams, AbortController,
      ...globals,
      require(id) {
        if (Object.hasOwn(mocks, id)) return mocks[id];
        if (id.startsWith('.')) {
          const base = path.resolve(path.dirname(filename), id);
          const resolved = ['', '.ts', '.tsx'].map((ext) => base + ext).find((p) => fs.existsSync(p) && fs.statSync(p).isFile());
          if (resolved) return load(resolved);
        }
        throw new Error(`Unexpected dependency in ${filename}: ${id}`);
      },
    }, { filename });
    return module.exports;
  }
  return load;
};
