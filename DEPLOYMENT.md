# 🚀 Deploying God's Eye View

> **TL;DR (daily phone use):** Deploy free on Render → open the URL on your
> phone → browser menu → **"Add to Home screen"** → full-screen daily map app.

---

## Why not GitHub Pages / Netlify / Vercel (static)?

This app is **not a static site**. Its data relays — flights (ADS-B), ships
(AIS), earthquakes, wildfires, CCTV, radio, voice proxies — are **Vite plugin
middleware** defined in `vite.config.js`. A static export gives you an empty
globe with no live data. You need a **Node server** (this repo ships a
Dockerfile that runs exactly that).

## How the hosted server works

The container **builds the production bundle once** (`npm run build` →
`dist/`) and serves it with **`npm start`** (= `vite preview`). Every relay is
mounted on that preview server too, so the hosted app gets the same live data
as `npm run dev` — while staying small enough for a free-tier instance
(~120 MB RSS, static files, no on-demand transforms).

> **Do not run `npm run dev` in production.** The dev server transforms every
> module on demand and pre-bundles Cesium (~14 MB) with esbuild on the first
> request. On 512 MB / fractional CPU that takes minutes or gets OOM-killed, so
> visitors only ever see the static loading screen (logo + "Initializing
> photorealistic world…") — the globe never appears.

**API keys are read at runtime.** The browser-facing keys
(`GOOGLE_MAPS_API_KEY`, `CESIUM_ION_TOKEN`) are served from
`GET /api/client-config`, which reads the server's environment on every
request. Adding them in Render's Environment tab (or `docker compose`
`environment:`) switches Google 3D Tiles on without touching the image build.

---

## Option A — Render (free, easiest for 24/7 personal use)

1. Push this repo to **your** GitHub account.
2. Go to [render.com](https://render.com) → sign in with GitHub →
   **New + → Blueprint** → select the repo → **Apply** (uses `render.yaml`).
   - If you create the service by hand instead, pick **Web Service → Docker**
     (NOT "Static Site" — a static site has no relays and no live data).
3. Wait ~5 min for the first build. Done — you get a `https://<name>.onrender.com` URL.

**Free-plan notes:**
- Sleeps after ~15 min idle; first visit after that takes ~1 min to wake
  (you'll see the loading screen while it wakes — that's normal).
- 512 MB RAM — fine for one or two simultaneous viewers.
- Render injects `PORT=10000`; the server binds to it automatically.

**Add API keys later** (optional): Render dashboard → your service →
**Environment** → add `GOOGLE_MAPS_API_KEY` / `CESIUM_ION_TOKEN` /
`OPENAI_API_KEY` → save (auto redeploys). Keyless mode works on Esri imagery.

**If you deployed before this fix** (the Dockerfile ran the dev server): just
push the updated repo, or click **Manual Deploy → Clear build cache & deploy**
in the Render dashboard.

### Phone pe daily use
1. Chrome mein Render URL kholo.
2. Menu (⋮) → **"Add to Home screen"**.
3. Ab home screen icon se full-screen map app ki tarah khulega. 📱

---

## Option B — Any VPS with Docker (Hetzner / DigitalOcean / Oracle free tier)

```bash
git clone https://github.com/<you>/gods-eye-view.git && cd gods-eye-view
docker compose up -d --build
```

- App: `http://<server-ip>:4173`
- 24/7 chalta rahega (`restart: unless-stopped`).
- HTTPS/domain ke liye nginx + certbot lagao.

**Without Docker** (any box with Node 24):

```bash
npm ci
npm run build
HOST=0.0.0.0 PORT=4173 npm start      # keep alive with pm2 / systemd
```

---

## Option C — Tunnel from your own PC (free, PC-on-only)

```bash
npm install
npm run build && HOST=0.0.0.0 npm start          # terminal 1 (or: HOST=0.0.0.0 npm run dev)
cloudflared tunnel --url http://localhost:4173   # terminal 2 (or: ngrok http 4173)
```

You get a temporary public HTTPS URL. Good for demos, not for 24/7.

---

## ⚠️ Security (SECURITY.md summary)

God's Eye View is a **local-first explorer, not a hardened production
service**. Anyone who can reach the server can **spend your API quotas**
(OpenAI / Google / OpenSky / AISStream). So:

- **Public URL:** fine for personal use, but keep API keys minimal + set
  provider budget alerts, or put basic-auth (nginx/Caddy) in front.
- **LAN only:** run `HOST=0.0.0.0 npm run dev` on your own machine — nothing
  leaves your network.

---

## Verify the deployment

- `GET /` → 200 (globe loads, keyless Esri imagery)
- `GET /api/client-config` → JSON like `{"googleMapsApiKey":"","cesiumIonToken":""}`
  (proves the relay middleware is live — a static host or a misconfigured
  server answers with the HTML page instead).
- Open devtools Network → `/api/opensky`, `/api/celestrak/...` return JSON
  (a 502 with a JSON body still means the relay is mounted; the upstream was
  just unreachable at that moment).

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Only the loading screen (logo + status line) ever shows | Server is running the dev server on a tiny instance, or the instance is still waking up | Deploy the current Dockerfile (`npm start`); wait ~1 min after a cold start |
| Status line says `Error: …WebGL…` | Browser/GPU has WebGL disabled | Enable hardware acceleration, or try another browser |
| Globe loads but every layer is empty | `/api/*` answers HTML (static host, or preview server without the relays) | Host it as a Node/Docker service from this repo |
| `Blocked request. This host is not allowed` | `HOST` is not `0.0.0.0` | Set `HOST=0.0.0.0` in the environment |
