## Learned User Preferences
- Prefer JavaScript/React for this project; treat custom TRMNL firmware or C++ as a later option, not v1.
- Build a custom BYOS server, not a TRMNL recipe, Liquid plugin, or byos_next.
- Prefer atomic Conventional Commits (granular-git-commit skill); use the `cursor/` branch prefix for new work.
- When asked, use Cloudflare MCP to deploy and manage Workers; commit and push only when explicitly requested.
- Realtime motion belongs on the web UI; the OG stays an e-ink snapshot (about 30–120s), not live radar.
- Prefer a square filled-coastline chart (black land, vessel heading ticks) over PPI radar rings; the map should fill the square.

## Learned Workspace Facts
- Harbor Scope is a custom TRMNL BYOS ship radar: Vite + React SPA (Cloudflare Vite plugin), Hono Worker, KV, minute cron, TypeScript, Vitest.
- Official TRMNL OG firmware stays on the device; custom/stay-awake firmware is out of scope for v1.
- AIS comes from AISStream (WebSocket); cron listens ~45s each minute, coasts moving tracks for 3 minutes, and shows moving vessels only (default min SOG 0.5 kn).
- Default radar center is Narragansett Bay (41.6, -71.33) at 15 NM (zoom presets 1–25 NM); origin is parsed from AIS destination `ORIGIN>DEST` / UN/LOCODE.
- The e-ink chart uses filled southern New England coast polygons and heading ticks (no range rings); coastline must cover at least the 25 NM zoom.
- BYOS endpoints are `/api/setup`, `/api/display`, `/api/log`; the device custom-server base is `/t/<DEVICE_TOKEN>` because firmware appends `/api/display`.
- The e-ink frame is an 800×480 1-bit PNG under 90KB; `/api/screen.png` accepts device or dashboard auth because the preview `<img>` cannot send a Bearer header.
- Workers Paid is required (cron CPU + PNG render). Secrets `AISSTREAM_API_KEY`, `DEVICE_TOKEN`, and `DASHBOARD_TOKEN` live in wrangler secrets / `.dev.vars` and must never be committed.
- GitHub repo is `a-j-bailey/ship-dashboard`; Worker name is `ship-dashboard`; production branch is `main`.
- USB only charges the OG; screens arrive over Wi-Fi after joining the `TRMNL` AP and setting Custom Server (no trailing slash).
- Control UI: paste `DASHBOARD_TOKEN`, Arm, then Apply + sweep; device refresh 30–3600s (default 120); click the chart to set a new center.
- Production CI should `npm run build` then `npx wrangler deploy`; non-production branch builds must use `npx wrangler versions upload`, not `wrangler deploy`.
