const axios = require('axios');
const env = require('../../config/env');
const { logger } = require('../../config/logger');

/**
 * Finds places by name with Google Places "Text Search (New)", so a customer can type
 * "Hebbal" or "Kempegowda Airport" and pick the right match.
 * Returns up to 5 of { name, address, latitude, longitude } — or [] when no key is set,
 * the Places API (New) is not enabled for the key, or nothing matches (the caller then
 * falls back to the text exactly as typed). Never logs the API key.
 */
async function searchPlaces(query, { near } = {}) {
  const key = env.GOOGLE_MAPS_API_KEY;
  const text = String(query || '').trim();
  if (!key || text.length < 2) return [];

  const body = { textQuery: text, regionCode: 'IN', languageCode: 'en' };
  if (near && near.latitude != null && near.longitude != null) {
    body.locationBias = {
      circle: { center: { latitude: Number(near.latitude), longitude: Number(near.longitude) }, radius: 50000 },
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
    return (data?.places || [])
      .filter((p) => p.location && (p.displayName?.text || p.formattedAddress))
      .slice(0, 5)
      .map((p) => ({
        name: p.displayName?.text || p.formattedAddress,
        address: p.formattedAddress || p.displayName?.text,
        latitude: p.location.latitude,
        longitude: p.location.longitude,
      }));
  } catch (err) {
    logger.warn(
      { status: err.response?.status, err: err.response?.data?.error?.message || err.message },
      '[places] search failed — using the text as typed (is "Places API (New)" enabled for the key?)'
    );
    return [];
  }
}

module.exports = { searchPlaces };
