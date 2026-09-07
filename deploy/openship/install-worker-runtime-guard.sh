#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "install-worker-runtime-guard.sh must run as root" >&2
  exit 1
fi

root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
install -m 0755 "$root/worker-runtime-guard.py" /usr/local/sbin/lingxiloop-worker-runtime-guard
install -m 0644 "$root/lingxiloop-worker-runtime-guard.service" /etc/systemd/system/lingxiloop-worker-runtime-guard.service
systemctl daemon-reload
systemctl enable --now lingxiloop-worker-runtime-guard.service

# Installation is considered successful only when the live worker already
# satisfies the same contract the watcher will enforce after future refreshes.
/usr/local/sbin/lingxiloop-worker-runtime-guard --check
systemctl --quiet is-active lingxiloop-worker-runtime-guard.service
echo "LingxiLoop worker runtime guard installed and active"
