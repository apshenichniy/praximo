#!/usr/bin/env bash
set -euo pipefail

bundle_directory=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repository_root=$(cd -- "$bundle_directory/../.." && pwd)
control_plane_file=${LIVEKIT_CONTROL_PLANE_FILE:-"$repository_root/.env.livekit-control-plane"}

"$bundle_directory/check-secret-file.sh" \
  "$control_plane_file" \
  "$bundle_directory/control-plane.env.example" \
  "LiveKit control-plane recovery source"

exec bun --env-file="$control_plane_file" run "$bundle_directory/control-plane.ts" "$@"
