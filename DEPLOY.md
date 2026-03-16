# Deployment Guide

Split deployment: conductor + postgres on one server, frontend on a cheap VPS. Images are built locally and distributed via GitHub Container Registry (ghcr.io).

```
Dev machine
  └─ build + push → ghcr.io

Conductor server (api.palpal.app via Cloudflare tunnel)
  ├─ postgres
  └─ palpal-conductor

Frontend VPS (palpal.app via Cloudflare tunnel)
  └─ palpal-frontend  →  https://api.palpal.app

Local PC (GPU)
  └─ palpal-blurb  ←  polled by conductor at https://api.palpal.app
```

---

## One-time setup

### 1. Create a ghcr.io personal access token

In GitHub: **Settings → Developer settings → Personal access tokens → Fine-grained tokens**

Scopes needed: `write:packages`, `read:packages`, `delete:packages`

Save it — you'll need it for the dev machine and both servers.

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

## Conductor server setup

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
sudo mkdir -p /opt/palpal
sudo chown $USER:$USER /opt/palpal
mkdir -p /opt/palpal-audio   # or wherever you want audio stored
```

### 4. Copy files to the server

From your dev machine:

```bash
scp docker-compose.conductor.yml user@yourserver.com:/opt/palpal/
scp .env.conductor.example user@yourserver.com:/opt/palpal/.env
```

### 5. Edit the env file

```bash
ssh user@yourserver.com
nano /opt/palpal/.env
```

Fill in the values (see `.env.conductor.example` for all variables):

| Variable | Notes |
|---|---|
| `POSTGRES_PASSWORD` | Strong random password |
| `DATABASE_URL` | Update password to match |
| `CONDUCTOR_ADMIN_KEY` | Strong random secret |
| `BLURB_API_KEY` | Shared with blurb — same value on both sides |
| `BLURB_URL` | Network address of your GPU machine, e.g. `http://192.168.1.x:8001` |
| `AUDIO_HOST_PATH` | Host path for audio storage, e.g. `/opt/palpal-audio` |
| `GHCR_USER` | Your GitHub username |

### 6. Start postgres + conductor

```bash
cd /opt/palpal
docker compose -f docker-compose.conductor.yml up -d
docker compose -f docker-compose.conductor.yml logs -f palpal-conductor
```

### 7. Set up the Cloudflare tunnel

Install and authenticate `cloudflared`, then use `cloudflared.yml.example` as your tunnel config. The key section blocks admin routes from the public internet:

```yaml
ingress:
  - hostname: api.palpal.app
    path: ^/admin
    service: http_status:403
  - hostname: api.palpal.app
    service: http://localhost:8000
  - service: http_status:404
```

Any request to `api.palpal.app/admin/*` returns 403. Admin operations are done locally — see [Admin access](#admin-access) below.

---

## Frontend VPS setup

### 1. Install Docker

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
```

### 2. Log in to ghcr.io

```bash
echo "<your-token>" | docker login ghcr.io -u <your-github-username> --password-stdin
```

### 3. Create the deploy directory

```bash
sudo mkdir -p /opt/palpal
sudo chown $USER:$USER /opt/palpal
```

### 4. Copy files to the VPS

From your dev machine:

```bash
scp docker-compose.frontend.yml user@vps.com:/opt/palpal/
scp .env.frontend.example user@vps.com:/opt/palpal/.env
```

### 5. Edit the env file

```bash
ssh user@vps.com
nano /opt/palpal/.env
```

| Variable | Value |
|---|---|
| `CONDUCTOR_URL` | `https://api.palpal.app` |
| `CONDUCTOR_ADMIN_KEY` | Same value as on the conductor server |
| `GHCR_USER` | Your GitHub username |

### 6. Start the frontend

```bash
cd /opt/palpal
docker compose -f docker-compose.frontend.yml up -d
```

### 7. Set up the Cloudflare tunnel

Point it at `http://localhost:3001` (or whatever `APP_PORT` is). No path restrictions needed here.

---

## Update blurb

Conductor polls blurb for job status. In your blurb config, set the API key:

```
BLURB_API_KEY=<shared secret>
```

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

Set SSH targets once in your shell profile:

```bash
export CONDUCTOR_SSH=user@yourserver.com
export FRONTEND_SSH=user@vps.com
```

Then deploy:

```bash
# Deploy both
./scripts/deploy-conductor.sh
./scripts/deploy-frontend.sh

# Or a specific tag
./scripts/deploy-conductor.sh v1.2
./scripts/deploy-frontend.sh v1.2
```

Each deploy script SSHes into the server, pulls the new image, restarts the container, and prunes old images.

---

## Admin access

Admin routes (`/admin/*`) are blocked at the Cloudflare tunnel. To use them, forward the conductor port over SSH:

```bash
ssh -L 8000:localhost:8000 user@yourserver.com
```

Then in another terminal, hit the admin API normally:

```bash
# Pipeline status
curl -s http://localhost:8000/admin/status \
  -H "Authorization: Bearer <CONDUCTOR_ADMIN_KEY>" | jq

# Trigger discovery
curl -s -X POST http://localhost:8000/admin/discover \
  -H "Authorization: Bearer <CONDUCTOR_ADMIN_KEY>" | jq

# Retry a failed episode
curl -s -X POST http://localhost:8000/admin/episodes/<id>/retry \
  -H "Authorization: Bearer <CONDUCTOR_ADMIN_KEY>" | jq
```

The frontend admin panel (`/admin`) won't work remotely — it calls conductor's admin routes which are blocked. Use the SSH tunnel + curl above instead.

---

## Verify the deployment

```bash
# Conductor health (public)
curl https://api.palpal.app/health

# Frontend (should load the search UI)
curl -I https://palpal.app

# Admin blocked (should return 403)
curl -I https://api.palpal.app/admin/status
```
