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
are skipped. `npm test` exercises persistence, CRUD, validation and storage errors
using Node's built-in runner without additional dependencies.

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
