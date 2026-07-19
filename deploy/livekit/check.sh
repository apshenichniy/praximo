#!/usr/bin/env bash
set -euo pipefail

bundle_directory=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repository_root=$(cd -- "$bundle_directory/../.." && pwd)
secret_file=${1:-"$repository_root/.env.livekit"}

required_keys=$(
  printf '%s\n' \
    LIVEKIT_API_KEY \
    LIVEKIT_API_SECRET \
    R2_ACCESS_KEY_ID \
    R2_SECRET_ACCESS_KEY \
    REDIS_PASSWORD \
    | LC_ALL=C sort
)

if [[ ! -r "$secret_file" ]]; then
  echo "LiveKit recovery source is not readable: $secret_file" >&2
  exit 66
fi

if mode=$(stat -f '%Lp' "$secret_file" 2>/dev/null); then
  :
else
  mode=$(stat -c '%a' "$secret_file")
fi

if [[ "$mode" != 600 ]]; then
  echo "LiveKit recovery source must have mode 0600: $secret_file" >&2
  exit 65
fi

actual_keys=$(
  awk -F= '
    /^[[:space:]]*($|#)/ { next }
    !/^[A-Za-z_][A-Za-z0-9_]*=/ {
      printf "invalid dotenv entry on line %d\n", NR > "/dev/stderr"
      invalid = 1
      next
    }
    {
      key = $1
      value = substr($0, index($0, "=") + 1)
      if (length(value) == 0) {
        printf "empty required value: %s\n", key > "/dev/stderr"
        invalid = 1
      }
      print key
    }
    END { if (invalid) exit 1 }
  ' "$secret_file" | LC_ALL=C sort
)

if [[ "$actual_keys" != "$required_keys" ]]; then
  echo "LiveKit recovery source must contain the exact five-key inventory" >&2
  echo "Expected names:" >&2
  printf '%s\n' "$required_keys" >&2
  echo "Actual names:" >&2
  printf '%s\n' "$actual_keys" >&2
  exit 65
fi

for script in bootstrap-host.sh check.sh install.sh render-configs.sh status.sh; do
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

echo "LiveKit owner handoff is valid: five secret names, mode 0600, checksums, rendering, and pinned Compose"
