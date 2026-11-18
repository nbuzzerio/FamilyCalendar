#!/usr/bin/env bash
set -euo pipefail
: "${CALENDAR_DEPLOY_KEY:?Missing calendar-production secret CALENDAR_DEPLOY_KEY}"
: "${CALENDAR_SSH_HOST:?Missing CALENDAR_SSH_HOST}" "${CALENDAR_SSH_PORT:?Missing CALENDAR_SSH_PORT}"
: "${CALENDAR_SSH_HOST_KEY:?Missing CALENDAR_SSH_HOST_KEY}" "${ARTIFACT_SHA256:?Missing CI artifact digest}"
[[ "$CALENDAR_SSH_HOST" =~ ^[A-Za-z0-9][A-Za-z0-9.-]*$ ]] || { echo "Invalid SSH hostname" >&2; exit 1; }
if ! [[ "$CALENDAR_SSH_PORT" =~ ^[1-9][0-9]{0,4}$ ]] || (( CALENDAR_SSH_PORT > 65535 )); then
  echo "Invalid SSH port" >&2
  exit 1
fi
[[ "$CALENDAR_SSH_HOST_KEY" =~ ^ssh-ed25519\ [A-Za-z0-9+/]+=*$ ]] || { echo "Expected one pinned ED25519 public key" >&2; exit 1; }
[[ "$GITHUB_SHA" =~ ^[0-9a-f]{40}$ && "$ARTIFACT_SHA256" =~ ^[0-9a-f]{64}$ ]]
printf '%s  %s\n' "$ARTIFACT_SHA256" "$1" | sha256sum --check --status

umask 077
keys=$(mktemp -d)
trap 'rm -f "$keys/id" "$keys/known_hosts"; rmdir "$keys"' EXIT
printf '%s\n' "$CALENDAR_DEPLOY_KEY" | tr -d '\r' > "$keys/id"
unset CALENDAR_DEPLOY_KEY
printf 'calendar-droplet %s\n' "$CALENDAR_SSH_HOST_KEY" > "$keys/known_hosts"
ssh-keygen -lf "$keys/known_hosts" >/dev/null

# Concurrency serializes deploy jobs, but GitHub does not order them by push time.
head_sha=$(gh api "repos/$GITHUB_REPOSITORY/git/ref/heads/main" --jq '.object.sha')
[[ "$head_sha" == "$GITHUB_SHA" ]] || { echo "Superseded commit. Deploy the current main run." >&2; exit 1; }
unset GH_TOKEN
ssh -T -F /dev/null -i "$keys/id" -p "$CALENDAR_SSH_PORT" \
  -o StrictHostKeyChecking=yes -o HostKeyAlias=calendar-droplet -o HostKeyAlgorithms=ssh-ed25519 \
  -o GlobalKnownHostsFile=/dev/null -o "UserKnownHostsFile=$keys/known_hosts" \
  -o BatchMode=yes -o IdentitiesOnly=yes -o PreferredAuthentications=publickey \
  -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=3 \
  "calendar-deploy@$CALENDAR_SSH_HOST" "publish $GITHUB_SHA $ARTIFACT_SHA256" < "$1"
