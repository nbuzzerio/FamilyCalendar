# Family Calendar

Minimal React/Vite/TypeScript scaffold prepared on Windows for Phase 7B review.
The eventual private Dellbox deployment is future work. Events are stored in this
browser's localStorage; there is no authentication, backend, sync or hosting setup.

## Events

Use Add event to create an event with a title, local calendar date, and optional
local time. Leave time blank for an all-day event. The weekly calendar displays
events on their saved dates, with all-day events first, followed by timed events
in ascending time order. Existing date-only events remain all-day events. Upcoming
and past events have Edit and Delete controls. Events survive refresh in the same
browser profile. Clearing browser storage removes them. Storage failures display
an error without reporting a successful save.

Use Previous week and Next week to browse the calendar, or This week to return
to the current week. Edit and Delete controls are available on calendar events
and event lists. Editing focuses the form; Save event persists the changes, while
Cancel leaves the saved event unchanged. Upcoming Events always shows saved events
from today onward, ordered by date and time, independently of the selected week.

`src/events.ts` exports the typed event model and a store with `create`, `update`,
`delete` and `list` operations. Dates stay as `YYYY-MM-DD` strings without UTC
conversion. Invalid stored JSON is treated as empty; invalid or duplicate records
are skipped. `pnpm test` exercises persistence, CRUD, validation and storage errors
using Node's built-in runner without additional dependencies.

## Pinned tools

Node 24.18.0; pnpm 11.9.0; React/React DOM 19.2.4; TypeScript 5.9.3;
Vite 7.3.6; @types/react 19.2.18; @types/react-dom 19.2.5.
`package.json` declares the exact package manager version, and `pnpm-lock.yaml`
pins dependency versions and integrity. `tooling-pins.json` records the observed
Node image, pnpm CLI entrypoint/bundle, wrapper and current lockfile hashes.
Its `historical_npm_qualification` section preserves the original qualification
pins; those hashes and retained disposable paths are historical evidence.

The npm lockfile was converted with pnpm 11.9.0's supported `pnpm import` command
before retiring `package-lock.json`. All six direct dependencies and all 20
previously locked package versions and integrity hashes were preserved. The new
lockfile also records 51 optional platform packages omitted from the Windows npm
lockfile, including esbuild/Rollup variants, fsevents and Rollup's Linux lzma
dependency. Windows x64 installs 21 packages, including the additional optional
`@rollup/rollup-win32-x64-gnu@4.63.2` binary. No dependency upgrades were requested.

## Windows development commands

```powershell
pnpm.cmd install --frozen-lockfile --ignore-scripts
pnpm.cmd test
pnpm.cmd run typecheck
pnpm.cmd run build
pnpm.cmd run dev
```

Use Node 24.18.0 and the Node-based pnpm 11.9.0 CLI. A fresh frozen installation
with scripts disabled, all 27 tests, and the production build (including
typechecking) passed during migration. Installation may need public registry
access when the local cache is missing entries. The dev server binds 127.0.0.1;
browser/dev-server behavior was not revalidated during migration.

`pnpm-workspace.yaml` replaces the former npm-only settings file: pnpm 11 reads
non-registry configuration there rather than in `.npmrc`. It keeps strict engines,
exact dependency saves, installation scripts disabled, and audit/funding output
disabled. `nodeLinker: hoisted` preserves the top-level dependency paths required
by the existing wrapper, including its scheduler alias and preserved symlinks.
Retain this configuration alongside the lockfile; this is a single-package project.

The only installed package with an installation lifecycle script is esbuild
0.28.2. Its postinstall locates/validates the platform binary and can download a
fallback when it is missing. The locked `@esbuild/win32-x64` optional dependency
already supplies that binary; a native esbuild transform passed after the fresh
script-disabled install. The production wrapper disables esbuild transforms and
minification. No installation scripts were approved or enabled. Keep optional
dependencies enabled; other platforms were not tested.

For manual Studio toolchain enrollment, the observed executable paths are:

- Node: `C:\Program Files\nodejs\node.exe` (24.18.0).
- Node-based pnpm CLI: `C:\Users\nickb\AppData\Roaming\npm\node_modules\pnpm\bin\pnpm.mjs` (11.9.0).
- Interactive Windows shim: `C:\Users\nickb\AppData\Roaming\npm\pnpm.cmd`.

Select pnpm 11.9.0 for this repository and use `pnpm-lock.yaml` for frozen
installation, with installation scripts disabled and the hoisted layout retained.
The commands above are the recommended validation commands. For a Node-based CLI
runner, pass the `.mjs` entrypoint to Node; the `.cmd` shim is for a Windows shell.
Studio configuration and enrollment were not inspected or changed during migration.

## Historical scaffold qualification

The following evidence describes the original npm-based scaffold qualification,
not a fresh Studio qualification of the pnpm toolchain or the current source tree.

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

During that preparation, no Git repository was initialized or changed; no project
enrollment, coding grant, OAuth, provider call, elevation, Dellbox access or
protected Studio change occurred.
Review this preparation before separately authorizing any subsequent phase.
