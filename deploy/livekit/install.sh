#!/usr/bin/env bash
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "install.sh must run as root" >&2
  exit 77
fi

if [[ $# -ne 1 ]]; then
  echo "usage: $0 SECRET_ENV_FILE" >&2
  exit 64
fi

source_directory=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
secret_file=$1

if [[ "$source_directory" != /opt/livekit ]]; then
  echo "copy this bundle to /opt/livekit before installing" >&2
  exit 72
fi

if ! getent group 2000 >/dev/null; then
  groupadd --system --gid 2000 livekit-config
fi

config_group=$(getent group 2000 | cut -d: -f1)

install -d -m 700 -o root -g root /etc/livekit /var/lib/livekit/caddy /var/lib/livekit/redis
if [[ $(realpath "$secret_file") != /etc/livekit/livekit.env ]]; then
  install -m 600 -o root -g root "$secret_file" /etc/livekit/livekit.env
fi
"$source_directory/render-configs.sh" /etc/livekit/livekit.env "$source_directory/runtime"
chown -R root:root "$source_directory" /etc/livekit /var/lib/livekit/caddy
chown root:"$config_group" "$source_directory/runtime" "$source_directory/runtime"/*
chmod 750 "$source_directory/runtime"
chmod 640 "$source_directory/runtime"/*
chmod 700 /etc/livekit /var/lib/livekit /var/lib/livekit/caddy /var/lib/livekit/redis
chown -R 999:1000 /var/lib/livekit/redis
install -m 644 -o root -g root "$source_directory/livekit-docker.service" /etc/systemd/system/livekit-docker.service
install -m 644 -o root -g root "$source_directory/livekit-sysctl.conf" /etc/sysctl.d/99-livekit.conf

(cd "$source_directory" && sha256sum --check sha256sums.txt)
docker compose -f "$source_directory/docker-compose.yaml" config --quiet
sysctl --system >/dev/null
systemctl daemon-reload
systemctl enable livekit-docker.service

echo "LiveKit bundle installed; start with: systemctl start livekit-docker.service"
