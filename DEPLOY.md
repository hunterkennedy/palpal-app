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
  └─ palpal-blurb  →  https://palpal.app/api/worker/...
```

Blurb connects outbound to the frontend's worker proxy (`/api/worker/*`), which forwards to conductor over the internal Docker network. Conductor is never publicly exposed.

---

## One-time setup

### 1. Create a ghcr.io personal access token

In GitHub: **Settings → Developer settings → Personal access tokens → Fine-grained tokens**

Scopes needed: `write:packages`, `read:packages`, `delete:packages`

Save it — you'll need it on the dev machine and the VPS.

### 2. Log in on the dev machine

```bash
echo "<your-token>" | docker login ghcr.io -u <your-github-username> --password-stdin
```

### 3. Export your GitHub username

Add to your shell profile (`~/.bashrc` or `~/.zshrc`):

```bash
export GHCR_USER=your-github-username
```

---

## VPS setup

### 1. Install Docker

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# log out and back in
```

### 2. Log in to ghcr.io

```bash
echo "<your-token>" | docker login ghcr.io -u <your-github-username> --password-stdin
```

### 3. Create the deploy directory

```bash
sudo mkdir -p /opt/palpal /opt/palpal-audio
sudo chown $USER:$USER /opt/palpal /opt/palpal-audio
```

### 4. Copy files to the VPS

From your dev machine:

```bash
scp docker-compose.prod.yml user@yourserver.com:/opt/palpal/
scp .env.example user@yourserver.com:/opt/palpal/.env
```

### 5. Edit the env file

```bash
ssh user@yourserver.com
nano /opt/palpal/.env
```

| Variable | Notes |
|---|---|
| `POSTGRES_PASSWORD` | Strong random password |
| `DATABASE_URL` | Update password to match |
| `CONDUCTOR_ADMIN_KEY` | Strong random secret |
| `ADMIN_PASSWORD` | Password for the `/admin` login page |
| `ADMIN_SESSION_TOKEN` | Long random string (session cookie value) |
| `BLURB_API_KEY` | Shared with blurb — same value on both sides |
| `AUDIO_HOST_PATH` | Host path for audio storage (default `/opt/palpal-audio`) |
| `GHCR_USER` | Your GitHub username |

### 6. Start everything

```bash
cd /opt/palpal
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml logs -f
```

### 7. Set up the Cloudflare tunnel

Install `cloudflared`, authenticate, and create a tunnel pointing `palpal.app` at `http://localhost:3001`. Use `cloudflared.yml.example` as your config template.

```bash
cloudflared tunnel login
cloudflared tunnel create palpal
# edit cloudflared.yml.example, then:
cloudflared tunnel run palpal
```

---

## Blurb worker setup

Blurb runs on your GPU machine and polls conductor for jobs via the frontend proxy. In blurb's `.env`:

```
CONDUCTOR_URL=https://palpal.app
BLURB_API_KEY=<shared secret — must match VPS BLURB_API_KEY>
POLL_INTERVAL=5
```

No Cloudflare Access service tokens needed. The worker proxy at `/api/worker/*` validates the `BLURB_API_KEY` directly.

---

## Building and deploying

### Build + push from dev machine

```bash
# Tag defaults to "latest"
./scripts/build-push.sh

# Or with an explicit tag
./scripts/build-push.sh v1.2
```

### Deploy

Set SSH target once in your shell profile:

```bash
export CONDUCTOR_SSH=user@yourserver.com
```

Then deploy:

```bash
./scripts/deploy-conductor.sh    # redeploys conductor
./scripts/deploy-frontend.sh     # redeploys frontend

# Or a specific tag
./scripts/deploy-conductor.sh v1.2
./scripts/deploy-frontend.sh v1.2
```

Each script SSHes into the VPS, pulls the new image, restarts the container, and prunes old images.

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
