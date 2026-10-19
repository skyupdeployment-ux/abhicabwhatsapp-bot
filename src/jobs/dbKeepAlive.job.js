const { logger } = require('../config/logger');
const { getPrisma } = require('../config/db');

/**
 * Keeps the database connections open. A connection that sits idle can be closed on the way (the database
 * is reached through a public proxy), and the next message then pays for opening a new one: several trips
 * back and forth before the first query. A tiny query every 20 seconds, on 4 connections at once (and once right at start-up),
 * keeps them ready.
 */
async function keepDatabaseWarm() {
  try {
    const prisma = getPrisma();
    await Promise.all([0, 1, 2, 3].map(() => prisma.$queryRaw`SELECT 1`));
  } catch (err) {
    logger.warn({ err: err.message }, '[db] keep-alive ping failed');
  }
}

module.exports = { keepDatabaseWarm };
