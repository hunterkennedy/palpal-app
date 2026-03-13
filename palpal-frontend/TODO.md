# TODO

## Admin Security
- [x] Conductor admin panel moved to `http://localhost:${CONDUCTOR_PORT}/admin` — local-only,
      all API endpoints protected with Bearer token (CONDUCTOR_ADMIN_KEY). Secured.
- [x] Frontend `/admin` page and proxy route deleted — admin is conductor-local only
- [x] Admin link removed from Navbar

## Self-Service Podcast Addition
- [ ] Admin panel form: podcast_id (manual text), display name, YouTube channel URL
- [ ] POST to conductor to create `podcasts` + `sources` rows, trigger discovery
- [ ] Show alert with error message if conductor rejects it

## Patreon
- [ ] Admin panel: text field to paste Patreon session cookie string (exported via browser extension)
- [ ] POST cookie to conductor to store on disk for patreon-dl use
- [ ] Wire patreon-dl into conductor discovery + download pipeline

## Deployment Split (conductor local, frontend on droplet)
- [ ] Expose conductor via Tailscale (or Cloudflare Tunnel) so droplet can reach it
- [ ] Frontend only needs `CONDUCTOR_URL` pointed at the tunnel address
