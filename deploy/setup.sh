#!/usr/bin/env bash
# One-time provisioning on Ubuntu, from an owner-reviewed copy of deploy/.
set -euo pipefail
[[ $EUID == 0 ]] || { echo "Run initial setup with sudo." >&2; exit 1; }
cd -- "$(dirname -- "$0")"
pub=${1:?Expected absolute path to fresh Calendar public key}
[[ $pub == /* && -f $pub ]]
ssh-keygen -lf "$pub" >/dev/null
read -r key_type key_data _ < "$pub"
[[ $key_type == ssh-ed25519 && $key_data =~ ^[A-Za-z0-9+/]+=*$ ]]
for file in receiver.py bundle.py calendar.nginx.conf; do test -s "$file"; done

account=calendar-deploy
account_home=/var/lib/calendar-deploy
root=/var/www/family-calendar
helpers=/usr/local/lib/family-calendar
snippet=/etc/nginx/snippets/family-calendar.conf
if getent passwd "$account" >/dev/null || getent group "$account" >/dev/null; then
  echo "Calendar account or group already exists. Inspect existing provisioning." >&2
  exit 1
fi
for path in "$account_home" "$root" "$helpers" "$snippet"; do
  if [[ -e $path || -L $path ]]; then echo "Already exists: $path" >&2; exit 1; fi
done

useradd --system --user-group --no-create-home --home-dir "$account_home" --shell /bin/sh "$account"
install -d -o root -g root -m 0755 "$account_home" "$account_home/.ssh" "$helpers"
install -o root -g root -m 0644 bundle.py receiver.py "$helpers/"
install -o root -g root -m 0644 calendar.nginx.conf "$snippet"
install -d -o "$account" -g "$account" -m 0755 "$root" "$root/releases"
printf 'restrict,command="/usr/bin/python3 -BEs /usr/local/lib/family-calendar/receiver.py receive" %s %s\n' \
  "$key_type" "$key_data" > "$account_home/.ssh/authorized_keys"
chmod 0644 "$account_home/.ssh/authorized_keys"
echo "Calendar paths and restricted public key installed. Include $snippet in the www HTTPS server."
