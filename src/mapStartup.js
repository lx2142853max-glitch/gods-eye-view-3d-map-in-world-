const clean = (value) => String(value || '').trim();

/** Server endpoint that reports the browser-facing provider keys it holds. */
export const CLIENT_CONFIG_ENDPOINT = '/api/client-config';

/**
 * Resolve the browser-facing provider keys for startup.
 *
 * Build-time defines (`import.meta.env.*`) win: the dev server re-evaluates
 * them on every restart, and an image built with the keys has them inlined.
 * A hosted production bundle (Render / Docker) is usually built WITHOUT keys —
 * they are added later in the platform's Environment tab — so any key the
 * bundle is missing is asked from the server, which reads its runtime
 * environment. Static hosts and network failures leave the build-time values
 * untouched, so the keyless globe still starts.
 *
 * @param {{googleApiKey?: string, cesiumToken?: string}} buildTime
 * @param {{fetchImpl?: Function, endpoint?: string}} [options]
 * @returns {Promise<{googleApiKey: string, cesiumToken: string}>}
 */
export async function resolveClientCredentials(
  { googleApiKey = '', cesiumToken = '' } = {},
  { fetchImpl = globalThis.fetch?.bind(globalThis), endpoint = CLIENT_CONFIG_ENDPOINT } = {},
) {
  const resolved = { googleApiKey: clean(googleApiKey), cesiumToken: clean(cesiumToken) };
  if ((resolved.googleApiKey && resolved.cesiumToken) || typeof fetchImpl !== 'function') {
    return resolved;
  }
  try {
    const response = await fetchImpl(endpoint, { cache: 'no-store' });
    if (!response?.ok) return resolved;
    const payload = await response.json();
    return {
      googleApiKey: resolved.googleApiKey || clean(payload?.googleMapsApiKey),
      cesiumToken: resolved.cesiumToken || clean(payload?.cesiumIonToken),
    };
  } catch {
    // Static host (HTML fallback), offline, or a server without the endpoint.
    return resolved;
  }
}

/**
 * Decide which map provider can deliver the best startup experience.
 * @param {{googleApiKey?: string, cesiumToken?: string}} credentials
 * @returns {'google-direct'|'google-ion'|'osm'}
 */
export function selectMapStartupRoute({ googleApiKey = '', cesiumToken = '' } = {}) {
  if (clean(googleApiKey)) return 'google-direct';
  if (clean(cesiumToken)) return 'google-ion';
  return 'osm';
}

/**
 * Load Google Photorealistic 3D Tiles through direct Google access when
 * configured, otherwise through Cesium ion's hosted Google asset. If the
 * direct request fails and an ion token is available, ion is the recovery path.
 *
 * @param {object} Cesium
 * @param {{googleApiKey?: string, cesiumToken?: string}} credentials
 * @returns {Promise<{tileset: object|null, route: 'google-direct'|'google-ion'|'osm', errors: Error[]}>}
 */
export async function loadPhotorealisticTileset(
  Cesium,
  { googleApiKey = '', cesiumToken = '' } = {},
) {
  const googleKey = clean(googleApiKey);
  const ionToken = clean(cesiumToken);
  const errors = [];

  if (ionToken) Cesium.Ion.defaultAccessToken = ionToken;

  const attempts = [];
  if (googleKey) attempts.push({ route: 'google-direct', googleKey });
  if (ionToken) attempts.push({ route: 'google-ion', googleKey: undefined });

  for (const attempt of attempts) {
    Cesium.GoogleMaps.defaultApiKey = attempt.googleKey;
    try {
      const tileset = await Cesium.createGooglePhotorealistic3DTileset({
        onlyUsingWithGoogleGeocoder: true,
      });
      return { tileset, route: attempt.route, errors };
    } catch (error) {
      errors.push(error instanceof Error ? error : new Error(String(error)));
    }
  }

  Cesium.GoogleMaps.defaultApiKey = undefined;
  return { tileset: null, route: 'osm', errors };
}
