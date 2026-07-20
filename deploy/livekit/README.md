# LiveKit appliance maintenance

This directory is the owner source for the self-hosted Praximo LiveKit appliance. It is
self-contained: rebuild, upgrade, rollback, secret rotation, and diagnostics must not depend
on any other checkout.

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

The repository-local runtime recovery source is `<repo>/.env.livekit`. It is gitignored,
mode `0600`, and contains exactly the names in
[livekit.env.example](./livekit.env.example):

- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `REDIS_PASSWORD`

The repository-local provider recovery source is `<repo>/.env.livekit-control-plane`. It is
also gitignored and mode `0600`. Its exact inventory is committed in
[control-plane.env.example](./control-plane.env.example). It owns these independent
authorities:

- Cloudflare DNS edit for the production zone;
- Cloudflare user-token management for rotating the DNS token;
- Cloudflare account-token management for creating, rotating, and revoking bucket-scoped R2
  S3 credentials;
- Tailscale OAuth `auth_keys` authority constrained to `tag:ci`;
- OVH API access constrained to this VPS, its reinstall endpoint, and the provider firewall
  for `135.125.175.57`.

The appliance copy is `/etc/livekit/livekit.env` (`root:root`, mode `0600`). Only a process
that needs the values may read either file. Never print values, place them in command
arguments, or send them to chat, logs, GitHub, or commits. The R2 pair and Redis password are
appliance-only. The LiveKit API pair may also be projected to an application secret store.

The owner browser sessions remain break-glass paths, not required rebuild inputs. They are
needed only to replace an OVH application, a Tailscale OAuth client, or the initial Cloudflare
bootstrap if every locally recoverable bootstrap for that provider has been lost. Provider
credentials are rotated one authority at a time and are never projected to the appliance.

## Owner checks

Run before any maintenance:

```bash
bun run livekit:check
bun run livekit:control-plane
bun run livekit:status
```

`livekit:check` validates both exact key inventories and modes without printing values, verifies
the committed checksums, renders into a temporary private directory, checks every shell
script, and validates the pinned Compose model. `livekit:status` proves that the local owner
source renders byte-identically to the live runtime, then performs read-only public and remote
checks. `livekit:control-plane` authenticates all three providers and validates the exact
production DNS/VPS identity. None of these commands prints secret contents. Before a
destructive rebuild, also run `bun run livekit:rebuild:preflight`; it creates and removes
disposable DNS, R2, Tailscale, and OVH-firewall resources and inspects the exact OVH reinstall
grant. A successful read-only check alone is not permission to reimage the VPS.

The live `/opt/livekit` runtime currently renders byte-identically from the repository-owned
runtime recovery source and runs the locked OCI digests. This directory remains canonical;
sync it to `/opt/livekit` after any committed bundle change while no room is active.

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

A rebuild destroys the VPS. Confirm the target service name, drain active rooms, and preserve
both owner recovery files before starting. Run `bun run livekit:control-plane` first.
Then run `bun run livekit:rebuild:preflight` and do not continue unless every disposable
write/revoke proof succeeds.

1. List the currently available OVH images and select the exact Ubuntu 26.04 image ID:

   ```bash
   bun run livekit:ovh:images
   ```

2. Open a temporary provider-firewall SSH rule from the operator's single public IPv4. The
   helper reserves sequence `18` and refuses to overwrite another rule:

   ```bash
   bash deploy/livekit/control-plane.sh ovh-ssh-open OPERATOR_IPV4/32 \
     --confirm-ip=135.125.175.57
   ```

3. Reinstall the exact VPS. This injects `owner-authorized-key.pub`, suppresses password
   delivery, and keeps the existing IPv4/DNS contract:

   ```bash
   bash deploy/livekit/control-plane.sh ovh-reinstall TEMPLATE_ID \
     --confirm-reinstall=vps-12045220.vps.ovh.net:TEMPLATE_ID
   ```

   The helper reads the selected OVH image before the destructive POST and refuses any identity
   other than the selected `Ubuntu 26.04` image.

4. Create a one-time, pre-authorized, non-reusable Tailscale key for `tag:ci`. The value is
   written only to a new mode-`0600` file and expires after ten minutes:

   ```bash
   rebuild_directory=$(mktemp -d)
   bash deploy/livekit/control-plane.sh tailscale-key \
     "$rebuild_directory/tailscale-auth-key"
   ```

   If the key is not consumed, revoke the non-secret key ID printed by the command:

   ```bash
   bash deploy/livekit/control-plane.sh tailscale-key-revoke KEY_ID \
     --confirm-key=KEY_ID
   ```

5. Use public SSH from the temporary allowlisted IPv4 to copy this directory and the key file
   to the clean host. Do not place the key value in a command argument. Run:

   ```bash
   sudo ./bootstrap-host.sh /path/to/tailscale-auth-key
   ```

   The script installs the locked host packages, configures UTC/NTP, validates the committed
   owner key, hardens SSH, enables UFW, joins Tailscale, and deletes the auth-key file. Reboot.
6. Confirm Tailscale SSH, remove the temporary provider-firewall SSH rule, and delete the
   local temporary directory:

   ```bash
   bash deploy/livekit/control-plane.sh ovh-ssh-close OPERATOR_IPV4/32 \
     --confirm-ip=135.125.175.57
   ```

7. Copy this directory to root-owned `/opt/livekit` without a
   `runtime/` directory. From `/opt/livekit`, run `sha256sum -c sha256sums.txt`.
8. Transfer the local runtime recovery source over SSH standard input, not a command argument:

   ```bash
   ssh ubuntu@100.101.110.42 'umask 077; cat > /tmp/livekit.env' < .env.livekit
   ssh ubuntu@100.101.110.42 \
     'sudo install -m 600 -o root -g root /tmp/livekit.env /etc/livekit/livekit.env && rm /tmp/livekit.env'
   ```

9. Install and start the appliance:

   ```bash
   cd /opt/livekit
   sudo ./install.sh /etc/livekit/livekit.env
   sudo docker compose pull
   sudo systemctl start livekit-docker.service
   sudo systemctl status livekit-docker.service
   ```

10. Run `bun run livekit:status` locally. It proves external DNS/TLS and the live ICE/TCP,
    TURN/TCP, and TURN/UDP listeners in addition to the runtime checks.
11. Run `bun run livekit:canary`. Do not accept rebuild completion until direct and relay-only
    microphone publishers each produce a non-empty Opus/OGG Track Egress object whose R2
    size, ETag, Last-Modified, and Content-Type are verified. The canary inspects WebRTC stats
    and refuses a relay proof that did not select a relay candidate (or a direct proof that did),
    reports the selected candidate protocol, and removes both objects. Together with the
    listener checks this is the maintained transport proof; there is no undefined manual smoke.

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

Rotate only one owning credential at a time. Preserve the old owner files until the new
credential passes `livekit:check`, `livekit:status`, and the applicable live canary.

For a LiveKit API key/secret rotation, drain rooms and stop new admissions, preserve a private
copy of the old pair, update `.env.livekit` and the consuming application's secret store, render
and install the appliance, restart LiveKit/Egress, then run status and Track Egress canaries.
Rollback restores both projections from the preserved pair. This is a coordinated maintenance
window because the current LiveKit contract has one active application key.

For Redis, drain rooms, preserve the old owner file, replace `REDIS_PASSWORD`, reinstall, and
recreate LiveKit and Egress together with Redis. `livekit:status` must authenticate with the new
password before the old file is retired; rollback restores the old file and recreates the three
services. Redis contains coordination state, so existing rooms are not preserved across this
rotation.

DNS token rotation is two-phase. Create a new zone-scoped DNS Edit token in a private file,
copy its ID and value into `.env.livekit-control-plane`, run the control-plane check and rebuild
preflight, then revoke the old token:

```bash
bash deploy/livekit/control-plane.sh dns-create /absolute/private/path/new-dns.env
bash deploy/livekit/control-plane.sh dns-revoke OLD_TOKEN_ID \
  --confirm-token=OLD_TOKEN_ID
```

R2 rotation is deliberately two-phase so the old credential stays recoverable until the new
one has passed a live canary:

1. Create a bucket-scoped Object Read & Write account token. The helper writes the Cloudflare
   token value and derived S3 pair only to a new mode-`0600` file:

   ```bash
   bash deploy/livekit/control-plane.sh r2-create /absolute/private/path/new-r2.env
   ```

2. Copy the new `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` into `.env.livekit`; copy the new
   `CLOUDFLARE_R2_API_TOKEN` into `.env.livekit-control-plane`. Preserve both exact dotenv contracts
   and mode `0600`.
3. Run `bun run livekit:check` and `bun run livekit:control-plane`.
4. Transfer `.env.livekit` through SSH standard input, reinstall, and recreate only Egress
   while no room is active.
5. Run `bun run livekit:status` and `bun run livekit:canary`.
6. Only after both pass, revoke the old account token:

   ```bash
   bash deploy/livekit/control-plane.sh r2-revoke OLD_TOKEN_ID \
     --confirm-token=OLD_TOKEN_ID
   ```

The user-token bootstrap can create/revoke the DNS token; the account-token bootstrap can
create/revoke R2 account tokens. Rotate either bootstrap last, after its replacement has
independently created and revoked a disposable scoped token. Store the matching bootstrap token
ID beside its value so `livekit:control-plane` detects identity drift. Tailscale OAuth-client and
OVH application replacement are provider-root break-glass operations; they are not clean-host
rebuild inputs, and the resulting replacement values must be written directly into the local
mode-`0600` control-plane file before the old credential is revoked.

`bash deploy/livekit/control-plane.sh r2-authority-canary` performs that disposable proof. It
creates a bucket-scoped account token, uses its derived S3 pair for a temporary R2 object, and
removes both the object and token before returning.

## Upgrade and rollback

Change one runtime component at a time. Update its immutable digest and version label in
`deployment.lock.md`, regenerate `sha256sums.txt`, run owner checks, and rerun status plus the
selected-transport Track Egress canary after deployment.

Rollback uses a previous committed version of this directory and the unchanged root-only
secret file:

1. Drain rooms and stop new admissions.
2. restore the previous bundle commit and verify `sha256sums.txt`;
3. run `install.sh /etc/livekit/livekit.env`;
4. pull the locked images and restart `livekit-docker.service`;
5. repeat public status, listener checks, selected direct/relay transport evidence, and Egress-to-R2.

Do not roll Redis back to restore active rooms. Clients reconnect and the control plane must
reconcile Egress state.

## Known operational constraints

- LiveKit Egress passes rendered recorder configuration through child-process arguments;
  appliance root can inspect credentials. Keep root/Tailscale access tightly scoped.
- Finalized R2 objects use `recordings/<tenant-id>/<session-id>/<egress-id>.<ogg|mp4>`.
- The bundle limits a file output to two hours / 20 GiB, disables local storage, and limits
  Egress to 80% CPU and 14 GiB memory.
- Existing evidence covers one small prototype call, not a production concurrency guarantee.
- The OVH provider firewall is enabled. Canonical public rules occupy sequences `0`-`5`, the
  final IPv4 deny is sequence `19`, and sequence `18` is reserved only for temporary rebuild
  SSH from one `/32`. Use `bun run livekit:ovh:firewall` to inspect the live rule set.
- The pinned RoomComposite renderer remains available anonymously by immutable GHCR digest.
  It supports the existing deployment, but it is not evidence that per-track microphone
  capture works.
