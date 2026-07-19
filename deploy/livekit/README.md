# LiveKit appliance maintenance

This directory is the owner source for the self-hosted Praximo LiveKit appliance. It is
self-contained: rebuild, upgrade, rollback, secret rotation, and diagnostics must not depend
on the former `praximo-bot` checkout.

The bundle contains placeholders only. Runtime files are rendered under `runtime/`, excluded
from Git, and installed with restricted permissions.

## Production contract

| Item | Value |
| --- | --- |
| Public LiveKit WebSocket | `wss://room.praximo.io` |
| HTTPS/API endpoint | `https://room.praximo.io` |
| TURN/TLS | `turn.praximo.io:443` |
| OVH IPv4 | `135.125.175.57` |
| Tailscale SSH | `ubuntu@100.101.110.42` |
| Tailscale MagicDNS | `praximo-livekit-ovh-1.tail4b6e77.ts.net` |
| Host | Ubuntu 26.04 LTS, `linux/amd64`, hostname `praximo-livekit-ovh` |
| R2 endpoint | `https://27940cd0d92bb3f03943a5378ccf68d3.eu.r2.cloudflarestorage.com` |
| R2 bucket / prefix | `praximo-prod-r2` / `recordings/` |

Exact package versions and OCI digests are in [deployment.lock.md](./deployment.lock.md).
The public bootstrap key is [owner-authorized-key.pub](./owner-authorized-key.pub). Its private
counterpart remains outside the repository at `~/.ssh/id_ed25519` and was verified to reach
the current appliance.

## Secret ownership

The repository-local recovery source is `<repo>/.env.livekit`. It is gitignored, mode `0600`,
and contains exactly:

- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `REDIS_PASSWORD`

The appliance copy is `/etc/livekit/livekit.env` (`root:root`, mode `0600`). Only a process
that needs the values may read either file. Never print values, place them in command
arguments, or send them to chat, logs, GitHub, or commits. The R2 pair and Redis password are
appliance-only. The LiveKit API pair may also be projected to an application secret store.

Two authorities cannot be recovered from this bundle and must be minted or accessed when
needed:

- a one-time, pre-authorized Tailscale key for `tag:ci`, supplied to `bootstrap-host.sh` in a
  root-only file and deleted by the script;
- OVH console/account access for a destructive reimage and Cloudflare account access for DNS
  or R2-token rotation.

These are external control-plane authorities, not missing static deployment data. Normal
maintenance uses the existing Tailscale node, SSH key, and five-key recovery source.

## Owner checks

Run before any maintenance:

```bash
bun run livekit:check
bun run livekit:status
```

`livekit:check` validates the exact key inventory and mode without printing values, verifies
the committed checksums, renders into a temporary private directory, checks every shell
script, and validates the pinned Compose model. `livekit:status` proves that the local owner
source renders byte-identically to the live runtime, then performs read-only public and remote
checks. Neither command prints secret contents.

The currently installed `/opt/livekit` source copy is checksum-valid but originates from the
older bundle commit `80dadb1`. Its rendered Egress config already uses the production R2
contract above. This repository is now canonical: the next maintenance deployment should
sync this bundle to `/opt/livekit` while no room is active.

## Public and private ports

| Port | Owner | Public policy |
| --- | --- | --- |
| `80/tcp` | Caddy ACME challenge listener | allow IPv4 |
| `443/tcp` | Caddy L4 HTTPS/WSS and TURN/TLS SNI edge | allow IPv4 |
| `7881/tcp` | LiveKit ICE/TCP | allow IPv4 |
| `3478/udp` | LiveKit TURN/UDP | allow IPv4 |
| `50000-60000/udp` | LiveKit ICE/UDP | allow IPv4 |
| `7880/tcp`, `5349/tcp`, `6379/tcp`, `6789/tcp`, `7980-7982/tcp`, `9090/tcp` | internal services | deny public |

All services use host networking and Compose publishes no ports. Do not publish AAAA records
until the IPv6 transport matrix is explicitly accepted. Some LiveKit/Egress listeners cannot
bind loopback independently and are kept private by both UFW and the OVH firewall.

## Clean-host rebuild

A rebuild destroys the VPS. Confirm the target host in OVH, drain active rooms, and preserve
the owner recovery file before starting.

1. Reinstall the existing VPS as Ubuntu 26.04 LTS (`amd64`). Inject
   `deploy/livekit/owner-authorized-key.pub` for the `ubuntu` user. Keep the existing IPv4 so
   DNS remains unchanged.
2. Create a one-time Tailscale auth key authorized for `tag:ci`. Transfer it to a root-only
   file on the host without placing the value in a shell argument.
3. Copy this directory to the host temporarily and run:

   ```bash
   sudo ./bootstrap-host.sh /path/to/tailscale-auth-key
   ```

   The script installs the locked host packages, configures UTC/NTP, validates the committed
   owner key, hardens SSH, enables UFW, joins Tailscale, and deletes the auth-key file. Reboot.
4. Confirm Tailscale SSH, then copy this directory to root-owned `/opt/livekit` without a
   `runtime/` directory. From `/opt/livekit`, run `sha256sum -c sha256sums.txt`.
5. Transfer the local recovery source over SSH standard input, not a command argument:

   ```bash
   ssh ubuntu@100.101.110.42 'umask 077; cat > /tmp/livekit.env' < .env.livekit
   ssh ubuntu@100.101.110.42 \
     'sudo install -m 600 -o root -g root /tmp/livekit.env /etc/livekit/livekit.env && rm /tmp/livekit.env'
   ```

6. Install and start the appliance:

   ```bash
   cd /opt/livekit
   sudo ./install.sh /etc/livekit/livekit.env
   sudo docker compose pull
   sudo systemctl start livekit-docker.service
   sudo systemctl status livekit-docker.service
   ```

7. Run `bun run livekit:status` locally. Then prove external DNS/TLS, direct ICE/UDP,
   ICE/TCP, TURN/UDP, and TURN/TLS.
8. Run an Egress canary into `praximo-prod-r2`. RoomComposite-to-R2 has historical evidence,
   but the current product requires two separate microphone Track Egress jobs. Do not accept
   rebuild completion until two Opus/OGG track objects are non-empty and their final metadata
   is verified in R2.

If Caddy state is absent, certificates are reissued. Redis data is operational coordination
state, not product source of truth. R2 is the durable recording store.

## Routine redeploy

Never redeploy during an active room.

1. Run `bun run livekit:check` and review the diff from the deployed bundle.
2. Copy the checksum-verified bundle to `/opt/livekit`, excluding `runtime/`.
3. Run `sudo ./install.sh /etc/livekit/livekit.env`.
4. Pull images and restart `livekit-docker.service`.
5. Run `bun run livekit:status` and the transport/Egress smoke appropriate to the change.

## Secret rotation

1. Rotate only one owning credential at a time. For R2, create an Object Read & Write token
   scoped only to `praximo-prod-r2`.
2. Update `<repo>/.env.livekit` locally, preserving its exact five-key inventory and mode
   `0600`.
3. Run `bun run livekit:check`.
4. Transfer the file through SSH standard input as shown in the rebuild flow, reinstall, and
   restart only while no room is active.
5. Prove LiveKit API access or Egress-to-R2 as appropriate, then revoke the old credential.
6. A LiveKit API key/secret rotation also requires updating the application's secret store.

## Upgrade and rollback

Change one runtime component at a time. Update its immutable digest and version label in
`deployment.lock.md`, regenerate `sha256sums.txt`, run owner checks, and rerun the full smoke
matrix after deployment.

Rollback uses a previous committed version of this directory and the unchanged root-only
secret file:

1. Drain rooms and stop new admissions.
2. restore the previous bundle commit and verify `sha256sums.txt`;
3. run `install.sh /etc/livekit/livekit.env`;
4. pull the locked images and restart `livekit-docker.service`;
5. repeat public status, all four transport paths, and Egress-to-R2.

Do not roll Redis back to restore active rooms. Clients reconnect and the control plane must
reconcile Egress state.

## Known operational constraints

- LiveKit Egress passes rendered recorder configuration through child-process arguments;
  appliance root can inspect credentials. Keep root/Tailscale access tightly scoped.
- Finalized R2 objects use `recordings/<tenant-id>/<session-id>/<egress-id>.<ogg|mp4>`.
- The bundle limits a file output to two hours / 20 GiB, disables local storage, and limits
  Egress to 80% CPU and 14 GiB memory.
- Existing evidence covers one small prototype call, not a production concurrency guarantee.
- The pinned RoomComposite renderer remains available anonymously by immutable GHCR digest.
  It supports the existing deployment, but it is not evidence that per-track microphone
  capture works.
