# Family Calendar

Minimal React/Vite/TypeScript scaffold prepared on Windows for Phase 7B review.
The eventual private Dellbox deployment is future work. Events are stored in this
browser's localStorage; there is no authentication, backend, sync or hosting setup.

## Events

Use **Export backup** to download `family-calendar-backup-v1.json` containing
the saved event and label arrays in a `family-calendar-backup` envelope with
`version: 1`. All stored fields, IDs, colors, notes and recurrence definitions
are preserved; series are not expanded. Export reads saved browser data afresh,
including events outside the visible dates, and does not include unsaved edits
or appearance preferences. It never writes to storage. Invalid JSON, invalid
records or unavailable storage prevent export rather than producing a partial
backup. Missing storage keys export as empty arrays. Keep the file private.
When either dinner or grocery storage exists, export uses `version: 2` and
`family-calendar-backup-v2.json`, retaining event/label arrays and adding
`dinners` (date-to-plan records) and `groceries` (Monday-to-checked-name arrays).
Missing dinner/grocery keys become empty objects. Version 1 is unchanged when
both keys are absent. Consumers must explicitly support version 2. Export
validates all saved data and preserves checkoffs without reconciliation or writes.
This application provides export only; no import or restore is available.

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

## Dinner groceries

Calendar view choices (Week, Month and 3 Months) persist in
`family-calendar-view`. Invalid or unreadable preferences fall back to Week;
failed writes leave the chosen view usable and show an alert. Dinner navigation
uses **Current dinner week** to distinguish it from the calendar's Today action.
Follow-up component regressions verify all three view choices after remount,
invalid/denied storage, write-failure feedback and one Today-named button across
the calendar and dinner component output. These are not browser accessibility
tree or real page-reload assertions. Studio must rerun calendar-journey checks
28 (navigation/year boundaries) and 37 (appearance/view reload persistence)
after checkpointing. The recorded runner.cjs authorized-pin mismatch requires
Studio to reconcile its protected runner evidence; application changes cannot
resolve that verification preparation failure.

The Grocery checklist follows the selected **dinner week**. Ingredient names are
trimmed and compared case-insensitively; the first spelling in date/entry order
is displayed. Each original amount is shown with its dinner date, including
multiple entries on the same day. Amounts are never added or converted; missing
amounts say “Amount not specified”. Dinner changes update the checklist on save.

Native labeled checkboxes persist separately under `family-calendar.groceries.v1`,
as Monday date keys mapped to normalized ingredient names. Checkmarks survive
navigation/reload and remain while any dinner in that week needs the ingredient.
Successful reconciliation removes absent ingredients, so reintroducing them starts
unchecked. Checkmarks are included in version-2 portable exports. Malformed or
unavailable checkmark storage displays an alert and disables checkoff until a
successful reload/storage refresh, while dinner editing remains available. Neither
checkoff nor reconciliation writes dinner data. Failed reconciliation cannot
persist removal of stale checkmarks until storage becomes available again.

Automated coverage in `src/app.test.mjs` asserts exact deduplicated rows and dated
amounts, missing amounts, empty weeks, shared-ingredient retention, removal and
reintroduction, independent week state, checked/unchecked persistence after store
and component recreation, immediate form-save recalculation, corrupt storage
preservation, read/write failures, and dinner saves despite checkmark corruption.
Component assertions check native checkbox props, wrapping labels with ingredient
and week, disabled failure controls and visible errors. This harness executes the
component handlers but does not run a browser or accessibility tree.

Browser coverage remains **NOT_RUN** in this session: no browser tool is exposed,
and the enrolled Studio runner executes after checkpointing. The existing browser
contract does not name grocery assertions. Required additional browser assertions
are: actual labeled checkbox accessible names and Space-key toggling; real
localStorage persistence after page reload; week navigation isolation; edit/remove
recalculation with a shared ingredient; empty state; storage-denied alerts without
dinner loss; and narrow-screen wrapping/focus visibility. These are automated
verification gaps, not a human QA assignment. A separate owner decision is needed
to enroll grocery-specific browser coverage if the host suite cannot cover them;
no tooling or dependency changes are included here.

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

## Recurrence

Repeat supports Never (the default), Daily, Weekly, Monthly and Yearly. An optional
Repeat until date includes occurrences on that local date. Editing or deleting any
occurrence changes the whole series; the edit form retains its original start date.
Monthly and yearly rules clamp unavailable days without moving the original anchor
(January 31 returns to March 31; leap-day yearly rules return to February 29 in leap years).
Dates and optional wall-clock times remain local, including during DST changes.

The existing `family-calendar.events.v1` array stores one event per series, with an
optional `recurrence: { frequency, endDate? }` rule. Missing recurrence means Never;
no migration or occurrence records are written. Labels and their colors retain the
existing separate storage. Invalid rules and end dates before the start are rejected
before saving. Stored invalid records follow the existing skip-on-read behavior.

`expandEvents` takes an inclusive local-date range of at most 3660 days and returns
sorted occurrences without changing the stored series. Calendar views request only
their visible dates. Upcoming includes recurring occurrences through one year from
today; nonrecurring future events retain the existing unrestricted listing behavior.

## Portable backup integration regression

The multiweek component journey creates three dinners across two weeks, edits one,
clears another, checks groceries in both weeks, remounts, and asserts independent
saved plans and checks plus exact v2 export, event/label retention and zero export
writes. Additional assertions cover grocery-only exports, absent keys, corrupt
checks, preserved stale keys, v1 compatibility, and v1/v2 download filenames, MIME
type, clicks and cleanup. All component tests use the existing simulated hook
harness; remounting is not a real browser reload. Browser download delivery, real
reload persistence, layout at narrow widths, keyboard focus and accessibility-tree
behavior remain NOT_RUN pending the enrolled Studio runner. No browser execution
API is available in this ticket session. If the enrolled suites do not assert the
dinner/grocery journey and downloaded JSON, a separate owner decision is needed
to enroll those assertions; these are automated coverage gaps, not human QA tasks.
