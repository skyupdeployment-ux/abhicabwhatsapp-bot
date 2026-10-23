const { getPrisma } = require('../../config/db');
const env = require('../../config/env');
const { logger } = require('../../config/logger');

/**
 * The list of active vehicles with their rates, kept for 60 seconds so a fare step does not wait for the database.
 *
 * RATES_SOURCE=bot (default)   the bot's own vehicles (the bot_vehicles table).
 * RATES_SOURCE=website         the ABHI CABS website's tables (vehicle_catalog, fare_configs, rental_packages), read only.
 *                              If they cannot be read, the bot's own vehicles are used instead and the error is logged,
 *                              so a problem on the website side never stops the bot taking bookings.
 */
const TTL_MS = 60 * 1000;
const RETRY_MS = 15 * 1000; // after a fallback, try the website again sooner
let cache = { at: 0, rows: null, ttl: TTL_MS };
let lastSource = '';

async function getActiveVehicles() {
  if (cache.rows && Date.now() - cache.at < cache.ttl) return cache.rows;

  let rows = null;
  let ttl = TTL_MS;
  if (env.RATES_SOURCE === 'website') {
    try {
      const { loadSiteVehicles } = require('./siteRates');
      rows = await loadSiteVehicles();
      if (!rows.length) throw new Error('no active vehicles with a one-way rate were found in the website tables');
      // One line in the log when the bot starts using the website tables (and again if the number of vehicles changes).
      if (lastSource !== `website:${rows.length}`) logger.info({ vehicles: rows.length }, '[site-rates] rates are now read from the website tables');
      lastSource = `website:${rows.length}`;
    } catch (err) {
      logger.error({ err: err.message }, '[site-rates] could not read the website tables; using the bot vehicles for now');
      rows = null;
      ttl = RETRY_MS;
      lastSource = 'bot';
    }
  }
  if (!rows) rows = await getPrisma().vehicle.findMany({ where: { active: true } });

  cache = { at: Date.now(), rows, ttl };
  return rows;
}

function clearActiveVehiclesCache() {
  cache = { at: 0, rows: null, ttl: TTL_MS };
}

module.exports = { getActiveVehicles, clearActiveVehiclesCache };
