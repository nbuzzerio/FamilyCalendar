# Family Calendar

Family Calendar is a local-first React application for events, dinner attendance, dinner plans and weekly groceries. It saves on this device using IndexedDB. After setup, it shares confirmed edits through the household's Personal Sync Service.

## Connect a browser

Open **Advanced sync settings** and export the complete local backup. Sign in with the household password if prompted, select an active shared Space and match Calendar Person labels to directory People. Check the consent box, download the comparison, then review and approve it. Same-ID differences have separate choices for this device and the shared copy. The header **Sync** button checks immediately. Saves, opening, reconnecting and returning to the app also trigger synchronization.

The version 3 backup includes the original Calendar storage strings, explicit attendance, hidden label references, current records and pending work. **Recover a backup** opens versions 1, 2 and 3 in an empty Calendar browser profile. Recovering a file requires another review before sharing. The build includes an offline app shell for returning to a previously opened Calendar.

## Using Calendar

Week, Month and 3 Months share the same source events. Dates and optional times use the local calendar. An event without a time is all day. Upcoming events are independent of the visible week. Editing or deleting an occurrence acts on the whole series. Notes, labels and their colors stay with their source records. Appearance and calendar view are preferences for this browser.

Dinner Roll Call uses the dinner roster's Monday through Sunday week. **Available (default)** clears an explicit answer. **Available**, **Unavailable** and **Unknown** each save a response for one diner and date. Removing a Person label from the roster preserves historical attendance.

Dinner plans preserve the cook as free text. Grocery rows group ingredient names across that dinner week and show each dated amount. Checkmarks synchronize per week. Removing an ingredient through a dinner edit clears its checkmark when the last dinner using it is removed from a fully loaded week.

See the [Personal Sync integration report](docs/PERSONAL_SYNC_INTEGRATION_REPORT.md) for the storage mapping, recovery procedure, local verification and release status.

For an interactive synthetic household, run `pnpm.cmd dev:sync`. The command builds Calendar, starts the local service and prints its loopback address and fixture password. Each launch creates a separate database under `.dev/sync-tests/`.

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
pnpm.cmd run test:sync
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

## Recurrence

Repeat supports Never (the default), Daily, Weekly, Monthly and Yearly. An optional
Repeat until date includes occurrences on that local date. Editing or deleting any
occurrence changes the whole series; the edit form retains its original start date.
Monthly and yearly rules clamp unavailable days without moving the original anchor
(January 31 returns to March 31; leap-day yearly rules return to February 29 in leap years).
Dates and optional wall-clock times remain local, including during DST changes.

IndexedDB stores one event per series with an optional recurrence rule and inclusive end date. Migration retains original source dates and raw historical entries that require review.

`expandEvents` takes an inclusive local-date range of at most 3660 days and returns
sorted occurrences without changing the stored series. Calendar views request only
their visible dates. Upcoming includes recurring occurrences through one year from
today; nonrecurring future events retain the existing unrestricted listing behavior.
