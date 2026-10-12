import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';

// Fail before libuv's global named-pipe retry loop. This is a compatibility
// guard, not isolation: the no-capability token and one-process Job still apply.
const denied = () => Object.assign(new Error('STUDIO_CHILD_PROCESS_DENIED'), {
  code: 'STUDIO_CHILD_PROCESS_DENIED'
});
for (const name of ['spawn', 'spawnSync', 'execSync', 'execFileSync', 'fork']) {
  childProcess[name] = () => { throw denied(); };
}
for (const name of ['exec', 'execFile']) {
  childProcess[name] = (...args) => {
    const callback = args.at(-1);
    if (typeof callback !== 'function') throw denied();
    const child = new EventEmitter();
    process.nextTick(() => callback(denied(), '', ''));
    return child;
  };
}
syncBuiltinESMExports();
const { readdirSync, readFileSync } = await import('node:fs');
// Do not silently qualify a different build by ignoring project plugin settings.
if (readdirSync(process.cwd()).some(n => /^(?:vite\.config|postcss\.config)(?:\.|$)|^\.postcssrc(?:\.|$)/i.test(n)) ||
    JSON.parse(readFileSync('package.json', 'utf8')).postcss != null) {
  throw new Error('STUDIO_VITE_PROJECT_CONFIG_UNQUALIFIED');
}
// Import exact pinned files, bypassing package self-references and bare-name
// resolution through project package.json or directories beside this wrapper.
const { build } = await import(new URL('../node_modules/vite/dist/node/index.js', import.meta.url));
const { default: ts } = await import(new URL('../node_modules/typescript/lib/typescript.js', import.meta.url));
const { fileURLToPath } = await import('node:url');
// React's package entrypoints branch on NODE_ENV. Select the reviewed production
// modules directly instead of invoking Vite's esbuild-backed define transform.
const alias = [
  ['react', 'react/cjs/react.production.js'],
  ['react/jsx-runtime', 'react/cjs/react-jsx-runtime.production.js'],
  ['react-dom', 'react-dom/cjs/react-dom.production.js'],
  ['react-dom/client', 'react-dom/cjs/react-dom-client.production.js'],
  ['scheduler', 'scheduler/cjs/scheduler.production.js']
].map(([name, file]) => ({ find: new RegExp('^' + name + '$'),
  replacement: fileURLToPath(new URL('../node_modules/' + file, import.meta.url)) }));
const typescript = {
  name: 'studio-typescript-v1', enforce: 'pre',
  transform(code, id) {
    const filename = id.split('?')[0];
    if (!/\.(ts|tsx)$/.test(filename) || filename.endsWith('.d.ts')) return null;
    const result = ts.transpileModule(code, {
      fileName: filename, reportDiagnostics: true,
      compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.ReactJSX, sourceMap: false, isolatedModules: true }
    });
    const errors = (result.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error);
    if (errors.length) this.error(ts.formatDiagnostics(errors, {
      getCurrentDirectory: () => process.cwd(), getCanonicalFileName: f => f, getNewLine: () => '\n'
    }));
    return { code: result.outputText, map: null };
  }
};
await build({
  root: process.cwd(), base: './', configFile: false, envFile: false, publicDir: false,
  cacheDir: '.studio-scratch/vite', esbuild: false,
  keepProcessEnv: true,
  resolve: { preserveSymlinks: true, alias }, plugins: [typescript],
  css: { postcss: { plugins: [] } },
  build: { outDir: 'dist', emptyOutDir: false, target: 'esnext', minify: false,
    cssMinify: false, assetsInlineLimit: 0, manifest: true, reportCompressedSize: false }
});
console.log('STUDIO_VITE_BUILD_V1:complete');
