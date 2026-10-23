const { v4: uuid } = require('uuid');
const { getActiveVehicles } = require('./activeVehicles');
const env = require('../../config/env');
const { getPrisma } = require('../../config/db');
const backendHttp = require('./backendHttp');
const { resolveRouteKm } = require('./distanceService');
const { packageFare } = require('./rentalPackages');
const { roundTripRate } = require('./roundTripRates');

// In-memory quote cache so a fare shown to the customer can be re-verified
// at booking time without recomputing (and without letting the AI restate
// a stale/invented number). In production, back this with Redis.
const quoteCache = new Map();
const QUOTE_TTL_MS = 15 * 60 * 1000;

function cacheQuote(quote) {
  quoteCache.set(quote.fareQuoteId, { quote, expiresAt: Date.now() + QUOTE_TTL_MS });
  return quote;
}

function getCachedQuote(fareQuoteId) {
  const entry = quoteCache.get(fareQuoteId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    quoteCache.delete(fareQuoteId);
    return null;
  }
  return entry.quote;
}

/** Straight-line distance fallback (km) when no maps/routing API is wired up. */
function haversineKm(a, b) {
  if (!a?.latitude || !b?.latitude) return null;
  const R = 6371;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * getFareOptions — equivalent of POST /fares/options on the existing
 * website. Returns one quote per available vehicle. This is the ONLY
 * function allowed to produce a price; the AI must never compute or
 * restate a number that didn't come from here.
 */
async function getFareOptions({ tripType, pickup, drop, pickupAt, returnAt, rentalHours }) {
  if (env.BACKEND_MODE === 'remote') {
    const { data } = await backendHttp.post('/fares/options', {
      tripType,
      pickup,
      drop,
      pickupAt,
      returnAt,
      rentalHours,
    });
    // Verify this response shape against the real backend before go-live.
    return data.options.map(cacheQuote);
  }

  const prisma = getPrisma();
  const allActive = await getActiveVehicles();
  // supportedTripTypes is a Json column, so filter in JS (Prisma's `has` only works on scalar lists).
  const vehicles = allActive.filter(
    (v) => Array.isArray(v.supportedTripTypes) && v.supportedTripTypes.includes(tripType)
  );
  const distanceKm = drop ? await resolveRouteKm(pickup, drop) : null; // Google road distance, see distanceService.js
  const days =
    tripType === 'ROUND_TRIP' && returnAt
      ? Math.max(1, Math.ceil((new Date(returnAt) - new Date(pickupAt)) / 86400000))
      : 1;

  return vehicles.map((v) => {
    // A round trip can carry its own (lower) per-km rate; see roundTripRates.js. Otherwise the normal rate.
    // Rates read from the website tables carry their own round trip and airport rates; otherwise the bot's own settings.
    const perKm =
      tripType === 'ROUND_TRIP'
        ? (Number.isFinite(v.roundTripPerKm) ? v.roundTripPerKm : roundTripRate(v.vehicleId, v.baseFarePerKm))
        : tripType === 'AIRPORT' && Number.isFinite(v.airportPerKm) ? v.airportPerKm : v.baseFarePerKm;
    let baseFare;
    if (tripType === 'HOURLY') {
      const hours = rentalHours || 4;
      // The fixed rental packages (4 / 8 / 12 hours) when this vehicle has them, otherwise the plain hourly rate.
      const pkg = packageFare(v.vehicleId, hours, v.packages);
      baseFare = pkg ? pkg.fare : (v.baseFarePerHour || v.baseFarePerKm * 10) * hours;
    } else if (tripType === 'ROUND_TRIP') {
      // Both legs are driven, and at least ROUND_TRIP_MIN_KM_PER_DAY km are billed for each day away.
      const minPerDay = Number.isFinite(v.minKmPerDay) ? v.minKmPerDay : env.ROUND_TRIP_MIN_KM_PER_DAY;
      const km = Math.max((distanceKm || 0) * 2, minPerDay * days);
      baseFare = perKm * km;
    } else {
      // A minimum billable distance, when the website sets one for this vehicle (0 = none).
      baseFare = perKm * Math.max(distanceKm || 0, v.minimumKm || 0);
    }
    // Airport transfers carry no driver allowance (same as the backend).
    const driverAllowance = tripType === 'AIRPORT' ? 0 : v.driverAllowancePerDay * days;
    const tax = Math.round((baseFare + driverAllowance) * (env.FARE_TAX_PERCENT / 100));
    const total = Math.round(baseFare + driverAllowance + tax);

    return cacheQuote({
      fareQuoteId: `Q-${uuid()}`,
      vehicleId: v.vehicleId,
      vehicleName: v.name,
      category: v.category,
      seatingCapacity: v.seatingCapacity,
      ac: v.ac,
      // The per-km rate, shown next to the vehicle in the list.
      ratePerKm: perKm,
      // One-way road distance, shown to the customer (null for hourly trips).
      distanceKm: distanceKm ? Math.round(distanceKm * 10) / 10 : null,
      fare: {
        baseFare: Math.round(baseFare),
        additionalCharges: 0,
        driverAllowance,
        tax,
        surge: 0,
        total,
        currency: 'INR',
      },
    });
  });
}

/**
 * estimateFare — equivalent of POST /fares/estimate. Re-fetches (or
 * re-validates) the exact quote for one vehicle, used right before
 * booking creation so the price a customer confirms is always fresh
 * and backend-verified, never an AI restatement.
 */
async function estimateFare({ fareQuoteId, tripType, pickup, drop, pickupAt, returnAt, rentalHours, vehicleId }) {
  if (env.BACKEND_MODE === 'remote') {
    const { data } = await backendHttp.post('/fares/estimate', {
      fareQuoteId,
      tripType,
      pickup,
      drop,
      pickupAt,
      returnAt,
      rentalHours,
      vehicleId,
    });
    return data;
  }

  const cached = getCachedQuote(fareQuoteId);
  if (cached && cached.vehicleId === vehicleId) return cached;

  // Quote expired or missing — recompute fresh rather than trusting stale data.
  const options = await getFareOptions({ tripType, pickup, drop, pickupAt, returnAt, rentalHours });
  const match = options.find((o) => o.vehicleId === vehicleId);
  if (!match) throw new Error('FARE_UNAVAILABLE');
  return match;
}

module.exports = { getFareOptions, estimateFare, getCachedQuote };
