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

expected_images=$(
  LIVEKIT_RUNTIME_DIRECTORY="$runtime_directory" \
    docker compose -f "$bundle_directory/docker-compose.yaml" config --images | LC_ALL=C sort
)
running_images=$(
  ssh -o BatchMode=yes -o ConnectTimeout=10 "$ssh_target" '
    sudo -n docker ps --filter name=livekit- --format "{{.ID}}" \
      | xargs -r sudo -n docker inspect --format "{{.Config.Image}}" \
      | LC_ALL=C sort
  '
)
if [[ "$expected_images" != "$running_images" ]]; then
  echo "running LiveKit OCI digests differ from the repository lock" >&2
  exit 69
fi

redis_password=$(awk '$1 == "requirepass" { print substr($0, index($0, $2)) }' "$runtime_directory/redis.conf")
if [[ -z "$redis_password" ]]; then
  echo "rendered Redis password is missing" >&2
  exit 69
fi
printf '%s\n' "$redis_password" | ssh -o BatchMode=yes -o ConnectTimeout=10 "$ssh_target" '
  set -eu
  IFS= read -r password
  password_length=${#password}
  exec 3<>/dev/tcp/127.0.0.1/6379
  printf "*2\r\n\$4\r\nAUTH\r\n\$%d\r\n%s\r\n*1\r\n\$4\r\nPING\r\n" \
    "$password_length" "$password" >&3
  IFS= read -r auth_response <&3
  IFS= read -r ping_response <&3
  auth_response=$(printf "%s" "$auth_response" | tr -d "\r")
  ping_response=$(printf "%s" "$ping_response" | tr -d "\r")
  test "$auth_response" = +OK
  test "$ping_response" = +PONG
'
unset redis_password

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
  sudo -n ss -H -lnt "sport = :443" | grep -q .
  sudo -n ss -H -lnt "sport = :7881" | grep -q .
  sudo -n ss -H -lnt "sport = :5349" | grep -q .
  sudo -n ss -H -lnu "sport = :3478" | grep -q .
  ufw_verbose=$(sudo -n ufw status verbose)
  printf "%s\n" "$ufw_verbose" | grep -Fxq "Status: active"
  printf "%s\n" "$ufw_verbose" \
    | grep -Fxq "Default: deny (incoming), allow (outgoing), deny (routed)"
  test "$(sed -n "s/^IPV6=//p" /etc/default/ufw)" = yes
  ufw_rules=$(
    sudo -n ufw status numbered \
      | sed -n -E "s/^[[:space:]]*\[[^]]+\][[:space:]]+//p" \
      | sed -E "s/[[:space:]]+/ /g; s/[[:space:]]+$//"
  )
  expected_ufw_rules=$(printf "%s\n" \
    "22/tcp on tailscale0 ALLOW IN Anywhere # SSH over Tailscale only" \
    "80/tcp ALLOW IN Anywhere # ACME HTTP IPv4" \
    "443/tcp ALLOW IN Anywhere # LiveKit HTTPS and TURN TLS IPv4" \
    "7881/tcp ALLOW IN Anywhere # LiveKit ICE TCP IPv4" \
    "3478/udp ALLOW IN Anywhere # LiveKit TURN UDP IPv4" \
    "50000:60000/udp ALLOW IN Anywhere # LiveKit ICE UDP IPv4" \
    "22/tcp (v6) on tailscale0 ALLOW IN Anywhere (v6) # SSH over Tailscale only")
  test "$ufw_rules" = "$expected_ufw_rules"
  sudo -n docker ps --format "{{.Names}}|{{.Image}}|{{.Status}}"
'

echo "LiveKit owner source reproduces runtime; public endpoint, DNS, TLS, Tailscale SSH, UFW, systemd, Redis authentication, pinned OCI digests, ICE/TCP and TURN listeners, API, Egress health, and containers are healthy"
