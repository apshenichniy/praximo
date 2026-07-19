#!/usr/bin/env bash
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "bootstrap-host.sh must run as root" >&2
  exit 77
fi

if [[ $# -ne 1 ]]; then
  echo "usage: $0 TAILSCALE_AUTH_KEY_FILE" >&2
  exit 64
fi

tailscale_auth_key_file=$1
if [[ ! -s "$tailscale_auth_key_file" ]]; then
  echo "Tailscale auth key file is missing or empty" >&2
  exit 66
fi

source_directory=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
owner_public_key_file="$source_directory/owner-authorized-key.pub"
if [[ ! -s "$owner_public_key_file" ]]; then
  echo "committed owner public key is missing" >&2
  exit 66
fi

source /etc/os-release
if [[ ${ID:-} != ubuntu || ${VERSION_CODENAME:-} != resolute ]]; then
  echo "this lock supports Ubuntu 26.04 (resolute) only" >&2
  exit 65
fi

if [[ $(dpkg --print-architecture) != amd64 ]]; then
  echo "this lock supports amd64 only" >&2
  exit 65
fi

export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a

apt-get update
apt-get -y dist-upgrade
apt-get install -y ca-certificates curl ufw

install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod 0644 /etc/apt/keyrings/docker.asc
cat >/etc/apt/sources.list.d/docker.list <<'EOF'
deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu resolute stable
EOF

curl -fsSL https://pkgs.tailscale.com/stable/ubuntu/resolute.noarmor.gpg \
  -o /usr/share/keyrings/tailscale-archive-keyring.gpg
curl -fsSL https://pkgs.tailscale.com/stable/ubuntu/resolute.tailscale-keyring.list \
  -o /etc/apt/sources.list.d/tailscale.list

apt-get update
apt-get install -y \
  containerd.io='2.2.6-1~ubuntu.26.04~resolute' \
  docker-buildx-plugin='0.35.0-1~ubuntu.26.04~resolute' \
  docker-ce='5:29.6.1-1~ubuntu.26.04~resolute' \
  docker-ce-cli='5:29.6.1-1~ubuntu.26.04~resolute' \
  docker-compose-plugin='5.3.1-1~ubuntu.26.04~resolute' \
  tailscale='1.98.8'

apt-mark hold containerd.io docker-buildx-plugin docker-ce docker-ce-cli docker-compose-plugin
systemctl enable --now docker tailscaled
hostnamectl set-hostname praximo-livekit-ovh
timedatectl set-timezone Etc/UTC
timedatectl set-ntp true
tailscale up \
  --auth-key="file:$tailscale_auth_key_file" \
  --hostname=praximo-livekit-ovh
rm -f "$tailscale_auth_key_file"

rm -f /etc/ssh/sshd_config.d/99-praximo-hardening.conf
cat >/etc/ssh/sshd_config.d/00-praximo-hardening.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
PubkeyAuthentication yes
EOF

bootstrap_user=${SUDO_USER:-ubuntu}
bootstrap_home=$(getent passwd "$bootstrap_user" | cut -d: -f6)
if [[ -z "$bootstrap_home" || ! -s "$bootstrap_home/.ssh/authorized_keys" ]]; then
  echo "refusing to lock password before an SSH public key is installed for $bootstrap_user" >&2
  exit 67
fi
owner_key_material=$(awk 'NR == 1 { print $1 " " $2 }' "$owner_public_key_file")
if ! awk '{ print $1 " " $2 }' "$bootstrap_home/.ssh/authorized_keys" \
  | grep -Fqx "$owner_key_material"; then
  echo "refusing to lock password before the committed owner key is authorized" >&2
  exit 67
fi
passwd -l "$bootstrap_user"
sshd -t
systemctl reload ssh

sed -i 's/^IPV6=.*/IPV6=yes/' /etc/default/ufw
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow in on tailscale0 to any port 22 proto tcp comment 'SSH over Tailscale only'
ufw allow proto tcp from 0.0.0.0/0 to any port 80 comment 'ACME HTTP IPv4'
ufw allow proto tcp from 0.0.0.0/0 to any port 443 comment 'LiveKit HTTPS and TURN TLS IPv4'
ufw allow proto tcp from 0.0.0.0/0 to any port 7881 comment 'LiveKit ICE TCP IPv4'
ufw allow proto udp from 0.0.0.0/0 to any port 3478 comment 'LiveKit TURN UDP IPv4'
ufw allow proto udp from 0.0.0.0/0 to any port 50000:60000 comment 'LiveKit ICE UDP IPv4'
ufw --force enable

echo "host bootstrap complete; reboot before installing the LiveKit bundle"
