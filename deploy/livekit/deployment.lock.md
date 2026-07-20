# LiveKit VPS deployment lock

Resolved on 2026-07-11 for Ubuntu 26.04 LTS (`linux/amd64`). Mutable tags are labels only; OCI digests are the deployment identity.

## Host packages

| Package | Exact version | Hold |
|---|---|---|
| `docker-ce` | `5:29.6.1-1~ubuntu.26.04~resolute` | yes |
| `docker-ce-cli` | `5:29.6.1-1~ubuntu.26.04~resolute` | yes |
| `containerd.io` | `2.2.6-1~ubuntu.26.04~resolute` | yes |
| `docker-buildx-plugin` | `0.35.0-1~ubuntu.26.04~resolute` | yes |
| `docker-compose-plugin` | `5.3.1-1~ubuntu.26.04~resolute` | yes |
| `tailscale` | `1.98.8` | no |

Running kernel after the provisioning reboot: `7.0.0-27-generic`.

## Runtime images

| Component | Version label | Immutable OCI digest |
|---|---|---|
| LiveKit Server | `v1.13.3` | `livekit/livekit-server:v1.13.3@sha256:483b8b7b5b0654f91f1e8bdc7b46fcd37fd9911612ecf627f97e3185a89825bd` |
| LiveKit Egress | `v1.13.0` | `livekit/egress:v1.13.0@sha256:980ff439431df2c773573721ab6da19e15bdc1f049ab7cb80e87470bf174c12f` |
| Redis | `8.8.0-alpine` | `redis:8.8.0-alpine@sha256:9d317178eceac8454a2284a9e6df2466b93c745529947f0cd42a0fa9609d7005` |
| Caddy L4 | captured 2026-07-11 | `livekit/caddyl4:latest@sha256:9dd090159a6042a907dbff0ce9dda27a21d2a559dc7b03b60a8e6b1b60b8348e` |
| Praximo RoomComposite renderer | commit `eda2c73` | `ghcr.io/apshenichniy/praximo-livekit-template@sha256:b3d9b5c8fa01299c6de65a48a51f533df0e188d67a066280fa617e680f9831fd` |
| LiveKit generator, generation only | captured 2026-07-11 | `livekit/generate:latest@sha256:002258b0dbf2c0eda8ef187e93f5aa6857d8c0fa4e13a23547418637b7f90d8e` |

Renderer builder image: `oven/bun:1.3.13-slim@sha256:7e8ed3961db1cdedf17d516dda87948cfedbd294f53bf16462e5b57ed3fff0f1`.

## Caddy binary

The Caddy version and complete module inventory are captured during deployment with:

```bash
docker run --rm livekit/caddyl4:latest@sha256:9dd090159a6042a907dbff0ce9dda27a21d2a559dc7b03b60a8e6b1b60b8348e version
docker run --rm livekit/caddyl4:latest@sha256:9dd090159a6042a907dbff0ce9dda27a21d2a559dc7b03b60a8e6b1b60b8348e list-modules --packages
```

The locked binary reports Caddy `v2.11.3`, 133 standard modules and 41 non-standard modules. The complete captured inventory is in [`caddy-modules.txt`](./caddy-modules.txt). Required modules verified in the inventory are `caddy.adapters.yaml`, `layer4`, `layer4.handlers.proxy`, `layer4.handlers.tls`, `layer4.matchers.tls`, and `tls.certificates.automate`.

## State and restore locations

| State | Location | Restore requirement |
|---|---|---|
| Reviewed bundle | `/opt/livekit` | checkout/copy exact commit, then verify `sha256sums.txt` |
| Rendered secret configs | `/opt/livekit/runtime` (`root:GID 2000`, directory `0750`, files `0640`) | recreate with `render-configs.sh`; never back up to Git |
| Source secrets | `/etc/livekit/livekit.env` | root-only backup or password manager |
| Host kernel tuning | `/etc/sysctl.d/99-livekit.conf` | reinstall from the reviewed bundle |
| Caddy certificates/ACME account | `/var/lib/livekit/caddy` | persistent backup; otherwise certificates are reissued |
| Dedicated Redis data | `/var/lib/livekit/redis` (`999:1000`) | operational only; never product source of truth |
| R2 artifacts | `s3://praximo-prod-r2/recordings/` | durable recording output; not stored on the VPS |

The Docker socket is not mounted into any service. All services use host networking; the Compose file publishes no Docker ports.
