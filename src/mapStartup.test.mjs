import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CLIENT_CONFIG_ENDPOINT,
  loadPhotorealisticTileset,
  resolveClientCredentials,
  selectMapStartupRoute,
} from './mapStartup.js';

function fakeFetch(outcome) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (outcome instanceof Error) throw outcome;
    return outcome;
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

const jsonResponse = (payload, ok = true) => ({ ok, json: async () => payload });
const htmlResponse = () => ({ ok: true, json: async () => { throw new SyntaxError('Unexpected token <'); } });

function fakeCesium(outcomes = []) {
  const calls = [];
  return {
    calls,
    Ion: { defaultAccessToken: undefined },
    GoogleMaps: { defaultApiKey: undefined },
    async createGooglePhotorealistic3DTileset(options) {
      calls.push({
        options,
        googleKey: this.GoogleMaps.defaultApiKey,
        ionToken: this.Ion.defaultAccessToken,
      });
      const outcome = outcomes.shift();
      if (outcome instanceof Error) throw outcome;
      return outcome;
    },
  };
}

test('build-time keys are used as-is without asking the server', async () => {
  const fetchImpl = fakeFetch(jsonResponse({ googleMapsApiKey: 'runtime', cesiumIonToken: 'runtime' }));
  const result = await resolveClientCredentials(
    { googleApiKey: ' build-google ', cesiumToken: 'build-ion' },
    { fetchImpl },
  );
  assert.deepEqual(result, { googleApiKey: 'build-google', cesiumToken: 'build-ion' });
  assert.equal(fetchImpl.calls.length, 0);
});

test('a hosted bundle built without keys receives them from the runtime environment', async () => {
  const fetchImpl = fakeFetch(jsonResponse({ googleMapsApiKey: ' google-key ', cesiumIonToken: 'ion-token' }));
  const result = await resolveClientCredentials({}, { fetchImpl });
  assert.deepEqual(result, { googleApiKey: 'google-key', cesiumToken: 'ion-token' });
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(fetchImpl.calls[0].url, CLIENT_CONFIG_ENDPOINT);
  assert.equal(fetchImpl.calls[0].init.cache, 'no-store');
});

test('only the missing key is filled from the server; build-time values still win', async () => {
  const fetchImpl = fakeFetch(jsonResponse({ googleMapsApiKey: 'runtime-google', cesiumIonToken: 'runtime-ion' }));
  const result = await resolveClientCredentials({ googleApiKey: 'build-google' }, { fetchImpl });
  assert.deepEqual(result, { googleApiKey: 'build-google', cesiumToken: 'runtime-ion' });
});

test('static hosts, offline starts, and servers without the endpoint keep the keyless globe', async () => {
  for (const outcome of [
    htmlResponse(),                       // SPA fallback / GitHub Pages
    jsonResponse({}, false),              // 404 / 5xx
    jsonResponse(null),                   // empty body
    new TypeError('Failed to fetch'),     // offline
  ]) {
    const result = await resolveClientCredentials({}, { fetchImpl: fakeFetch(outcome) });
    assert.deepEqual(result, { googleApiKey: '', cesiumToken: '' });
  }
  const noFetch = await resolveClientCredentials({ cesiumToken: 'ion' }, { fetchImpl: undefined });
  assert.deepEqual(noFetch, { googleApiKey: '', cesiumToken: 'ion' });
});

test('map startup route reflects the best configured provider', () => {
  assert.equal(selectMapStartupRoute({ googleApiKey: 'google', cesiumToken: 'ion' }), 'google-direct');
  assert.equal(selectMapStartupRoute({ cesiumToken: 'ion' }), 'google-ion');
  assert.equal(selectMapStartupRoute(), 'osm');
});

test('no credentials skip photoreal loading and preserve keyless startup', async () => {
  const Cesium = fakeCesium();
  const result = await loadPhotorealisticTileset(Cesium);
  assert.equal(result.tileset, null);
  assert.equal(result.route, 'osm');
  assert.equal(Cesium.calls.length, 0);
});

test('a direct Google key is preferred', async () => {
  const tileset = { id: 'direct' };
  const Cesium = fakeCesium([tileset]);
  const result = await loadPhotorealisticTileset(Cesium, {
    googleApiKey: 'google-secret',
    cesiumToken: 'ion-secret',
  });
  assert.equal(result.tileset, tileset);
  assert.equal(result.route, 'google-direct');
  assert.equal(Cesium.calls[0].googleKey, 'google-secret');
});

test('an ion-only setup loads the hosted Google 3D asset', async () => {
  const tileset = { id: 'ion' };
  const Cesium = fakeCesium([tileset]);
  const result = await loadPhotorealisticTileset(Cesium, { cesiumToken: 'ion-secret' });
  assert.equal(result.tileset, tileset);
  assert.equal(result.route, 'google-ion');
  assert.equal(Cesium.calls.length, 1);
  assert.equal(Cesium.calls[0].googleKey, undefined);
  assert.equal(Cesium.calls[0].ionToken, 'ion-secret');
  assert.equal(Cesium.Ion.defaultAccessToken, 'ion-secret');
});

test('a failed direct request retries through ion before falling back', async () => {
  const tileset = { id: 'ion-fallback' };
  const Cesium = fakeCesium([new Error('direct denied'), tileset]);
  const result = await loadPhotorealisticTileset(Cesium, {
    googleApiKey: 'google-secret',
    cesiumToken: 'ion-secret',
  });
  assert.equal(result.tileset, tileset);
  assert.equal(result.route, 'google-ion');
  assert.equal(result.errors.length, 1);
  assert.equal(Cesium.calls[0].googleKey, 'google-secret');
  assert.equal(Cesium.calls[1].googleKey, undefined);
  assert.equal(Cesium.calls.length, 2);
});

test('a failed direct-only request does not consume an implicit Cesium token', async () => {
  const Cesium = fakeCesium([new Error('direct denied')]);
  const result = await loadPhotorealisticTileset(Cesium, {
    googleApiKey: 'google-secret',
  });
  assert.equal(result.tileset, null);
  assert.equal(result.route, 'osm');
  assert.equal(result.errors.length, 1);
  assert.equal(Cesium.calls.length, 1);
  assert.equal(Cesium.calls[0].googleKey, 'google-secret');
  assert.equal(Cesium.GoogleMaps.defaultApiKey, undefined);
});

test('failed direct and ion requests preserve the keyless OSM fallback', async () => {
  const Cesium = fakeCesium([new Error('direct denied'), new Error('ion denied')]);
  const result = await loadPhotorealisticTileset(Cesium, {
    googleApiKey: 'google-secret',
    cesiumToken: 'ion-secret',
  });
  assert.equal(result.tileset, null);
  assert.equal(result.route, 'osm');
  assert.equal(result.errors.length, 2);
  assert.equal(Cesium.calls.length, 2);
  assert.equal(Cesium.GoogleMaps.defaultApiKey, undefined);
});
