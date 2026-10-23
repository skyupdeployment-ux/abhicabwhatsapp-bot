const { getPrisma } = require('../../config/db');
const env = require('../../config/env');
const { logger } = require('../../config/logger');

/**
 * Reads the vehicles and rates straight from the ABHI CABS website's tables (READ ONLY: only SELECT is ever run):
 *   vehicle_catalog  - which vehicles exist, seats, name
 *   fare_configs     - per-km rate (one way, round trip, airport), hourly rate, driver allowance, minimum km
 *   rental_packages  - the 4 / 8 / 12 hour local packages
 * A price changed in the website admin then shows up in the bot by itself. Nothing is ever written to these tables.
 */

// The bot groups vehicles into six types for its "Choose your cab type" list.
const CATEGORY = {
  'swift-dzire': 'SEDAN', 'swift-dzire-cng': 'SEDAN',
  ertiga: 'SUV', innova: 'SUV',
  'innova-crysta': 'PREMIUM', 'innova-hycross': 'PREMIUM',
  fortuner: 'LUXURY', 'mercedes-e': 'LUXURY',
  'tempo-12': 'TEMPO_TRAVELLER', 'urbania-maharaja': 'TEMPO_TRAVELLER', 'urbania-13': 'TEMPO_TRAVELLER',
  'urbania-16': 'TEMPO_TRAVELLER', 'tempo-17': 'TEMPO_TRAVELLER',
  'benz-22': 'BUS', 'benz-28': 'BUS', 'benz-33': 'BUS',
};
const TRIP_TYPES = ['ONE_WAY', 'ROUND_TRIP', 'AIRPORT', 'HOURLY'];

// Charges the website can apply that the bot's simple formula does not. If any is set, the bot warns in the log.
const NOT_APPLIED = ['base_fare', 'per_minute', 'minimum_fare', 'night_charge_pct', 'night_allowance', 'return_empty_pct', 'waiting_per_hour', 'airport_surcharge'];

// The same rule as the website's fareLookup.service: trim, collapse inner spaces, lower-case. A statewide card has the
// scope key  state:<that>.  A city's own card wins outright; only when the city has none does the state card apply.
const normaliseState = (state) => String(state || '').trim().replace(/\s+/g, ' ').toLowerCase();
const cityScopeKey = (cityId) => `city:${Number(cityId)}`;
const stateScopeKey = (state) => `state:${normaliseState(state)}`;

/** One card per (vehicle, trip type): the city's own card if there is one, otherwise the statewide card. */
function resolveCards(rows, cityScope) {
  const best = new Map();
  for (const r of rows) {
    const k = `${r.vehicle_class}|${r.trip_type}`;
    const have = best.get(k);
    if (!have || (r.scope_key === cityScope && have.scope_key !== cityScope)) best.set(k, r);
  }
  return [...best.values()];
}

function categoryFor(key, seats) {
  if (CATEGORY[key]) return CATEGORY[key];
  if (seats <= 4) return 'SEDAN';
  if (seats <= 8) return 'SUV';
  if (seats <= 17) return 'TEMPO_TRAVELLER';
  return 'BUS';
}

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

/** Pure function: rows from the three tables in, the bot's vehicle list out (and any warnings). */
function mapSiteRates(vehicleRows, cardRows, packageRows) {
  const warnings = [];
  const vehicles = [];
  for (const c of vehicleRows) {
    const cards = cardRows.filter((x) => x.vehicle_class === c.key);
    const card = (t) => cards.find((x) => x.trip_type === t);
    const oneWay = card('ONE_WAY');
    if (!oneWay || !(num(oneWay.per_km) >= 0)) {
      warnings.push(`${c.key}: no active ONE_WAY rate, so it is not offered`);
      continue;
    }
    const roundTrip = card('ROUND_TRIP');
    const airport = card('AIRPORT');
    const hourly = card('HOURLY');
    const perKm = num(oneWay.per_km);

    const ignored = NOT_APPLIED.filter((f) => cards.some((x) => num(x[f]) > 0));
    if (ignored.length) warnings.push(`${c.key}: the website sets ${ignored.join(', ')}, which the bot does not add`);

    vehicles.push({
      vehicleId: c.key,
      name: c.name,
      category: c.bot_category || categoryFor(c.key, c.seats),
      seatingCapacity: Number(c.seats),
      ac: true,
      active: true,
      source: 'website',
      baseFarePerKm: perKm,
      baseFarePerHour: hourly ? num(hourly.hourly_rate) || 0 : 0,
      driverAllowancePerDay: num(oneWay.driver_allowance) || 0,
      supportedTripTypes: TRIP_TYPES.filter((t) => card(t)),
      // Rates that differ by trip type (null = same as the one-way rate)
      roundTripPerKm: roundTrip && num(roundTrip.per_km) !== perKm ? num(roundTrip.per_km) : null,
      airportPerKm: airport && num(airport.per_km) !== perKm ? num(airport.per_km) : null,
      minKmPerDay: roundTrip ? Number(roundTrip.min_km_per_day) || 0 : null,
      minimumKm: num(oneWay.minimum_km) || 0,
      packages: packageRows
        .filter((p) => p.vehicle_class === c.key)
        .sort((a, b) => a.hours - b.hours)
        .map((p) => ({ hours: Number(p.hours), km: Number(p.km), fare: num(p.fare), extraPerHour: num(p.extra_hour), extraPerKm: num(p.extra_km) })),
    });
  }
  return { vehicles, warnings };
}

let lastWarning = '';

/** Reads the three tables (3 SELECTs at the same time) and returns the bot's vehicle list. */
async function loadSiteVehicles() {
  const prisma = getPrisma();
  const cityId = Number(env.SITE_CITY_ID) || 1;
  const cityScope = cityScopeKey(cityId);

  // The city's state, so a statewide card can price a vehicle the city has no card for.
  const cityRows = await prisma.$queryRaw`SELECT state FROM cities WHERE id = ${cityId} AND is_active = true LIMIT 1`;
  const state = cityRows && cityRows[0] && cityRows[0].state;
  const scopes = state && normaliseState(state) ? [cityScope, stateScopeKey(state)] : [cityScope];

  const [vehicleRows, cardRows, packageRows] = await Promise.all([
    // to_jsonb(v)->>'bot_category' reads the new column when it exists and gives NULL (no error) when it does not.
    prisma.$queryRaw`SELECT key, name, seats::int AS seats, fuel, to_jsonb(v)->>'bot_category' AS bot_category FROM vehicle_catalog v WHERE is_active = true ORDER BY sort_order, id`,
    prisma.$queryRaw`SELECT DISTINCT ON (scope_key, vehicle_class, trip_type) scope_key, vehicle_class, trip_type::text AS trip_type, per_km::float8 AS per_km, hourly_rate::float8 AS hourly_rate, driver_allowance::float8 AS driver_allowance, min_km_per_day::int AS min_km_per_day, minimum_km::float8 AS minimum_km, base_fare::float8 AS base_fare, per_minute::float8 AS per_minute, minimum_fare::float8 AS minimum_fare, night_charge_pct::float8 AS night_charge_pct, night_allowance::float8 AS night_allowance, return_empty_pct::float8 AS return_empty_pct, waiting_per_hour::float8 AS waiting_per_hour, airport_surcharge::float8 AS airport_surcharge FROM fare_configs WHERE is_active = true AND scope_key = ANY(${scopes}::text[]) AND effective_from <= now() ORDER BY scope_key, vehicle_class, trip_type, effective_from DESC`,
    prisma.$queryRaw`SELECT vehicle_class, included_hours::int AS hours, included_km::int AS km, package_fare::float8 AS fare, extra_per_hour::float8 AS extra_hour, extra_per_km::float8 AS extra_km FROM rental_packages WHERE is_active = true AND city_id = ${cityId} ORDER BY vehicle_class, included_hours`,
  ]);
  const { vehicles, warnings } = mapSiteRates(vehicleRows, resolveCards(cardRows, cityScope), packageRows);
  const signature = warnings.join('|');
  if (signature && signature !== lastWarning) logger.warn({ warnings }, '[site-rates] please check the website rates against the bot');
  lastWarning = signature;
  return vehicles;
}

module.exports = { loadSiteVehicles, mapSiteRates, categoryFor, resolveCards, normaliseState, stateScopeKey, CATEGORY };
