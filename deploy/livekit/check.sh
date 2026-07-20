#!/usr/bin/env bash
set -euo pipefail

bundle_directory=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repository_root=$(cd -- "$bundle_directory/../.." && pwd)
secret_file=${1:-"$repository_root/.env.livekit"}
control_plane_file=${LIVEKIT_CONTROL_PLANE_FILE:-"$repository_root/.env.livekit-control-plane"}

"$bundle_directory/check-secret-file.sh" \
  "$secret_file" \
  "$bundle_directory/livekit.env.example" \
  "LiveKit runtime recovery source"
"$bundle_directory/check-secret-file.sh" \
  "$control_plane_file" \
  "$bundle_directory/control-plane.env.example" \
  "LiveKit control-plane recovery source"

for script in bootstrap-host.sh check-secret-file.sh check.sh control-plane.sh install.sh ops.sh render-configs.sh status.sh; do
  bash -n "$bundle_directory/$script"
done

(
  cd "$bundle_directory"
  sha256sum --check sha256sums.txt
)

temporary_directory=$(mktemp -d)
runtime_directory="$temporary_directory/runtime"
cleanup() {
  for file in caddy.yaml egress.yaml livekit.yaml redis.conf; do
    if [[ -e "$runtime_directory/$file" ]]; then
      unlink "$runtime_directory/$file"
    fi
  done
  if [[ -d "$runtime_directory" ]]; then
    rmdir "$runtime_directory"
  fi
  rmdir "$temporary_directory"
}
trap cleanup EXIT

"$bundle_directory/render-configs.sh" "$secret_file" "$runtime_directory" >/dev/null

while IFS= read -r rendered_file; do
  if rendered_mode=$(stat -f '%Lp' "$rendered_file" 2>/dev/null); then
    :
  else
    rendered_mode=$(stat -c '%a' "$rendered_file")
  fi
  if [[ "$rendered_mode" != 600 ]]; then
    echo "rendered file is not mode 0600: $rendered_file" >&2
    exit 65
  fi
done < <(find "$runtime_directory" -type f -print)

LIVEKIT_RUNTIME_DIRECTORY="$runtime_directory" \
  docker compose -f "$bundle_directory/docker-compose.yaml" config --quiet

while IFS= read -r image; do
  if [[ "$image" != *@sha256:* ]]; then
    echo "Compose image is not pinned by digest: $image" >&2
    exit 65
  fi
done < <(
  LIVEKIT_RUNTIME_DIRECTORY="$runtime_directory" \
    docker compose -f "$bundle_directory/docker-compose.yaml" config --images
)

echo "LiveKit owner handoff is valid: exact runtime/control-plane secrets, mode 0600, checksums, rendering, and pinned Compose"
