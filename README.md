# Harbor Scope — TRMNL ship radar

Custom BYOS server for a TRMNL OG. It is **not** a TRMNL recipe. Official firmware stays on the device; this Worker speaks `/api/setup`, `/api/display`, `/api/log` and serves an 800×480 1-bit radar PNG of **moving** AIS contacts (name + origin port).

## What you need

- Cloudflare account on the **Workers Paid** plan (cron CPU + PNG render)
- Free [AISStream](https://aisstream.io/) API key
- TRMNL OG on the same Wi-Fi as usual (USB only charges; screens still come over Wi-Fi)

## Local

```bash
cp .dev.vars.example .dev.vars
# fill AISSTREAM_API_KEY, DEVICE_TOKEN, DASHBOARD_TOKEN
npm install
npx wrangler types
npm test
npm run dev
```

Open the Vite URL, paste `DASHBOARD_TOKEN`, click **Arm**, then **Apply + sweep**.

## Deploy

```bash
npx wrangler login
npx wrangler kv namespace create SHIP_RADAR
# paste the id into wrangler.jsonc kv_namespaces[0].id
npx wrangler secret put AISSTREAM_API_KEY
npx wrangler secret put DEVICE_TOKEN
npx wrangler secret put DASHBOARD_TOKEN
npx wrangler types
npm run deploy
```

Note the Worker URL, e.g. `https://ship-dashboard.<subdomain>.workers.dev`.

## Point the OG at this server

1. Hold the OG button ~5 seconds until the setup screen appears.
2. Join the `TRMNL` Wi-Fi network.
3. Choose **Custom server**.
4. Enter:

```
https://ship-dashboard.<subdomain>.workers.dev/t/YOUR_DEVICE_TOKEN
```

Firmware appends `/api/display` onto that base, which is why the token lives in the path.

5. Watch `npx wrangler tail` for `/api/setup` then `/api/display`.
6. Tune center/zoom on the web UI (default: Boston Harbor, 8 NM).

## Control UI

- Center lat/lng, zoom in nautical miles, min SOG, device refresh seconds (30–3600, default 120)
- Live PNG preview of what the OG will paint
- Moving-vessel table (name, origin, destination, SOG, COG)

Cron samples AISStream for ~12 seconds every minute and re-renders the PNG. **Apply + sweep** does the same on demand.

## Tests

```bash
npm test
```

Port parser, moving filter, bbox defaults, BYOS JSON (`filename` + string `refresh_rate`), and 800×480 1-bit PNG size.
