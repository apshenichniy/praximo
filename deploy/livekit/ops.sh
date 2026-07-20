#!/usr/bin/env bash
set -euo pipefail

bundle_directory=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repository_root=$(cd -- "$bundle_directory/../.." && pwd)
secret_file=${LIVEKIT_SECRET_FILE:-"$repository_root/.env.livekit"}

"$bundle_directory/check.sh" "$secret_file" >/dev/null

exec bun --env-file="$secret_file" run "$bundle_directory/ops.ts" "$@"
