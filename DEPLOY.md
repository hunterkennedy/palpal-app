# Deployment Guide

Single-server deployment. Frontend, conductor, and postgres all run together on one VPS. Images are built locally and distributed via GitHub Container Registry (ghcr.io).

```
Dev machine
  └─ build + push → ghcr.io

VPS (palpal.app via Cloudflare tunnel, port 3001)
  ├─ palpal-frontend   (public, port 3001)
  ├─ palpal-conductor  (internal Docker network only)
  └─ postgres          (internal Docker network only)

Local PC (GPU)
  └─ blurb  →  https://palpal.app/api/worker/...
```

Blurb connects outbound to the frontend's worker proxy (`/api/worker/*`), which forwards to conductor over the internal Docker network. Conductor is never publicly exposed.

---

## One-time setup

### 1. Create ghcr.io personal access tokens

In GitHub: **Settings → Developer settings → Personal access tokens → Tokens (classic)**

Create two tokens:

- **Dev machine token**: `write:packages`, `read:packages`, `delete:packages`
- **VPS token**: `read:packages` only

### 2. Log in on the dev machine

```bash
echo "<your-token>" | docker login ghcr.io -u hunterkennedy --password-stdin
```

### 3. Set up the VPS

The VPS only needs two files in `/opt/palpal/`:

```bash
scp docker-compose.prod.yml user@yourserver.com:/opt/palpal/
scp .env.example user@yourserver.com:/opt/palpal/.env
```

Then SSH in and fill out the `.env`:

| Variable | Notes |
|---|---|
| `POSTGRES_PASSWORD` | Strong random password |
| `DATABASE_URL` | Update password to match |
| `CONDUCTOR_ADMIN_KEY` | Strong random secret |
| `ADMIN_PASSWORD` | Password for the `/admin` login page |
| `BLURB_API_KEY` | Shared with blurb — same value on both sides |
| `AUDIO_HOST_PATH` | Host path for audio storage (default `/opt/palpal-audio`) |

Log in to ghcr.io on the VPS using the read-only token:

```bash
echo "<vps-token>" | docker login ghcr.io -u hunterkennedy --password-stdin
```

Start everything:

```bash
cd /opt/palpal
docker compose -f docker-compose.prod.yml up -d
```

---

## Blurb worker setup

Blurb runs on your GPU machine and polls conductor for jobs via the frontend proxy. In blurb's `.env`:

```
CONDUCTOR_URL=https://palpal.app
BLURB_API_KEY=<shared secret — must match VPS BLURB_API_KEY>
POLL_INTERVAL=5
```

---

## Building and deploying

### Build + push

Run the build script from your dev machine. It will prompt for a version, defaulting to a patch increment:

```bash
./scripts/build-push.sh
# Version [3.0.1]: <enter to accept or type e.g. 3.1.0>
```

Images are tagged with both the version number and `latest`.

### Deploy

SSH into the VPS and run:

```bash
cd /opt/palpal
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
docker image prune -f
```

---

## Admin access

The admin panel is at `https://palpal.app/admin`. Log in with `ADMIN_PASSWORD`. All admin API calls are proxied server-side through the frontend to conductor — `CONDUCTOR_ADMIN_KEY` never reaches the browser.

---

## Verify the deployment

```bash
# Frontend health
curl -I https://palpal.app

# Conductor health (via frontend proxy)
curl https://palpal.app/api/health
```
