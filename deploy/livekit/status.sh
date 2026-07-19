#!/usr/bin/env bash
set -euo pipefail

bundle_directory=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repository_root=$(cd -- "$bundle_directory/../.." && pwd)
secret_file=${LIVEKIT_SECRET_FILE:-"$repository_root/.env.livekit"}
ssh_target=${LIVEKIT_SSH_TARGET:-ubuntu@100.101.110.42}

temporary_directory=$(mktemp -d /tmp/praximo-livekit-status.XXXXXX)
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
local_runtime_hashes=$(
  cd "$runtime_directory"
  sha256sum caddy.yaml egress.yaml livekit.yaml redis.conf | awk '{ print $1 }'
)
remote_runtime_hashes=$(
  ssh -o BatchMode=yes -o ConnectTimeout=10 "$ssh_target" \
    'sudo -n sha256sum /opt/livekit/runtime/caddy.yaml /opt/livekit/runtime/egress.yaml /opt/livekit/runtime/livekit.yaml /opt/livekit/runtime/redis.conf' \
    | awk '{ print $1 }'
)
if [[ "$local_runtime_hashes" != "$remote_runtime_hashes" ]]; then
  echo "local owner source does not reproduce the live runtime configuration" >&2
  exit 69
fi

room_response=$(curl -fsS --max-time 10 https://room.praximo.io/)
if [[ "$room_response" != OK ]]; then
  echo "unexpected room endpoint response" >&2
  exit 69
fi

room_ipv4=$(dig +short A room.praximo.io | paste -sd, -)
room_ipv6=$(dig +short AAAA room.praximo.io | paste -sd, -)
if [[ "$room_ipv4" != 135.125.175.57 || -n "$room_ipv6" ]]; then
  echo "LiveKit DNS contract drifted: A=$room_ipv4 AAAA=$room_ipv6" >&2
  exit 69
fi

for hostname in room.praximo.io turn.praximo.io; do
  certificate_subject=$(
    echo | openssl s_client -connect "$hostname:443" -servername "$hostname" 2>/dev/null \
      | openssl x509 -noout -subject
  )
  if [[ "$certificate_subject" != *"CN = $hostname"* && "$certificate_subject" != *"CN=$hostname"* ]]; then
    echo "unexpected TLS certificate for $hostname: $certificate_subject" >&2
    exit 69
  fi
done

ssh -o BatchMode=yes -o ConnectTimeout=10 "$ssh_target" '
  set -eu
  test "$(hostname)" = praximo-livekit-ovh
  test "$(sudo -n systemctl is-active livekit-docker.service)" = active
  test "$(sudo -n stat -c %a /etc/livekit/livekit.env)" = 600
  test "$(sudo -n stat -c %U:%G /etc/livekit/livekit.env)" = root:root
  test "$(curl -fsS --max-time 5 http://127.0.0.1:7880/)" = OK
  curl -fsS --max-time 5 http://127.0.0.1:7981/ >/dev/null
  sudo -n docker ps --format "{{.Names}}|{{.Image}}|{{.Status}}"
'

echo "LiveKit owner source reproduces runtime; public endpoint, DNS, TLS, Tailscale SSH, systemd, API, Egress health, and containers are healthy"
