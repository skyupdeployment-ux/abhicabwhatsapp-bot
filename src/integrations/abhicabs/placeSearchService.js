const axios = require('axios');
const env = require('../../config/env');
const { logger } = require('../../config/logger');

const LIMIT = 8; // a WhatsApp list holds 10 rows: 8 places + "Search again" + "Use what I typed"

function parseNear(value) {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(value || '');
  return m ? { latitude: Number(m[1]), longitude: Number(m[2]) } : null;
}

/**
 * Finds places by name with Google Places "Text Search (New)", so a customer can type
 * "Hebbal" and pick the exact one: Hebbal Flyover, Hebbal Baptist Hospital, Hebbal Lake ...
 * Returns up to 8 of { name, address, latitude, longitude } — or [] when no key is set,
 * the Places API (New) is not enabled for the key, or nothing matches (the caller then
 * falls back to the text exactly as typed). Never logs the API key.
 *
 * Results lean towards `near` (e.g. the pickup point) or, if that is missing, towards
 * PLACE_SEARCH_NEAR ("lat,lng", optional) so "Hebbal" means the Hebbal in your own city.
 */
async function searchPlaces(query, { near } = {}) {
  const key = env.GOOGLE_MAPS_API_KEY;
  const text = String(query || '').trim();
  if (!key || text.length < 2) return [];

  const body = { textQuery: text, regionCode: 'IN', languageCode: 'en' };
  const center = near && near.latitude != null && near.longitude != null ? near : parseNear(env.PLACE_SEARCH_NEAR);
  if (center) {
    body.locationBias = {
      circle: { center: { latitude: Number(center.latitude), longitude: Number(center.longitude) }, radius: 50000 },
    };
  }

  try {
    const { data } = await axios.post('https://places.googleapis.com/v1/places:searchText', body, {
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location',
      },
      timeout: 8000,
    });

    const seen = new Set();
    const results = [];
    for (const p of data?.places || []) {
      if (!p.location || !(p.displayName?.text || p.formattedAddress)) continue;
      const name = p.displayName?.text || p.formattedAddress;
      const address = p.formattedAddress || p.displayName?.text;
      const id = `${name.toLowerCase()}|${String(address).toLowerCase()}`;
      if (seen.has(id)) continue; // same place twice
      seen.add(id);
      results.push({ name, address, latitude: p.location.latitude, longitude: p.location.longitude });
      if (results.length === LIMIT) break;
    }
    return results;
  } catch (err) {
    logger.warn(
      { status: err.response?.status, err: err.response?.data?.error?.message || err.message },
      '[places] search failed — using the text as typed (is "Places API (New)" enabled for the key?)'
    );
    return [];
  }
}

module.exports = { searchPlaces };
