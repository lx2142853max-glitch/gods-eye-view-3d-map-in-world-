# God's Eye View — container image (Render / Docker Compose / any VPS)
#
# The image builds the production bundle (`vite build` → dist/) at IMAGE BUILD
# time and serves it at runtime with `vite preview` (`npm start`). The data
# relays (flights, ships, quakes, CCTV, radio, voice proxies) are Vite plugin
# middleware defined in vite.config.js and are mounted on the preview server
# too, so the hosted app gets the same live data as `npm run dev`.
#
# Why not run the dev server in production? It transforms every module on
# demand and pre-bundles Cesium (~14 MB) with esbuild on the first request.
# On a small instance (Render free tier: 512 MB RAM, fractional CPU) that
# takes minutes or gets OOM-killed, so visitors only ever saw the static
# loading screen — the globe never appeared.
#
# See SECURITY.md before exposing the image publicly, and put your own auth in
# front if you do.
FROM node:24-slim

WORKDIR /app

# Puppeteer is only used by QA scripts; skip its ~300MB Chromium download.
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    HOST=0.0.0.0 \
    PORT=4173

# Install dependencies first for better layer caching. Dev dependencies stay:
# `vite` (preview server), `vite-plugin-cesium` (config import) and `ws`
# (AIS relay transport) are all needed at runtime.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Copy the rest of the app (see .dockerignore for exclusions) and build the
# production bundle. API keys are NOT baked into the image: the ones the
# browser needs (GOOGLE_MAPS_API_KEY / CESIUM_ION_TOKEN) are read from the
# runtime environment by the server-side relays and the keyless Esri globe
# works without any of them.
COPY . .
RUN npm run build

# Render overrides PORT (default 10000) at runtime; the server honours it.
EXPOSE 4173

# Cheap liveness probe for Docker Compose / orchestrators (Render uses
# healthCheckPath from render.yaml instead).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 4173) + '/').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["npm", "start"]
