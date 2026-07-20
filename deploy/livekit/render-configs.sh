#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "usage: $0 SECRET_ENV_FILE [OUTPUT_DIRECTORY]" >&2
  exit 64
fi

secret_file=$1
source_directory=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
output_directory=${2:-"$source_directory/runtime"}

if [[ ! -r "$secret_file" ]]; then
  echo "secret environment file is not readable: $secret_file" >&2
  exit 66
fi

required=(
  LIVEKIT_API_KEY
  LIVEKIT_API_SECRET
  REDIS_PASSWORD
  R2_ACCESS_KEY_ID
  R2_SECRET_ACCESS_KEY
)

configured_names=$'\n'
configured_count=0
while IFS= read -r line || [[ -n "$line" ]]; do
  if [[ "$line" =~ ^[[:space:]]*$ || "$line" =~ ^[[:space:]]*# ]]; then
    continue
  fi
  if [[ ! "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.+)$ ]]; then
    echo "invalid dotenv entry in $secret_file" >&2
    exit 65
  fi
  name=${BASH_REMATCH[1]}
  value=${BASH_REMATCH[2]}
  case "$name" in
    LIVEKIT_API_KEY | LIVEKIT_API_SECRET | REDIS_PASSWORD | R2_ACCESS_KEY_ID | R2_SECRET_ACCESS_KEY) ;;
    *)
      echo "unexpected secret name: $name" >&2
      exit 65
      ;;
  esac
  if [[ "$configured_names" == *$'\n'"$name"$'\n'* ]]; then
    echo "duplicate required value: $name" >&2
    exit 65
  fi
  if [[ ! "$value" =~ ^[A-Za-z0-9._~+/=-]+$ ]]; then
    echo "unsupported character in $name" >&2
    exit 65
  fi
  printf -v "$name" '%s' "$value"
  configured_names+="$name"$'\n'
  ((configured_count += 1))
done <"$secret_file"

if [[ $configured_count -ne ${#required[@]} ]]; then
  echo "secret environment file must contain the exact five-key inventory" >&2
  exit 65
fi

for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "missing required value: $name" >&2
    exit 65
  fi
done

umask 077
mkdir -p "$output_directory"

render() {
  local source=$1
  local destination=$2
  local line
  while IFS= read -r line || [[ -n "$line" ]]; do
    line=${line//__LIVEKIT_API_KEY__/$LIVEKIT_API_KEY}
    line=${line//__LIVEKIT_API_SECRET__/$LIVEKIT_API_SECRET}
    line=${line//__REDIS_PASSWORD__/$REDIS_PASSWORD}
    line=${line//__R2_ACCESS_KEY_ID__/$R2_ACCESS_KEY_ID}
    line=${line//__R2_SECRET_ACCESS_KEY__/$R2_SECRET_ACCESS_KEY}
    printf '%s\n' "$line"
  done <"$source" >"$destination"
  chmod 600 "$destination"
}

install -m 600 "$source_directory/caddy.yaml" "$output_directory/caddy.yaml"
render "$source_directory/livekit.yaml" "$output_directory/livekit.yaml"
render "$source_directory/egress.yaml" "$output_directory/egress.yaml"
render "$source_directory/redis.conf" "$output_directory/redis.conf"

if grep -R -n -E '__[A-Z0-9_]+__' "$output_directory" >/dev/null 2>&1; then
  echo "unrendered placeholder found in runtime configuration" >&2
  exit 65
fi

echo "rendered runtime configuration in $output_directory"
