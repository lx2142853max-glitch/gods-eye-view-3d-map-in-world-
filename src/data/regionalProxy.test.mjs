import { test } from 'node:test';
import assert from 'node:assert/strict';
import createViteConfig, {
  adsbLolFallbackAnchor,
  clientConfigPayload,
  coalesceProxyRequest,
  launchLibraryRequestHeaders,
  keylessGooglePlacesResponse,
  LL2_CACHE_TTL_MS,
  PREVIEW_SERVED_RELAY_PLUGINS,
  readResponseJsonCapped,
  regionalBriefHasAnySource,
  validMilitaryInstallationBox,
  validRegionalPoint,
  withPreviewServer,
} from '../../vite.config.js';

test('missing Google place context is a quiet keyless capability, not a 503', () => {
  assert.deepEqual(keylessGooglePlacesResponse(undefined), {
    statusCode: 200,
    payload: { configured: false, error: null, places: [] },
  });
  assert.deepEqual(keylessGooglePlacesResponse('   '), {
    statusCode: 200,
    payload: { configured: false, error: null, places: [] },
  });
  assert.equal(keylessGooglePlacesResponse('configured-key'), null);
});

test('regional proxy rejects absent and blank coordinates instead of coercing them to zero', () => {
  assert.equal(validRegionalPoint(new URLSearchParams('longitude=12.5')), null);
  assert.equal(validRegionalPoint(new URLSearchParams('latitude=12.5')), null);
  assert.equal(validRegionalPoint(new URLSearchParams('latitude=&longitude=12.5')), null);
  assert.deepEqual(
    validRegionalPoint(new URLSearchParams('latitude=0&longitude=0')),
    { latitude: 0, longitude: 0 },
  );
});

test('adjacent proxy validators also require every coordinate explicitly', () => {
  assert.equal(
    validMilitaryInstallationBox(new URLSearchParams('west=-1&north=1&east=1')),
    null,
  );
  assert.equal(adsbLolFallbackAnchor({ url: '?lat=12.5' }), null);
  assert.equal(adsbLolFallbackAnchor({ url: '?lon=12.5' }), null);
});

test('new data proxies install the same routes in dev and preview servers', () => {
  const config = createViteConfig({ mode: 'test' });
  const byName = new Map(config.plugins.map((plugin) => [plugin.name, plugin]));
  for (const name of [
    'rocket-launches-proxy',
    'military-installations-proxy',
    'regional-brief-proxy',
    'weather-effects-proxy',
  ]) {
    assert.equal(typeof byName.get(name)?.configureServer, 'function', `${name} dev hook`);
    assert.equal(typeof byName.get(name)?.configurePreviewServer, 'function', `${name} preview hook`);
  }
});

test('every data relay answers on the production preview server (Render / Docker run `npm start`)', () => {
  const config = createViteConfig({ mode: 'test' });
  const byName = new Map(config.plugins.map((plugin) => [plugin.name, plugin]));
  for (const name of PREVIEW_SERVED_RELAY_PLUGINS) {
    const plugin = byName.get(name);
    assert.ok(plugin, `${name} is registered`);
    assert.equal(typeof plugin.configureServer, 'function', `${name} dev hook`);
    assert.equal(typeof plugin.configurePreviewServer, 'function', `${name} preview hook`);
  }
  // Provider Settings writes .env and calls server.restart(): dev-only by design.
  const keySetup = byName.get('gev-key-setup');
  assert.equal(typeof keySetup?.configureServer, 'function');
  assert.equal(keySetup?.configurePreviewServer, undefined);
});

test('withPreviewServer reuses the dev hook without clobbering a dedicated preview hook', () => {
  const shared = () => {};
  const wrapped = withPreviewServer({ name: 'shared', configureServer: shared });
  assert.equal(wrapped.configurePreviewServer, shared);

  const devOnly = () => {};
  const previewOnly = () => {};
  const dedicated = withPreviewServer({
    name: 'dedicated',
    configureServer: devOnly,
    configurePreviewServer: previewOnly,
  });
  assert.equal(dedicated.configurePreviewServer, previewOnly);

  const plain = { name: 'plain' };
  assert.equal(withPreviewServer(plain), plain);
  assert.equal(plain.configurePreviewServer, undefined);
});

test('preview server mirrors the dev binding so PORT/HOST work identically on Render', () => {
  const previous = { HOST: process.env.HOST, PORT: process.env.PORT };
  try {
    process.env.HOST = '0.0.0.0';
    process.env.PORT = '10000';
    const hosted = createViteConfig({ mode: 'test' });
    assert.equal(hosted.preview.host, '0.0.0.0');
    assert.equal(hosted.preview.port, 10000);
    assert.equal(hosted.preview.strictPort, true);
    assert.equal(hosted.preview.allowedHosts, true);
    assert.equal(hosted.server.port, 10000);
    assert.deepEqual(hosted.preview.headers, hosted.server.headers);

    delete process.env.HOST;
    delete process.env.PORT;
    const local = createViteConfig({ mode: 'test' });
    assert.equal(local.preview.host, 'localhost');
    assert.equal(local.preview.port, 4173);
    assert.deepEqual(local.preview.allowedHosts, ['localhost', '127.0.0.1', '.local']);
    assert.equal(local.preview.headers['X-Frame-Options'], 'DENY');
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('client-config exposes only the browser-facing keys, trimmed, from the runtime env', () => {
  assert.deepEqual(clientConfigPayload({}), { googleMapsApiKey: '', cesiumIonToken: '' });
  assert.deepEqual(
    clientConfigPayload({
      GOOGLE_MAPS_API_KEY: '  google-key ',
      CESIUM_ION_TOKEN: 'ion-token',
      OPENAI_API_KEY: 'server-secret',
      OPENSKY_CLIENT_SECRET: 'server-secret',
    }),
    { googleMapsApiKey: 'google-key', cesiumIonToken: 'ion-token' },
  );
});

test('Launch Library uses a 15-minute cache and optional server-side token header', () => {
  assert.equal(LL2_CACHE_TTL_MS, 15 * 60_000);
  assert.deepEqual(launchLibraryRequestHeaders(''), { Accept: 'application/json' });
  assert.deepEqual(launchLibraryRequestHeaders(' secret '), {
    Accept: 'application/json',
    Authorization: 'Token secret',
  });
});

test('proxy request coalescing shares one per-key refresh and clears it after settlement', async () => {
  const inFlight = new Map();
  let refreshCount = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const first = coalesceProxyRequest(inFlight, 'cell', async () => {
    refreshCount += 1;
    await gate;
    return 'fresh';
  });
  const second = coalesceProxyRequest(inFlight, 'cell', () => {
    refreshCount += 1;
    return 'duplicate';
  });
  assert.equal(first.shared, false);
  assert.equal(second.shared, true);
  assert.equal(first.promise, second.promise);
  release();
  assert.equal(await second.promise, 'fresh');
  assert.equal(refreshCount, 1);
  assert.equal(inFlight.size, 0);
});

test('bounded JSON reader rejects oversized upstream bodies', async () => {
  assert.deepEqual(await readResponseJsonCapped(new Response('{"ok":true}'), 32), { ok: true });
  await assert.rejects(
    readResponseJsonCapped(new Response(JSON.stringify({ value: 'x'.repeat(64) })), 32),
    (error) => error?.code === 'RESPONSE_TOO_LARGE',
  );
});

test('regional brief treats an all-source outage as total failure', () => {
  assert.equal(regionalBriefHasAnySource({
    place: null,
    weather: null,
    news: { status: 'unavailable' },
  }), false);
  assert.equal(regionalBriefHasAnySource({
    place: { country: 'United States' },
    weather: null,
    news: { status: 'unavailable' },
  }), true);
});
