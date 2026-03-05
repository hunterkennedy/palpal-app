# TODO

## Admin Security
- [ ] Add Next.js middleware with HTTP Basic Auth protecting `/admin*` routes (env: `ADMIN_PASSWORD`)
- [ ] Remove admin link from Navbar (access by URL only)

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
