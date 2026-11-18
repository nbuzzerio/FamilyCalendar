# Family Calendar · Personal Sync Service V1

November 18, 2026

Family Calendar now saves on the device first and shares all five Calendar record kinds after explicit connection and reconciliation. A confirmed attendance change reaches another browser through its next poll or the header **Sync** button. Both devices can work offline.

| Release state | Assessment |
| --- | --- |
| IMPLEMENTED | Calendar persistence, migration, household login, shared Space setup, directory mapping, two-way exchange, conflict review, offline shell and recovery. |
| TESTED LOCALLY | Production build and typecheck, 79 Node regression tests and eight Chromium integration journeys against the real service and synthetic SQLite databases. |
| HUMAN QA PENDING | Owner review of the daily interaction, identity choices and readable comparisons on the intended physical PC and phone. |
| READY TO COMMIT | Yes, for owner review. The working tree is unstaged. |
| READY TO DEPLOY | Conditional. The client can enter the fast owner-approved release workflow once the production Calendar validators and canonical static hosting path are confirmed. |
| READY FOR REAL-DATA SYNC | Pending. The owner still needs a saved backup from each existing profile and a review of its actual identities, held records and first comparison. |

## Original architecture and migration

The React/Vite application kept five independently writable localStorage collections. Week, Month, 3 Months and Upcoming expanded events in memory. The event and label readers filtered invalid and duplicate entries. A single malformed response could make the entire attendance store unreadable. Loading the old grocery checklist could prune checkmarks. Portable backups v1 and v2 omitted roll call. The repository had a pinned static build and Node tests, with no service worker or production deployment configuration.

| Original storage key | Retained source and new representation |
| --- | --- |
| `family-calendar.events.v1` | Original array. Each valid source event becomes an `event` under its existing ID. |
| `family-calendar.labels.v1` | Original array. Each valid label becomes a `label` under its existing ID. |
| `family-calendar.roll-call.v1` | Original date → Calendar label ID → explicit answer. Each answer initially retains the historical label identity. A confirmed mapping supplies the directory UUID. |
| `family-calendar.dinners.v1` | Original date map. One `dinner-plan` per date. |
| `family-calendar.groceries.v1` | Original Monday → checked-name array. One `grocery-checks` record per week, including checkmarks without a current display row. |
| `family-calendar-view` | Device-local calendar view. Its original string is included in the backup. |
| `family-calendar-theme` | Device-local appearance. Its original string is included in the backup. |

The first IndexedDB transaction captures every original string, including malformed JSON and the distinction between a missing key and an empty value. It also captures other Calendar-prefixed storage keys. It creates the device UUID, migrated rows and migration evidence together. An interrupted transaction can restart from the untouched originals. Current Calendar screens read and write synchronized content through IndexedDB. Only device preferences continue to use localStorage.

Unsupported entries remain recoverable in the raw backup. Duplicate IDs stay held. Invalid wire IDs can be corrected individually with an explicit choice. Correcting a label ID updates its event references and historical identity in the same transaction. If an older Calendar tab subsequently changes a legacy store, its new raw contents are journaled. Uploads for the affected kind wait for review while independent kinds continue.

## Record semantics

| Kind | Identity and behavior |
| --- | --- |
| `event` | The existing source ID travels with the original local date, optional wall-clock time, notes, label ID and compatible metadata. An absent time means all day. The source date anchors Never, Daily, Weekly, Monthly and Yearly recurrence. End dates are inclusive. Editing an occurrence opens its source series. |
| `label` | Name, Person or Category kind, six-digit color, metadata and existing ID survive. A Person label carries exactly one `label-person` link. A Category carries zero links with that role. Historical event references survive deletion and ordinary event editing. |
| `roll-call` | The wire ID is `YYYY-MM-DD:<directory Person UUID>`. Its value contains `availability` and the matching `attendee` association identifies the diner. Available, Unavailable and Unknown are three explicit values. **Available (default)** represents absence. Choosing it clears an existing response with a tombstone. One person's answer has its own version, even when several people answer for the same date. |
| `dinner-plan` | The ID is the local dinner date. Name, free-text cook, notes and ingredient names and amounts travel in the original plan. Removing the plan queues a deletion. Ingredient metadata follows identifiable ingredients during edits. Ambiguous removed metadata is retained in recovery evidence. |
| `grocery-checks` | The ID is the local Monday. The payload is `{"checked":["beans","brown rice"]}`. Calendar derives grocery rows and amounts from dinners. Reading a partial download preserves stored checkmarks. A confirmed dinner edit can remove a check for an ingredient it removed from the last applicable dinner in a fully loaded week. |

Historical and hidden attendance is visible to the mapping workflow, including answers for deleted or retyped labels. The owner selects a directory ID explicitly. Duplicate display names appear with their UUIDs. The owner can also explicitly create a directory Person. If two labels map to the same person and disagree for one date, the owner chooses the answer for that date. The source answers and decision are retained. Label conversion and removal leave the shared Person and historical attendance intact.

## Household, Space and first connection

On opening, the client restores the household session through relative `/api/v1/auth/session`. Login sends only the entered password to `/api/v1/auth/household-login`. Authenticated writes use the same-origin cookie and an in-memory CSRF token. A 401 calls for sign-in. A CSRF rejection clears the stale token for reacquisition. Passwords, cookies and CSRF tokens stay out of the database, exports and cross-tab messages.

The client paginates the People and Spaces directories and offers active shared Spaces. Creation saves an intent UUID before the online request so a retry can recover the original creation. The binding fixes the owner, app and Space for the lifetime of the local queue.

1. Export the v3 backup and save it privately. The connection screen requires a current export. The owner confirms the file was saved.
2. Restore the household session or sign in, select or create the intended shared Space, and confirm known Person matches. Unresolved identities can stay local while other records transfer.
3. Consent to a download for comparison. Each page uses an empty outgoing batch and is staged durably through the end of the snapshot.
4. Inspect local-only, shared-only, matching, held and divergent entries. Approving reconciliation authorizes eligible local records to upload. Same-ID differences and unsupported shared records remain available for separate review.

The next opening reuses the connection. Expiry, sign-out and pause keep the local Calendar, pending operations and original Space binding.

## Transactions, scheduling and conflicts

IndexedDB database `family-calendar-sync` has four stores. `settings` holds the device UUID, bindings, directory cache, confirmed Person mappings, consent, opaque cursors, local revision and retry/confirmation state. `records` holds canonical rows keyed by kind and ID, per-record local revisions, last server snapshots, conflict state and per-record outboxes. `staged` contains snapshot pages reduced to the latest state for each identity. `evidence` retains original sources, imported files, pre-reconciliation copies and conflict decisions.

An edit and its intent commit in one strict read/write transaction. Held or pre-consent edits have durable local intents. Sendable operations carry immutable UUIDs, payloads, associations and base versions. A successor waits for its predecessor's acknowledged version before its wire operation is materialized. Confirmed creates use a null base. The user's choice to restore a tombstone generates a fresh put with its current version and explicit resurrection.

The runner posts protocol 1 to `/api/v1/apps/family-calendar/exchange`. It bounds outgoing payloads at 65,536 UTF-8 bytes and batches at 32 operations and 900,000 operation bytes, leaving room for the envelope. Each pass takes at most six common-directory pages and twelve app pages. The app page size is 25. Acknowledgements, snapshots, outbox changes and cursor advancement commit together. After writes, a download-only exchange closes the catch-up cycle. **Synced** and its confirmation time require caught-up streams and resolved local work.

A Calendar-specific Web Lock serializes network passes across tabs. Committed edits wake a debounced runner. Opening, foregrounding, reconnecting and a visible one-minute poll also trigger checks. Manual **Sync** checks even with an empty queue. Cursor and acknowledgement writes refresh the UI without waking another upload loop. Network errors back off. The production build caches its scoped shell and static assets for offline reopening. API traffic bypasses the worker cache.

For a divergence, the app keeps the device choice, shared copy and queued edits. The comparison shows the event, availability, meal or checked items. A choice is checked against the displayed record before it is applied. A cursor reset starts a fresh staged download. Restored server absence and old-base operations require a decision before replay. Compatible independent records can continue after reconciliation.

## Recovery procedure

Open **Advanced sync settings → Export backup**. The v3 file includes the raw legacy storage, current records, associations, outboxes, versions, conflicts, cursors, staged downloads and recovery evidence.

Use **Recover a backup** in an empty Calendar browser profile. Keep the source profile intact. Recovery imports the current Calendar values and retains the entire original file, including every pending operation and alternative copy, as evidence. The recovered profile receives its own device UUID. An existing household/Space binding follows the data. Device preferences remain available in the raw file. Reconnecting requires a new export, consent and comparison. Reviewed writes use the recovered device's identity. Earlier v1/v2 files restore the data those formats contained. Attendance omitted from those exports can still be recovered from the original browser's raw store.

## Automated verification

For an interactive experience review, `pnpm.cmd dev:sync` starts a fresh synthetic household and prints its loopback address and fixture password.

Run `pnpm.cmd test` and `pnpm.cmd test:sync` from Family Calendar. The latter typechecks, builds the relative-path static application, packages its offline shell and runs Chromium against that build beneath a subpath. The harness reads the prepared sibling service's compiled modules and Workout's installed Playwright toolchain. Each journey starts a new household and SQLite database under ignored `.dev/sync-tests/`. Network tests use loopback and synthetic records.

| Suite | Coverage |
| --- | --- |
| 79 Node tests | Calendar navigation and dates, recurrence including DST and month-end anchors, forms, labels, dinner and grocery projections, appearance, raw backup bytes, download delivery helpers and storage errors. |
| Two-device daily use | Password-only sign-in, shared cookie restoration, consent, all five kinds, desktop and 390-pixel mobile viewports, offline reload, independent diners, tombstone/resurrection, series conflict, People rename, lost HTTP acknowledgement, expiry, concurrent tabs and idle traffic. |
| Interrupted migration | Transaction abort, retry, duplicate and malformed records, unknown storage, raw export and blank-profile recovery. |
| Pagination and restore | 57 staged entries, reload and opaque cursor reuse, actual service SQLite backup/restore, revoked session, preserved outbox and explicit resolution of records missing from the restored timeline. |
| Domain conflicts | Initial event collision, one attendee/date conflict, dinner edits, nested ingredient metadata, weekly checks and dinner deletion. |
| Historical identities | Duplicate display names, a retyped label, a removed label, differing attendance for one canonical diner and explicit per-date resolution. |
| Validation and batching | Lost shared-Space creation response, repeat creation, readable pre-contract schema, incompatible IDs, oversized payload isolation and multiple bounded UTF-8 uploads. |
| Poll and recovery | Visible-period pull, injected local transaction failure, draft retention, offline export containing a pending operation and reviewed recovery under a fresh device UUID. |
| Legacy imports and disconnect | v1/v2 restore, reviewed label-ID correction, explicit directory creation, pause/sign-out/reload, retained binding, Person-to-Category conversion and a later write by an older tab. |

The service's Windows backup helper reported its directory-durability fallback and skipped old-backup retention. The test verified the backup, restored it into a new synthetic database and completed client reconciliation.

## Files changed

| Files | Purpose |
| --- | --- |
| `src/sync/model.ts`, `database.ts`, `calendar-data.ts` | Protocol and row types, migration, transactions, edit commands and outbox. |
| `src/sync/api.ts`, `engine.ts`, `replication.ts`, `recovery.ts` | Same-origin transport, scheduling, reconciliation, identity review, export and recovery. |
| `src/SyncPanel.tsx`, `src/main.tsx`, `src/App.tsx`, `src/style.css` | Startup, header status, setup, advanced controls and Calendar bindings. |
| `src/DinnerRoster.tsx`, `src/DinnerRollCall.tsx`, `src/LabelManager.tsx`, `src/backup.ts` | Transactional form saves, explicit attendance/default semantics and raw backups. |
| `studio-tools/offline-shell.mjs`, `package.json` | Offline static packaging and the integration test command. The pinned Vite wrapper remains byte-identical. |
| `src/app.test.mjs`, `src/events.test.mjs`, `tests/local-service.mjs`, `tests/sync-browser.test.mjs` | Revised regression expectations, isolated backend fixture and automated browser journeys. |
| `README.md`, `docs/PERSONAL_SYNC_INTEGRATION_REPORT.md` | Current usage, reproduction instructions and release evidence. |

## Release limits and owner experience review

Production validator deployment, the canonical host's static path, real household data and physical-device behavior were outside local verification. The frontend needs HTTPS, IndexedDB and Web Locks for synchronization. Browser eviction or loss of a profile can remove its only unsent copy. Retained recovery history also consumes storage as a household Calendar grows. Raw corrupt values, ambiguous duplicates and unsupported future schemas can require inspection of the exported original. Desktop and mobile Chromium contexts do not establish iOS Safari behavior.

For the fast release workflow, build with `pnpm.cmd build` and publish the resulting relative-path static bundle on the canonical origin after confirming the backend validators. Existing release tooling must include the generated manifest, worker, registration script and hashed assets. The integration uses the existing API and database schema. Deployment and real household consent remain owner decisions.

- Does saving today's attendance on one physical device and tapping **Sync** on the other feel immediate and understandable?
- Are the default Available choice, an explicit Available answer and an Unknown answer clear on the phone?
- Can the owner identify same-name People and recognize the intended event or dinner choice in a comparison?
- Does the header stay unobtrusive in normal use, with backup and recovery easy to find when needed?
