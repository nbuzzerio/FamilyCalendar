# Family Calendar deployment

**Production address** · https://www.nickbuzzerio.com/apps/calendar/

A successful push to `nbuzzerio/FamilyCalendar` on `main` authorizes the release. GitHub builds and tests once. The Droplet receives those exact bytes over SSH, switches the Calendar directory atomically, then reads the site through its public HTTPS address. The deploy job succeeds only after verification. Initial host and GitHub setup are pending.

## Workflow and checks

The workflow is [ci-deploy.yml](../.github/workflows/ci-deploy.yml). Both jobs use GitHub-hosted Ubuntu runners, commit-pinned actions and a read-only repository token.

| Event | `check` | `deploy` |
| --- | --- | --- |
| Push to `main` | Runs | Runs automatically after success |
| Pull request targeting `main` | Runs on the proposed merge | Skipped |
| Actions → Calendar CI and deployment → Run workflow | Runs on the selected ref | Eligible only on the current `main` of the owner repository |

1. Install Node **24.18.0**, pnpm **11.9.0** and the frozen Calendar lockfile with dependency installation scripts disabled.
2. Run **79 Node regression tests**. `pnpm build` runs the TypeScript no-emit check before the pinned Vite wrapper and offline-shell generator.
3. Package the Vite manifest, its hashed dependencies, HTML, web manifest, worker and registration script. Verify entry links, stylesheet references, subpath, manifest start URL and scope, inventory and SHA-256 hashes. Local rebuilds can leave old hashed assets in `dist`. Only the current Vite graph enters the archive. Unaccounted non-asset files fail packaging.
4. Exercise release validation, SSH sender error handling, locking, retries, rollback and retention. Run the **packaged artifact** under the production Nginx snippet with a temporary loopback TLS certificate. Headless Chromium checks startup, Month navigation, online and offline reload, IndexedDB identity, sibling storage, cookie reuse, CSRF and worker scope. The API endpoints in this fixture contain synthetic responses. A stale HTTP 200 must trigger rollback.
5. Upload one `calendar.zip` artifact for seven days. It contains the complete current static bundle, including `.vite/manifest.json`, and a generated `release.json` with the full commit ID and file hashes. The deploy job checks the independently passed archive digest before SSH.

**Extended local verification.** From Calendar on Windows run `pnpm.cmd test:sync`. The eight Chromium journeys require the prepared sibling `personal-sync-service/dist/src` and its runtime dependencies, Workout's installed `@playwright/test` and its Chromium binary. Each uses loopback and a fresh synthetic SQLite database under Calendar's ignored `.dev/sync-tests/`. They exercise the actual service, five record kinds, reconciliation, offline edits, retries, conflicts, restore and multi-device behavior. These eight tests run locally. Hosted CI uses only Calendar and public dependencies. See the [integration report](PERSONAL_SYNC_INTEGRATION_REPORT.md).

## How a release is activated

[publish.sh](../deploy/publish.sh) checks the current GitHub `main` SHA immediately before upload, including on manual reruns. GitHub serializes the `calendar-production` deploy jobs with `cancel-in-progress: false`. GitHub may replace an older pending job with a newer one. A stale run that reaches the sender fails before upload. An already-running publish can finish while a newer commit is being checked.

The dedicated `calendar-deploy` key can invoke only the root-installed [receiver](../deploy/receiver.py). The sole SSH operation is `publish COMMIT SHA256`, with the ZIP on stdin. The account owns this tree, has a locked password and needs no sudo, Node runtime, build tools or access to PSS.

```text
/var/www/family-calendar/
  releases/<40-character-git-sha>/
  current -> releases/<40-character-git-sha>
```

The receiver holds a nonblocking Linux `flock` across upload, validation, activation, public smoke and cleanup. A competing operator or deployment gets a failure. It accepts at most 32 MiB and 512 regular file entries, preserves Workout's 3 GiB free-space reserve beyond the upload size, and verifies checksum, allowed paths, inventory and file contents. It stages the release privately on the same filesystem and reads it back. A SHA already on disk must match byte for byte. An atomic symlink rename makes the complete release visible.

The smoke fetches the application directory, HTML, release marker, worker, manifest, registration script and every public asset. It requires trusted TLS, HTTP 200, matching content, correct MIME types and the worker's permitted scope. It rejects redirects and stale responses. The Droplet must be able to resolve and reach the canonical public URL itself. No health check opens Calendar in an authenticated browser or calls PSS.

If a new activation fails verification, the receiver restores the prior link while holding the lock and exits nonzero. A failed first activation removes the unverified link. A transaction marker lets the next locked invocation recover an interrupted switch. Up to five Calendar release directories are retained, including the just-replaced release. Cleanup is confined to recognized directories beneath Calendar's `releases/`. Ordinary deployments need neither an Nginx reload nor a database operation.

## One-time DigitalOcean setup

Use an authenticated DigitalOcean console or an already authenticated administrator PuTTY session. Repository inspection covered Workout, YTSO, Prelude and the PSS proxy reference. The live vhost, SSH endpoint and installed PSS revision still need owner verification.

### 1. Record the SSH endpoint and trusted public host key

Confirm the Droplet's reachable SSH hostname or IPv4 address and port from its configuration and firewall. The website hostname may point to a web proxy. Inspect the effective settings on the server.

```bash
sudo sshd -T | grep -E '^(port|hostkey|pubkeyauthentication|authorizedkeysfile|usepam) '
sudo ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub -E sha256
sudo awk '{print $1, $2}' /etc/ssh/ssh_host_ed25519_key.pub
```

Use the ED25519 file from the active `HostKey` directive if the host uses a custom path. Record the last command's two fields, `ssh-ed25519 BASE64`, through this authenticated channel. They become `CALENDAR_SSH_HOST_KEY`. The workflow pins these exact bytes using `HostKeyAlias=calendar-droplet` and `StrictHostKeyChecking=yes`. A key change requires independent confirmation and a variable update. SSH discovery on the CI network supplies no trust.

### 2. Create a Calendar-only automation key and install its public half

On the owner's Windows machine, from the FamilyCalendar repository in PowerShell, create a fresh key outside the checkout. At the passphrase prompts press Enter twice for this restricted automation identity.

```powershell
$key = Join-Path $env:USERPROFILE '.ssh\family-calendar-actions'
if (Test-Path -LiteralPath $key) { throw 'Choose a fresh Calendar key filename.' }
ssh-keygen -t ed25519 -C 'family-calendar-actions' -f $key
```

In the administrator session on the Droplet create a private staging directory.

```bash
mkdir -m 700 ~/calendar-ci-setup
```

Back in PowerShell, replace the two example connection values. Upload the public key and these four reviewed repository files using the administrator's authenticated SSH identity. PuTTY users can transfer the same files with PSCP or WinSCP using the same trusted endpoint.

```powershell
$admin = 'ADMIN@SSH_HOST'
$port = 22  # replace with the actual SSH port
scp -P $port "$key.pub" deploy/setup.sh deploy/receiver.py deploy/bundle.py deploy/calendar.nginx.conf "${admin}:calendar-ci-setup/"
```

On the Droplet run the one-time provisioner and verify ownership and the effective SSH policy.

```bash
cd ~/calendar-ci-setup
sudo bash ./setup.sh "$PWD/family-calendar-actions.pub"
id calendar-deploy
sudo passwd -S calendar-deploy
sudo ls -ld /var/lib/calendar-deploy{,/.ssh} /usr/local/lib/family-calendar /var/www/family-calendar{,/releases}
sudo sshd -T -C "user=calendar-deploy,host=$(hostname),addr=127.0.0.1" | grep -E '^(pubkeyauthentication|authorizedkeysfile|forcecommand|allowusers|denyusers) '
```

The account should have only its Calendar group, password status `L`, and public-key access through `.ssh/authorized_keys`. Check any source-address-dependent SSH policy against the actual runner route. The root-owned home and SSH directory are mode 0755. The root-owned mode-0644 `authorized_keys` contains only the new public key, with OpenSSH `restrict` and the forced Python receiver command. The root-owned helpers are mode 0644. The Calendar account owns its two mode-0755 deployment directories. Nginx reads released files. Existing accounts, keys, service files and SSH daemon configuration are outside the installer. If a name or path already exists, the installer stops before replacing it. Inspect the provisioned resources before resuming a partial setup.

### 3. Add the Calendar location to the existing www TLS vhost

Inspect `sudo nginx -T 2>&1 | less` privately. Identify the exact file and `server` block for **www.nickbuzzerio.com** on 443, its inherited MIME types, security headers, existing `/apps/` matching rules and `/api/v1/` proxy. Confirm there is no existing Calendar location, URL rewrite or broader `Service-Worker-Allowed` header. Preserve any security headers applied specifically in the existing shared apps location by including its reviewed header directives in the Calendar locations as needed. A broader inherited worker header needs a Calendar-only override, retaining the vhost's other headers.

Replace the placeholder with the actual existing vhost source file. Keep the backup outside Nginx include globs.

```bash
VHOST=/absolute/path/to/the/active/www-vhost.conf
sudo cp -a -- "$(readlink -f "$VHOST")" "/root/family-calendar-vhost-before-$(date +%Y%m%d-%H%M%S).conf"
sudoedit "$(readlink -f "$VHOST")"
```

Insert the following line **inside that HTTPS server block**. The installed [snippet](../deploy/calendar.nginx.conf) contains only Calendar locations. Its exact and `^~` prefixes take precedence over generic sibling-app regexes.

```nginx
include /etc/nginx/snippets/family-calendar.conf;
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

Retain the existing `http` MIME map, typically `include /etc/nginx/mime.types;`. The snippet serves the manifest as `application/manifest+json`, revalidates the shell, redirects Calendar's slashless URL and gives hashed assets a one-year cache lifetime. Missing files return 404. The internal Vite manifest is excluded from HTTP serving. A fresh installation serves 404 until the first release is active. Calendar has client-side view buttons at one URL, so reloading a view requests the same index. The apex redirect and the PSS reverse proxy keep their existing configuration.

## One-time GitHub setup

1. In **nbuzzerio/FamilyCalendar → Settings → Actions → General**, enable Actions and allow `actions/checkout`, `actions/setup-node`, `actions/upload-artifact` and `actions/download-artifact` at the full SHAs in the workflow. Read-only workflow permissions suffice. Keep fork PR write tokens and secrets disabled. Limit write access to `main` to trusted maintainers. For reviewed merges, the required CI job is `check`.
2. Under **Settings → Environments**, create **`calendar-production`**. Select **Selected branches and tags** and add exactly one **Branch** rule, **`main`**. Leave tags, PR refs, required reviewers, wait timers and custom approval rules empty. Save before adding the secret. GitHub's environment branch policy also protects the key if a same-repository PR edits its own workflow. Public repositories support this configuration. Private repositories need a plan supporting environment secrets and branch restrictions. [GitHub environment rules](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)
3. Set the following entries **on that environment**.

| Kind | Exact name | Value |
| --- | --- | --- |
| Secret | `CALENDAR_DEPLOY_KEY` | Complete, multiline **private** OpenSSH key generated above |
| Variable | `CALENDAR_SSH_HOST` | Confirmed SSH hostname or IPv4 address |
| Variable | `CALENDAR_SSH_PORT` | Actual port in decimal, e.g. `22` |
| Variable | `CALENDAR_SSH_HOST_KEY` | Exact `ssh-ed25519 BASE64` from the authenticated host console, without a comment |

To set the secret from the same PowerShell session with an already authenticated GitHub CLI, pipe it directly to GitHub. The command prints no private key.

```powershell
Get-Content -Raw -LiteralPath $key | gh secret set CALENDAR_DEPLOY_KEY --repo nbuzzerio/FamilyCalendar --env calendar-production
```

After successful secret entry, remove the temporary private key from the setup machine if GitHub is to hold the sole copy. The PSS repository key, household password and a personal access token have no role in this workflow. The CI job never references the environment. The private key enters only the final deploy step and its temporary mode-0600 SSH identity file is removed on exit.

## First release and household sync

Commit the reviewed Calendar changes and push to `main` after the one-time setup. In **Actions → Calendar CI and deployment**, check that both jobs are green. The receiver prints the verified full SHA and previous SHA. A read-only external confirmation is available with these commands in an owner shell.

```bash
curl -fsS https://www.nickbuzzerio.com/apps/calendar/release.json
curl -fsSI https://www.nickbuzzerio.com/apps/calendar/sw.js
```

Match `release.json.commit` to the successful run. The service worker registers relative to `/apps/calendar/`. Its scope and precache list cover Calendar files only. The browser rejects registrations targeting Workout and the API. IndexedDB, cache, lock, localStorage and channel names distinguish Calendar from Workout. Both apps share the www origin and its trust boundary. The PSS client restores the existing same-origin cookie, requests relative `/api/v1/` paths with `cache: no-store`, and supplies the in-memory CSRF token on authenticated writes.

**Before any real household connection**, have the service owner confirm the *running* PSS release contains the approved `family-calendar` validators for `event`, `label`, `roll-call`, `dinner-plan` and `grocery-checks`. Match the running immutable release to the private service's reviewed validator build/deployment record. With the reference systemd unit, these read-only commands identify its process and actual working directory.

```bash
systemctl show personal-sync -p MainPID -p ActiveEnterTimestamp -p WorkingDirectory
pid=$(systemctl show personal-sync -p MainPID --value)
test "$pid" -gt 0 && sudo readlink -f "/proc/$pid/cwd"
```

A static deployment or healthy API alone cannot establish the validator version. If a browser on this origin already has an approved Calendar binding, confirm the backend **before deploying** because that client can resume automatically. On each new connection, export and save the local backup, confirm identities and Space, consent to the download, inspect the comparison, then approve reconciliation. The release workflow grants none of those approvals. See the [first-connection procedure](PERSONAL_SYNC_INTEGRATION_REPORT.md).

## Rollback and recovery

In PuTTY, inspect the active target and retained releases. Use the known-good full SHA from a previous successful deployment. The command checks the expected active SHA under the same lock and verifies the restored site over HTTPS.

```bash
root=/var/www/family-calendar
readlink "$root/current"
ls -lt "$root/releases"
active=$(basename "$(readlink "$root/current")")
good=REPLACE_WITH_PREVIOUS_40_CHARACTER_SHA
sudo -u calendar-deploy /usr/bin/python3 -BEs /usr/local/lib/family-calendar/receiver.py rollback "$active" "$good"
```

On an SSH disconnect or host restart, inspect the job result and run the following in the administrator session. It acquires the lock, restores any interrupted transaction and prints the current SHA. A lock contention error means an operation is still running. Retry once it finishes. A subsequent deployment also performs this recovery.

```bash
sudo -u calendar-deploy /usr/bin/python3 -BEs /usr/local/lib/family-calendar/receiver.py recover
```

After a rollback, fix or revert the problem on `main` before the next deployment. A deployed worker may remain in previously open tabs until the browser applies its update. Close and reopen those tabs online. Preserve browser data and pending edits. For a failed first run, correct the reported secret, SSH, vhost or TLS problem and rerun on current `main`. After artifact expiry, rerun all jobs to produce another verified archive.

## Verification record · 18 November 2026

| Check | Observed result |
| --- | --- |
| Frozen install, typecheck, 79 Node regressions, pinned Vite build | Passed locally on Windows and in a clean Ubuntu 24.04 checkout |
| Production package, SHA-256, archive inventory and static references | Passed |
| Five Linux deployment tests | Passed, including truncated/corrupt uploads, failed first and later activation, retained previous release, contention, interrupted switch, scoped cleanup, missing secret, stale main and SSH failure propagation |
| Local Nginx 1.24 and Chromium, packaged site over HTTPS | Passed, including offline reload and rejection of excessive worker scopes. A stale HTTP 200 rolled back to a release verified through the same Nginx instance |
| Eight private-service Chromium journeys | All eight passed locally using synthetic databases |
| Workflow syntax and job boundaries | Passed actionlint 1.7.12 and a local evaluation of 32 event, ref and repository combinations. PR validation has no environment or secret references. Deploy depends on successful CI and an eligible main event |
| GitHub-hosted execution, production SSH and live vhost | Pending owner setup and first push. Local tests used disposable release directories, a synthetic API and loopback TLS |
| Running PSS validator revision | Pending independent owner confirmation before real household sync |

To replay ordinary CI on Ubuntu with Node and pnpm pinned as above, install Nginx, OpenSSL, Python 3.10+ and Chromium's system dependencies. Run these commands at the repository root.

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm test
pnpm build
python3 deploy/bundle.py dist calendar.zip "$(git rev-parse HEAD)"
python3 tests/test_release.py
pnpm exec playwright-core install --with-deps chromium --only-shell
python3 tests/nginx_smoke.py calendar.zip "$(git rev-parse HEAD)"
```
