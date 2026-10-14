const { getPrisma } = require('../../config/db');

/**
 * The list of active vehicles, kept for 60 seconds. It changes only when you edit the rates, and every fare
 * step used to read it from the database again: one more trip of waiting. After a rate change it shows up
 * within a minute (or at once after a redeploy).
 */
const TTL_MS = 60 * 1000;
let cache = { at: 0, rows: null };

async function getActiveVehicles() {
  if (cache.rows && Date.now() - cache.at < TTL_MS) return cache.rows;
  const rows = await getPrisma().vehicle.findMany({ where: { active: true } });
  cache = { at: Date.now(), rows };
  return rows;
}

function clearActiveVehiclesCache() {
  cache = { at: 0, rows: null };
}

module.exports = { getActiveVehicles, clearActiveVehiclesCache };
