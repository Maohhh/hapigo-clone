#!/usr/bin/env bash
set -euo pipefail

volume_name="${1:-Hapigo Clone}"
mount_dir="/Volumes/${volume_name}"

if [[ ! -d "${mount_dir}" ]]; then
  exit 0
fi

if ! mount | grep -F " on ${mount_dir} " >/dev/null; then
  echo "Found ${mount_dir}, but it is not a mounted volume; leaving it alone."
  exit 0
fi

echo "Detaching previously mounted DMG volume: ${mount_dir}"
if hdiutil detach "${mount_dir}"; then
  exit 0
fi

device="$(df -P "${mount_dir}" | awk 'NR == 2 { print $1 }')"
if [[ -n "${device}" ]]; then
  hdiutil detach "${device}"
else
  echo "Could not resolve device for ${mount_dir}" >&2
  exit 1
fi
