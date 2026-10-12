# Family Calendar

Minimal React/Vite/TypeScript scaffold prepared on Windows for Phase 7B review.
The eventual private Dellbox deployment is future work. This placeholder has no
calendar storage, authentication, backend, server integration or hosting setup.

## Pinned tools

Node 24.18.0; npm 10.5.0; React/React DOM 19.2.4; TypeScript 5.9.3;
Vite 7.3.6; @types/react 19.2.18; @types/react-dom 19.2.5.
`package-lock.json` pins transitive package integrity. `tooling-pins.json` pins the
observed Node image, npm CLI, wrapper, lock and complete dependency inventory.

Dependencies were prepared only in disposable directories, using anonymous cached
public npm entries, `--offline --ignore-scripts --no-audit --no-fund`, and empty
fixture npm configuration. A separate locked `npm ci` reproduced package bytes.
No node_modules directory or build output was installed in this scaffold.

## Windows development commands for a later owner-run session

```powershell
npm.cmd ci --ignore-scripts --no-audit --no-fund
npm.cmd run typecheck
npm.cmd run build
npm.cmd run dev
```

Use the pinned Node/npm versions. These commands were not run against the target.
The dev server binds 127.0.0.1; browser/dev-server behavior has not been validated.
Dependency installation may need public network access when the owner's cache is
missing entries. No network installation was used during this preparation.

## Qualified validation

`studio-tools/vite-build.mjs` is an exact copy of Studio's existing pinned
in-process wrapper, not new infrastructure. The existing single-process,
zero-capability AppContainer validator ran `tsc --noEmit` and this wrapper against
disposable exports of these scaffold bytes. Source/tools stayed read-only;
only dist and scratch were writable. Reachable local fixture listeners verified
network denial. Profile cleanup was confirmed. TypeScript and CSS errors were
introduced only in disposable candidates and rejected by their actual tools.

The wrapper disables esbuild child-process transforms and minification. Custom
Vite/PostCSS configuration, project plugins and environment substitutions are
outside this qualification; no Vite config file is included.

`.validation/report.json` summarizes results. Other `.validation` files contain
the executed profile, exact source/output hashes, bounded stdout/stderr, and the
seven existing Vite profile/isolation test results. `replay-profile.json` points
to retained disposable tools and is inspection evidence, not authority.

No Git repository was initialized or changed; no project enrollment, coding grant,
OAuth, provider call, elevation, Dellbox access or protected Studio change occurred.
Review this preparation before separately authorizing any subsequent phase.
