
Reference for the whole setup: what runs where, how the pieces connect, and the commands worth knowing for each one.

_Last updated: October 29, 2026_

> **Private reference.** This file has internal IPs, tunnel addresses, and paths. Before you publish anything based on it (blog, portfolio), swap real addresses for generic labels and leave out anything from `.env` files. Secrets (passwords, API keys, webhook URLs, the playit secret, the VPN key) are **not** in this file and shouldn't be added to it.

---

## Contents

1. [At a glance](#1-at-a-glance)
2. [How it fits together](#2-how-it-fits-together)
3. [Proxmox host](#3-proxmox-host)
4. [ZFS storage](#4-zfs-storage)
5. [Samba file sharing](#5-samba-file-sharing)
6. [NVIDIA GPU](#6-nvidia-gpu)
7. [DNS: Pi-hole x2 + nebula-sync](#7-dns-pi-hole-x2--nebula-sync)
8. [Remote access: Tailscale](#8-remote-access-tailscale)
9. [Home Assistant (VM 200)](#9-home-assistant-vm-200)
10. [Immich (LXC 300)](#10-immich-lxc-300)
11. [Jellyfin (LXC 400)](#11-jellyfin-lxc-400)
12. [Media automation (LXC 450)](#12-media-automation-lxc-450)
13. [Minecraft (LXC 500)](#13-minecraft-lxc-500)
14. [Finance app (LXC 600)](#14-finance-app-lxc-600)
15. [Monitoring and alerts](#15-monitoring-and-alerts)
16. [Backups](#16-backups)
17. [Scheduled jobs (cron)](#17-scheduled-jobs-cron)
18. [Client devices](#18-client-devices)
19. [Quick troubleshooting](#19-quick-troubleshooting)
20. [Lessons learned](#20-lessons-learned)
21. [Open items and roadmap](#21-open-items-and-roadmap)

---

## 1. At a glance

### Hardware

|Part|Model|Role|
|---|---|---|
|CPU|AMD Ryzen 5 1600 (6c/12t)|No integrated graphics, so the GPU handles all video work|
|RAM|16 GB DDR4 (2 slots free)|Tight with everything running. 32 GB is the easiest upgrade.|
|GPU|NVIDIA GTX 1660 Super|NVENC transcoding (Jellyfin, Immich) and CUDA machine learning (Immich)|
|Boot drive|1 TB Crucial P3 NVMe|Proxmox, container and VM disks, databases|
|Storage|2x 4 TB WD Red Plus|ZFS mirror `nastidias`, about 3.6 TB usable|
|Raspberry Pi|"magicpi"|Backup Pi-hole, second Tailscale subnet router, Uptime Kuma|

### Network

- **Subnet:** `192.168.68.0/22` (covers `.68.0` through `.71.255`). Gateway `192.168.68.1` (TP-Link Deco).
- **The Deco sits behind the building's managed network** (Spectrum Community Solutions). Its WAN address is private, so **there's no port forwarding**. Everything public goes out through **outbound tunnels** (playit, and later Cloudflare Tunnel), and private remote access uses **Tailscale**.
- **Servers use static IPs** outside the DHCP pool. **Pi-hole local DNS** gives them `.lan` names.

### Address map

| Service           | Type / ID    | IP             | Address                        | Port(s)                      |
| ----------------- | ------------ | -------------- | ------------------------------ | ---------------------------- |
| Proxmox host      | host         | 192.168.68.19  | `https://proxmox.lan:8006`     | 8006, SSH 22, SMB 445        |
| Pi-hole (primary) | LXC 100      | 192.168.68.21  | `http://pihole.lan/admin`      | DNS 53, web 80               |
| Home Assistant    | VM 200       | 192.168.68.22  | `http://homeassistant.lan`     | **80**                       |
| Immich            | LXC 300      | 192.168.68.23  | `http://immich.lan:2283`       | 2283                         |
| Jellyfin          | LXC 400      | 192.168.68.24  | `http://jellyfin.lan:8096`     | 8096                         |
| Media automation  | LXC 450      | 192.168.68.245 | `http://media.lan:<port>`      | see section 12               |
| Minecraft         | LXC 500      | 192.168.68.25  | Friends tab / tunnels          | TCP 19132, UDP 40420–40429   |
| Finance app       | LXC 600      | 192.168.68.26  | `http://finance.lan:5000`      | 5000                         |
| Tailscale         | LXC 900      | 192.168.68.29  | login.tailscale.com/admin      | Tailscale IP 100.125.183.102 |
| magicpi           | Raspberry Pi | 192.168.68.190 | Pi-hole `/admin`, Kuma `:3001` | 53, 80, 3001                 |
| Windows desktop   | PC           | 192.168.68.52  | backup target `\\PC\NASBackup` | 445                          |
| MacBook           | laptop       | 192.168.68.55  | —                              | —                            |

---

## 2. How it fits together

```
                     Internet
                        │
          ┌─────────────┴──────────────┐
          │  Building network (Spectrum)│   no port forwarding
          └─────────────┬──────────────┘
                        │
                   TP-Link Deco  (192.168.68.1)
                        │
   ┌────────────────────┼─────────────────────────────┐
   │                    │                             │
Proxmox host (.19)   magicpi (.190)              PCs / phones / TV
   │                 ├ Pi-hole (backup DNS)
   │                 ├ Tailscale subnet router
   │                 └ Uptime Kuma (monitoring)
   │
   ├─ ZFS mirror "nastidias" (2x4TB) ── Samba shares
   ├─ NVIDIA driver (shared into containers)
   ├─ LXC 100  Pi-hole (primary DNS)
   ├─ VM  200  Home Assistant OS
   ├─ LXC 300  Immich (Docker, GPU)
   ├─ LXC 400  Jellyfin (native, GPU)
   ├─ LXC 450  Media automation (Docker, VPN)
   ├─ LXC 500  Minecraft Bedrock (Docker) ──► playit tunnels ──► friends
   ├─ LXC 600  Finance app (Flask)
   └─ LXC 900  Tailscale subnet router ◄── phones/laptops away from home
```

### Four request paths worth knowing

1. **`jellyfin.lan` lookup:** device → Pi-hole `.21` (or the Pi `.190` if it's down) → local record → `192.168.68.24`.
2. **Watching Jellyfin away from home:** phone (Tailscale app) → Tailscale subnet router (LXC 900 or the Pi) → Jellyfin `.24:8096` → GPU transcode (NVENC) → reads from ZFS.
3. **Phone photo backup:** Immich app → `immich.lan:2283` → Immich server → stored in `nastidias/immich` → copied to the desktop nightly.
4. **A friend joins Minecraft:** Xbox/PS5/PC Friends tab → Xbox Live session (broadcaster) → broadcaster relays the NetherNet offer to the server (`127.0.0.1:19132`) → the server answers with its playit UDP address → game traffic flows through the **playit UDP tunnel** → server.

---

## 3. Proxmox host

**Version:** Proxmox VE 9.2 (Debian 13 "trixie" base).

**Why containers (LXC) for almost everything:** they're lighter than VMs, share the host's kernel, and can use the shared GPU and ZFS through bind mounts. **Home Assistant is a VM** because HAOS is a full OS, and that's the supported way to run it.

**Unprivileged containers shift user IDs:** user `X` inside a container is user `100000 + X` on the host. Container root = host `100000`, and container user 1000 = host `101000` (the `nas` user).

### Commands (on the host)

|Command|What it does|
|---|---|
|`pct list` / `qm list`|List containers / VMs and their state|
|`pct enter 500`|Open a shell inside container 500 (`exit` to leave)|
|`pct exec 500 -- <cmd>`|Run one command inside a container from the host|
|`pct start/stop/reboot 500`|Control a container|
|`pct config 500`|Show a container's settings (mounts, IP, onboot, MAC)|
|`pct set 500 -onboot 1`|Start the container automatically when the host boots|
|`pct set 600 -mp0 /host/path,mp=/ct/path`|Add a bind mount|
|`qm start 200` / `qm shutdown 200`|Control the Home Assistant VM|
|`pvesm status`|Storage list (local, local-lvm, pc-backup, ...) and free space|
|`pveversion`|Proxmox version|
|`apt update && apt full-upgrade`|Update Proxmox (always `full-upgrade`, never plain `upgrade`)|
|`journalctl -b -p err`|Errors since the last boot|
|`free -h`, `htop`|Memory and CPU at a glance|

**Remote shell:** `ssh root@192.168.68.19` from Windows Terminal (copy and paste work normally), or over Tailscale when away. Proxmox has **no RDP or desktop**; the web UI is the GUI.

---

## 4. ZFS storage

**Pool:** `nastidias`, a **mirror** of two 4 TB drives. It survives one drive failing. **A mirror is not a backup:** it doesn't protect against deletion, corruption, or the whole server dying.

**Pool-wide settings:** `compression=lz4`, `atime=off`, `xattr=sa`, `acltype=posixacl` (needed for the ACLs on the finance folder).

|Dataset|Used by|Notes|
|---|---|---|
|`nastidias/jellyfin`|Jellyfin, media stack, SMB|`recordsize=1M` (big sequential video files). Contains `media/`, `torrents/`, `usenet/`|
|`nastidias/immich`|Immich|Owned by `100000` (container root). Hidden from SMB with `veto files`|
|`nastidias/share`|SMB, finance app|General files. `share/finances` has an ACL for the finance container|
|`nastidias/backups`|Proxmox backups|`dump/` holds vzdump archives|

**Keep the pool under about 80% full.** ZFS slows down past that.

### Commands

|Command|What it does|
|---|---|
|`zpool status -v nastidias`|Health of the pool and each drive. Look for `ONLINE` and 0 errors|
|`zpool list`|Size, used, free|
|`zfs list -o name,used,avail,recordsize,compressratio`|Space per dataset|
|`zpool scrub nastidias`|Read every block and verify checksums. Run monthly; check with `zpool status`|
|`zfs get recordsize,compression nastidias/jellyfin`|Check a dataset's settings|
|`getfacl /nastidias/share/finances`|Show ACLs (needs `apt install acl`)|
|`ls -ln /nastidias/jellyfin`|Numeric owners (should be `101000` for media)|

**If a drive fails:** `zpool status` shows it `DEGRADED`/`FAULTED`. The pool keeps working on one drive. Replace the drive, then `zpool replace nastidias <old-id> <new-disk>` and let it resilver.

---

## 5. Samba file sharing

Samba runs **on the Proxmox host** (it owns the pool).

- Each person logs in with their own Samba account.
- `force user = nas` / `force group = nas`: every file is saved as `nas`, so containers can always read it.
- `[nastidias]` share at the pool root, with `veto files = /immich/` hiding Immich's folder.

### Commands (host)

|Command|What it does|
|---|---|
|`testparm -s`|Check `/etc/samba/smb.conf` for errors and show the active config|
|`smbstatus`|Who's connected and which files are open|
|`pdbedit -L`|List Samba users|
|`smbpasswd -a <user>`|Add a Samba user, or change their password|
|`systemctl restart smbd`|Apply config changes|

Client setup (Fedora, Mac, Windows) is in [section 18](#18-client-devices).

---

## 6. NVIDIA GPU

The driver (**595.104.02**, open module, DKMS) is installed **on the host** and **shared** into the Immich and Jellyfin containers through the `/dev/nvidia*` devices. Inside the containers, the **same version** is installed with `--no-kernel-modules`.

**Rule:** host and containers must run the **exact same** driver version. Update the host first, then each container. Keep the `.run`installer in `/root`.

The 1660 Super handles NVENC (limit of 8 simultaneous encodes), but **can't hardware-decode AV1**.

### Commands

|Command|Where|What it does|
|---|---|---|
|`nvidia-smi`|host or container|Driver version, GPU load, which processes are using it|
|`watch -n1 nvidia-smi`|host|Live view, e.g. to confirm `ffmpeg` appears while Jellyfin transcodes|
|`dkms status`|host|Confirms the driver was rebuilt for the current kernel|

**After a Proxmox kernel update,** run `nvidia-smi` on the host. If it errors, DKMS didn't rebuild, so reinstall the driver.

---

## 7. DNS: Pi-hole x2 + nebula-sync

**Two Pi-holes** so DNS (and every `.lan` name) keeps working if one is down:

- **Primary:** LXC 100, `192.168.68.21`
- **Backup:** magicpi, `192.168.68.190`

**nebula-sync** (in LXC 100, a systemd service, hourly) copies the primary's config (local DNS records, lists) to the Pi. It uses Pi-hole v6 **app passwords**, and the replica has `app_sudo` enabled. Config is in `/etc/nebula-sync/.env`.

**DNS is handed out** by the Deco's DHCP (both Pi-holes), and by **Tailscale admin → DNS** for devices on Tailscale.

### Commands

|Command|Where|What it does|
|---|---|---|
|`pihole status`|either Pi-hole|Is DNS running and blocking?|
|`pihole -t`|either Pi-hole|Live query log (Ctrl+C to stop)|
|`pihole -up`|either Pi-hole|Update Pi-hole|
|`pihole reloaddns`|either Pi-hole|Reload after changing records|
|`systemctl status nebula-sync`|LXC 100|Is the sync running?|
|`journalctl -u nebula-sync -n 30`|LXC 100|Last sync results|
|`nslookup jellyfin.lan 192.168.68.21`|any device|Ask the primary directly|
|`nslookup jellyfin.lan 192.168.68.190`|any device|Ask the backup directly|

**Add a new service name:** Pi-hole primary → **Settings → Local DNS Records** → `name.lan` → IP. nebula-sync copies it to the Pi within the hour.

---

## 8. Remote access: Tailscale

- **Subnet routers** advertise `192.168.68.0/22`, so a phone or laptop on Tailscale can reach every home IP as if it were at home. There are two, for redundancy: **LXC 900** and **magicpi**.
- **Tailscale DNS** points at the Pi-holes, so `.lan` names work remotely too.
- Nothing is exposed to the public internet.

### Commands (on a subnet router, or any machine with Tailscale)

|Command|What it does|
|---|---|
|`tailscale status`|Devices on your tailnet and whether they're online|
|`tailscale ip -4`|This machine's Tailscale IP|
|`tailscale ping <device>`|Test the path to another device (direct vs relayed)|
|`tailscale netcheck`|NAT type, nearest relay, connectivity|

If remote access breaks: check the **subnet routes are approved** in the admin console (Machines → the router → Edit route settings), and that **at least one router is online**.

---

## 9. Home Assistant (VM 200)

- **HAOS** running as a VM. Its IP (`.22`) is set **inside** Home Assistant, not in Proxmox.
- **Listens on port 80**, so use `http://homeassistant.lan` (`:8123` doesn't work).

### Commands (Proxmox web UI → VM 200 → Console)

|Command|What it does|
|---|---|
|`ha core info`|Version, and the port it's listening on|
|`ha core update`|Update Home Assistant Core|
|`ha os info` / `ha os update`|HAOS version / update|
|`ha network info`|IP and network settings|
|`ha host reboot`|Reboot the VM cleanly|

Take a **backup inside HA** (Settings → System → Backups) before big updates.

---

## 10. Immich (LXC 300)

- Docker Compose in **`/opt/immich`**: `docker-compose.yml`, `.env` (secrets), and `hwaccel.*.yml` (GPU).
- Photos are on `nastidias/immich`, mounted at `/mnt/photos`. **The database is on the NVMe** (`./postgres`). Never put Postgres on the HDDs or a network share.
- GPU: **NVENC** for video transcoding, **CUDA** for machine learning (faces, search).
- Migrated from the Pi (v3.3.0, 40,652 files, 76 GB) with `pg_dumpall` + `rsync`.

### Commands (inside LXC 300, in `/opt/immich`)

|Command|What it does|
|---|---|
|`docker compose ps`|Status of server, machine-learning, database, redis|
|`docker compose logs -f immich-server`|Follow server logs|
|`docker compose pull && docker compose up -d`|Update. **Read the release notes first**; Immich sometimes has breaking changes. Don't auto-update it|
|`nvidia-smi`|Confirm the GPU is visible in the container|
|`curl -s http://localhost:2283/api/server/ping`|Health check (returns `pong`)|

---

## 11. Jellyfin (LXC 400)

- Installed **natively** (no Docker), with the GPU passed in.
- `/nastidias/jellyfin` mounted at **`/data`**. Libraries: `/data/media/movies`, `/data/media/tv`.
- The `jellyfin` user is in group `nas`, so it can read and write the media folders.
- Hardware transcoding: **NVENC**, with hardware decoding for everything except AV1.
- "Allow remote connections" **on** (for Tailscale), automatic port mapping **off**.
- **Users:** Dashboard → Users → `+`. For family: no admin, no deletion, transcoding allowed.

### Commands (inside LXC 400)

|Command|What it does|
|---|---|
|`systemctl status jellyfin`|Is it running?|
|`journalctl -u jellyfin -f`|Follow logs|
|`systemctl restart jellyfin`|Restart|
|`apt update && apt upgrade`|Update (Jellyfin comes from its own apt repo)|
|`curl -s http://localhost:8096/health`|Health check (returns `Healthy`)|
|`nvidia-smi`|GPU visible?|

---

## 12. Media automation (LXC 450)

Docker Compose in **`/opt/media`** (`docker-compose.yml`, `.env` with `chmod 600`, one config folder per app). Backing up that folder (or the whole container) backs up every app's settings.

|App|Port|Job|
|---|---|---|
|Gluetun|—|WireGuard VPN tunnel, Miami server. The download clients use its network|
|qBittorrent|8080|Torrent client, inside Gluetun's network (VPN kill switch by design)|
|SABnzbd|8085|Usenet client (provider: Newshosting, SSL 563)|
|Prowlarr|9696|Indexer manager, synced to Sonarr/Radarr|
|FlareSolverr|8191|Gets Prowlarr past Cloudflare checks (only for indexers tagged `flaresolverr`)|
|Sonarr / Radarr|8989 / 7878|TV / movie library management and import|
|Bazarr|6767|Subtitles|
|Seerr|5055|Request app, logs in with Jellyfin accounts|

**Key design choices:**

- **One shared `/data` mount** in every app, so imports are **hardlinks** (instant, no extra space).
- `network_mode: service:gluetun`: qBittorrent has no network of its own, so if the VPN drops it goes offline instead of using the home IP.
- **PUID/PGID 1000** matches the `nas` user, so permissions line up with Jellyfin and Samba.
- Apps reach each other by service name (`http://radarr:7878`). qBittorrent is reached as `gluetun:8080`. SABnzbd needs `host_whitelist` set to `media.lan, sabnzbd`.
- Failed Download Handling is on in Sonarr/Radarr, so bad downloads get blocklisted and replaced.

### Commands (inside LXC 450, in `/opt/media`)

|Command|What it does|
|---|---|
|`docker compose ps`|Status of every container|
|`docker compose logs -f <app>`|Follow one app's logs|
|`docker compose restart <app>`|Restart one app|
|`docker compose pull && docker compose up -d`|Update everything|
|`docker compose up -d --force-recreate gluetun qbittorrent`|Rebuild the VPN pair (always together)|
|`docker exec gluetun wget -qO- https://ipinfo.io`|Confirm traffic goes out through the VPN|
|`docker image prune`|Remove old images after updating|

---

## 13. Minecraft (LXC 500)

**Bedrock Dedicated Server** (crossplay: PC, Xbox, PS5), version **26.61** (build 1.26.61.1). World: `TestWorld`. Compose file: **`/opt/minecraft/docker-compose.yml`**.

### Containers

|Container|Image|Network|Job|
|---|---|---|---|
|`bedrock`|itzg/minecraft-bedrock-server|host|The game server|
|`broadcaster`|MCXboxBroadcast standalone (build 160+)|**host**|Xbox Live session, so it shows in everyone's Friends tab|
|`playit`|playit-agent (1.2.0+)|host|Outbound tunnels (building network = no port forwarding)|

### NetherNet (since Minecraft 26.60)

- **Oct 27, 2026: Minecraft 26.60 removed RakNet from the game.** Players can only connect with **NetherNet**: setup (signaling) over **TCP 19132**, then game traffic over **UDP**.
- **Server settings:** `TRANSPORT=nethernet` and `SERVER_UDP_PORTS=209.25.140.17:40420-40429:40420-40429` (in the compose file; `transport=nethernet` in `server.properties` too).
- **The public and local UDP port numbers must match exactly.** If they don't, the server says "Server started" but never opens its listener.
- **Broadcaster:** `network_mode: host` and `remote-address: 127.0.0.1`, `remote-port: '19132'`. It relays join requests straight to the server. Routing them through playit failed (InitialConnection-81).
- **Error codes:** `InitialConnection-81` = signaling failed. `InitialConnection-83 / "Door"` = UDP game traffic failed.

### playit tunnels (Premium, $3/month)

|Tunnel|Address|Local target|Needed?|
|---|---|---|---|
|**RaylMadridMC UDP**|`209.25.140.17:40420–40429`(`malls-wu.tun.ply.gg`)|`192.168.68.25:40420`|**Yes.** Everyone's game traffic. Don't delete it: recreating changes the IP/ports and `SERVER_UDP_PORTS` must change to match|
|RaylMadridMC NetherNet|`malls-keen.tun.ply.gg:19132`|`127.0.0.1:19132`|No. Only for joining by address. Broke Oct 29 (experimental). Replace with a plain TCP tunnel|
|minecraft (RakNet)|`147.185.221.215:52606`|—|No. Unusable since 26.60. Delete|

### Allowlist

- **Lives in the compose file** (`ALLOW_LIST_USERS`). The image rebuilds `allowlist.json` from it whenever the container is recreated, so names added only with `allowlist add` disappear later.
- Use the **name the player joins with**, as shown by the broadcaster's `Relayed bedrock client <name>` line (e.g. `yungjiv`, not `jiv7754`).

### Self-healing

- **The deaf-port problem:** after a quick restart, the server can say "Server started" but never open port 19132, because the old instance's connections haven't closed yet.
- **`/opt/minecraft/safe-restart.sh [reason]`:** pulls new images, stops, waits 60 s, starts, checks 19132, retries with a longer wait, restarts the broadcaster, and posts to Discord (🔄 restarting → 🟢 back online with version, or ⬆️ updated X → Y, or 🔴 failed).
- **`/opt/minecraft/watchdog.sh`:** every 10 min; if bedrock has been up 5+ min and 19132 isn't listening, runs safe-restart with reason "an automatic fix".
- **Webhook URL:** `/opt/minecraft/.discord-webhook` (`chmod 600`).
- **Never use** `docker compose restart bedrock` by hand. Use `safe-restart.sh`.

### Commands (Minecraft shell: `pct enter 500`, then `cd /opt/minecraft`)

| Command                                                                           | What it does                                                                  |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `/opt/minecraft/safe-restart.sh "a quick maintenance restart"`                    | Safe restart with a Discord message                                           |
| `ss -ltnp \| grep 19132`                                                          | Is the server accepting joins? (`LISTEN` = yes)                               |
| `curl -s http://127.0.0.1:19132/v1/join; echo`                                    | Server info: name, version, players online                                    |
| `docker logs bedrock 2>&1 \| grep "Version:" \| tail -1`                          | Current server version                                                        |
| `mclog`                                                                           | Alias: live join/spawn/leave plus broadcaster relays                          |
| `docker logs bedrock 2>&1 \| grep -E "Player (connected\|Spawned\|disconnected)"` | Player activity since the last start                                          |
| `docker logs broadcaster 2>&1 \| grep Relayed`                                    | Everyone who tried to join via the Friends tab                                |
| `docker exec bedrock send-command say "message"`                                  | Message everyone in-game                                                      |
| `docker exec bedrock send-command allowlist add "Name"`                           | Allow someone **now** (also add to the compose file!)                         |
| `docker exec bedrock send-command gamerule <rule> <value>`                        | Change a game rule                                                            |
| `grep -o '"name":"[^"]*"' data/allowlist.json \| cut -d'"' -f4`                   | Show the allowlist                                                            |
| `docker attach bedrock`                                                           | Server console. **Leave with Ctrl+P, Ctrl+Q**; Ctrl+C stops the server        |
| `sh -x /opt/minecraft/watchdog.sh`                                                | Run the watchdog step by step (safe; only restarts if the port is closed)     |
| `touch /opt/minecraft/.maintenance`                                               | Pause the watchdog (if the maintenance-file line was added); `rm`it to resume |
| `docker logs --tail 20 playit`                                                    | Tunnel agent status                                                           |

**Logs on the host:** `/var/log/minecraft-restart.log` (nightly runs), `/var/log/minecraft-watchdog.log` (empty = never needed to step in).

---

## 14. Finance app (LXC 600)

- A Flask app (loan payoff tracker) run by **gunicorn** on port **5000**, as the systemd service `finance`.
- Code and data live on the pool at `/nastidias/share/finances`, bind-mounted to **`/opt/finances`**. Editable from Fedora (`/mnt/nas/finances`) or the Mac over SMB.
- An ACL (`u:100000:rwx`) lets the container's root write to it while `nas` keeps ownership.
- **How it works:** every page load reads `loan-info.ods` (Balance and Minimum Payment, matched by Creditor + Disbursement Year). The first load each day saves a snapshot to `finance.db` (SQLite). Interest rates and loan types are hard-coded in `loans.py`.
- **Needs `python3-pandas`** in the container to read the spreadsheet. Without it, the app silently uses the values in `loans.py`.
- **Private:** no login. LAN and Tailscale only; never expose it publicly.
- Container timezone set to America/New_York (dates matter for loans).

### Commands (inside LXC 600)

|Command|What it does|
|---|---|
|`systemctl status finance`|Is it running?|
|`journalctl -u finance -f`|Follow logs|
|`systemctl restart finance`|Load code changes (or `pct exec 600 -- systemctl restart finance` from the host)|
|`python3 -c "import flask, dateutil, odf, pandas; print('ok')"`|Check every dependency is installed|

Don't run the app on Fedora against the same `finance.db` at the same time. Two writers to SQLite over SMB can corrupt it.

---

## 15. Monitoring and alerts

### Uptime Kuma (Docker on magicpi, `http://192.168.68.190:3001`)

Runs on the Pi on purpose: if the server dies, the monitor doesn't die with it. Database: SQLite.

|Monitor|Type|Target|Alerts to|
|---|---|---|---|
|Home Assistant, Immich, Jellyfin, Loan Tracker, Proxmox, Prowlarr, qBittorrent, Radarr, SABnzbd, Seerr, Sonarr, Pi-hole|HTTP / keyword / DNS|IPs (not `.lan`, so a Pi-hole outage doesn't take every monitor down)|Homelab Discord|
|**RaylMadridMC**|TCP Port|`192.168.68.25:19132`|**#mc-updates**(gaming Discord)|

- **Maintenance window 3:58–4:10 AM daily** on RaylMadridMC, so the nightly restart doesn't post ❌.
- qBittorrent is reachable only while the VPN is up, so its monitor doubles as a VPN check.

```bash
# On the Pi
docker ps --filter name=uptime-kuma
docker logs --tail 30 uptime-kuma
# Update
docker pull louislam/uptime-kuma:2
docker stop uptime-kuma && docker rm uptime-kuma
docker run -d --name uptime-kuma --restart unless-stopped -p 3001:3001 -v uptime-kuma:/app/data louislam/uptime-kuma:2
```

(Data is in the `uptime-kuma` volume, so recreating the container keeps all monitors.)

### Discord

- **Homelab Discord:** Proxmox notifications, Uptime Kuma (everything).
- **Gaming Discord → #mc-updates:** the restart script (posts as "TMac") and the RaylMadridMC monitor.
- Keep webhook URLs secret. Anyone with one can post.

### What the alerts can't see

- **Building internet down:** no alerts at all (Kuma can't reach Discord either).
- **The playit UDP tunnel failing:** friends can't join, but the server port is fine, so nothing alerts.

### netwatch (outage logging)

`/usr/local/bin/netwatch.sh` pings the gateway, the building edge, the ISP hop and `1.1.1.1` every 5 s and logs failures to `/var/log/netwatch.log`. Started with `systemd-run --unit=netwatch`, so **it doesn't survive a reboot**.

---

## 16. Backups

### Layers

|Layer|What|Where|
|---|---|---|
|ZFS mirror|Survives one drive failing|— (not a backup)|
|**vzdump** (Proxmox job, nightly)|Every container and VM: snapshot mode, zstd, keep 3 daily + 2 weekly|`nastidias/backups/dump` (check which storage the job uses: Datacenter → Backup)|
|**`/usr/local/bin/backup-immich.sh`** (1:15 AM)|rsync photos (minus thumbs/encoded video) + vzdump archives to the desktop|`pc-backup` storage → `D:\NASBackup` on the Windows PC|

**Not covered by vzdump:** bind-mounted data (the pool datasets). The photos are covered by the rsync. If you added the finance rsync line, `share/finances` is too. Media isn't backed up off-host (it can be re-downloaded).

**Windows side:** local user `nasbackup`, share `NASBackup`, Defender exclusion on `D:\NASBackup`, NIC power-saving off. **The PC has to be on overnight** for the copy to work.

### Commands (host)

|Command|What it does|
|---|---|
|`tail -20 /var/log/backup-immich.log`|Did last night's copy to the PC work?|
|`mountpoint /mnt/pve/pc-backup`|Is the PC share mounted?|
|`ls -lh /nastidias/backups/dump/`|Local vzdump archives|
|`vzdump 500 --storage <storage> --mode snapshot --compress zstd`|Back up one container now|
|`pct restore 9500 /path/vzdump-lxc-500-....tar.zst --storage local-lvm`|**Restore test** to a spare ID (then `pct destroy 9500`)|
|`qmrestore /path/vzdump-qemu-200-....vma.zst 9200`|Restore a VM to a spare ID|

**A backup isn't proven until a restore works.** Do a restore test every few months.

---

## 17. Scheduled jobs (cron)

### Proxmox host (`crontab -e`)

```
15 1 * * * /usr/local/bin/backup-immich.sh >> /var/log/backup-immich.log 2>&1
50 3 * * * /usr/sbin/pct exec 500 -- sh -c 'docker logs --since 24h bedrock 2>&1 | grep -E "Player (connected|disconnected)" >> /opt/minecraft/player-history.log'
55 3 * * * /usr/sbin/pct exec 500 -- docker exec bedrock send-command say "Server restarting in 5 minutes"
0 4 * * * /usr/sbin/pct exec 500 -- /opt/minecraft/safe-restart.sh >> /var/log/minecraft-restart.log 2>&1
*/10 * * * * /usr/sbin/pct exec 500 -- /opt/minecraft/watchdog.sh >> /var/log/minecraft-watchdog.log 2>&1
```

(The 3:50 and 3:55 lines are optional/recommended. Check yours with `crontab -l`.)

**Cron rules learned the hard way:**

- Use **full paths** (`/usr/sbin/pct`). Cron's PATH doesn't include `/usr/sbin`.
- Always redirect output (`>> log 2>&1`), or errors vanish.
- Check it ran: `journalctl -u cron --since "today" | grep <script>`.

### Other scheduled things

- **nebula-sync:** hourly (systemd service in LXC 100).
- **vzdump:** Proxmox backup job (Datacenter → Backup).

---

## 18. Client devices

### Fedora workstation

Mounted at boot through `/etc/fstab`, with the login in `/etc/nas-credentials` (`chmod 600`):

```
//proxmox.lan/share  /mnt/nas  cifs  credentials=/etc/nas-credentials,uid=1000,gid=1000,iocharset=utf8,_netdev,nofail,x-systemd.automount  0  0
```

- `sudo systemctl start mnt-nas.automount` mounts it without rebooting.
- `findmnt /mnt/nas` shows whether it's mounted.
- Bookmarked in GNOME Files with Ctrl+D.

### Mac

Finder → **Cmd+K** → `smb://proxmox.lan/share`. Tailscale must be on when away. Use LibreOffice for `.ods` files (Numbers saves as `.numbers`). The Mac leaves `._*` files on shares; they're harmless.

### Windows

- `ssh root@192.168.68.19` from Windows Terminal for a shell.
- Backup share `D:\NASBackup` (see [section 16](#16-backups)).

### LibreOffice lock files

`.~lock.<file>#` means the file is open somewhere, or LibreOffice crashed and left the lock. Close it everywhere, or delete the lock if you're sure nothing has it open.

---

## 19. Quick troubleshooting

|Symptom|First checks|
|---|---|
|A `.lan` name doesn't work|`nslookup name.lan 192.168.68.21` (does Pi-hole know it?). On Tailscale devices, check Tailscale DNS settings|
|A web UI won't load|`http://` typed? App running (`ss -tlnp \| grep <port>`)? `curl -I` from the host vs your device? IP conflict (`arp -a`, Proxmox MACs start `bc:24:11`)? Subnet `/22`?|
|Friends can't join Minecraft|`ss -ltnp \| grep 19132` (deaf port → safe-restart); version match (`/v1/join` vs their game); `docker logs broadcaster \| grep Relayed` (relayed but no "Player connected" = allowlist name); their InitialConnection code (81 = signaling, 83 = UDP); playit dashboard|
|Remote access (Tailscale) broken|Is a subnet router online? Routes approved in the admin console?|
|GPU not working in Jellyfin/Immich|`nvidia-smi` on host and in the container; driver versions must match exactly|
|Downloads don't import|Radarr/Sonarr → Activity → Queue warnings; paths all `/data/...`; owner `101000`|
|VPN container unhealthy|`docker logs gluetun --tail 50`; WireGuard key in `.env`; then `docker compose up -d`|
|Backup didn't run|`tail /var/log/backup-immich.log`; PC on and share mounted?; Datacenter → Backup → job history|
|Whole internet "down"|`tail /var/log/netwatch.log` shows which hop failed (gateway vs building vs ISP)|
|Uptime Kuma says down but things work|Check _what_ the monitor watches (the Oct 29 playit false alarm was a monitor watching an unused tunnel)|

---

## 20. Lessons learned

- **Subnet must be `/22` everywhere.** A `/24` container can't reach `.69`–`.71` devices.
- **Static IPs must not overlap the DHCP pool** (the Jellyfin/Tailscale `.24` conflict).
- **When Pi-hole's IP changes, update three places:** the router's DHCP DNS, Tailscale DNS, and anything set by hand.
- **Home Assistant listens on port 80**, not 8123.
- **Writing compressed backups straight to an SMB share failed intermittently** ("Resource temporarily unavailable"). Back up locally first, then copy with rsync.
- **A script that prints "finished" even when it failed is worse than no script.** Check exit codes.
- **Cron needs full paths.** `pct` silently wasn't found for days.
- **Minecraft 26.60 (Oct 27, 2026) removed RakNet.** The full NetherNet migration: update the server and broadcaster → broadcaster on host networking → relay via `127.0.0.1` → a UDP tunnel with matching port numbers → safe restarts to avoid the deaf port → a watchdog.
- **Invisible characters break things:** a carriage return from `tty: true` container logs made Discord reject JSON messages (fixed with `tr -d '\r'`).
- **Monitor what users actually depend on.** The friends' alert watched a tunnel nobody used and posted a false outage.
- **Experimental features change without warning:** the playit NetherNet tunnel changed its port and stopped working the same day.
- **Allowlist names must match what the game sends**, and the allowlist must live in the compose file to survive recreates.

---

## 21. Open items and roadmap

### Housekeeping

- [ ] Minecraft: set broadcaster `debug-mode: false`
- [ ] Minecraft: replace the NetherNet tunnel with a plain TCP tunnel (`127.0.0.1:19132`), and delete the old RakNet tunnel
- [ ] Minecraft: confirm the 3:55 warning (and optional 3:50 history) cron lines are in
- [ ] Minecraft: decide on broadcaster `auto-friend` and the 15-day friend `expiry`
- [ ] Uptime Kuma: confirm the maintenance window covers the RaylMadridMC (TCP) monitor
- [ ] Uptime Kuma: Push monitor for the nightly backup (`curl` the push URL on success in `backup-immich.sh`)
- [ ] Backups: confirm the vzdump job targets local storage, add the finance folder to the rsync, **do a restore test**
- [ ] netwatch: make it a real systemd service (or remove it)
- [ ] Finance app: confirm `python3-pandas` is installed in LXC 600 and add `pandas` to `requirements.txt`
- [ ] Turn on 2FA everywhere important (email, Tailscale, playit, Discord, GitHub, Microsoft)
- [ ] Monthly `zpool scrub` (or check it's scheduled), and ZFS snapshots (`sanoid`)

### Projects

- [ ] Domain + reverse proxy (Nginx Proxy Manager, wildcard cert via Cloudflare DNS challenge, Pi-hole wildcard record)
- [ ] Cloudflare Tunnel for the public portfolio and blog
- [ ] Homelab dashboard (designs in "Homelab Dashboard Concepts")
- [ ] Password manager (Bitwarden now, or Vaultwarden once the reverse proxy exists)
- [ ] WLED TV backlight (ESP32 + strip + Home Assistant; optional webcam + HyperHDR sync later)
- [ ] Jellyfin access for Dad (user created; decide on remote access)
- [ ] RAM upgrade to 32 GB
- [ ] Portfolio page: interactive architecture map, request-flow walkthroughs, incident write-ups