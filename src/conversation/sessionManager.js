const dayjs = require('dayjs');
const { logger } = require('../config/logger');
const { getPrisma } = require('../config/db');
const { wrapSession } = require('./sessionRecord');
const { wrapCustomer } = require('./customerRecord');
const env = require('../config/env');
const { STATES } = require('./states');

/**
 * Finds or creates the Customer profile for a WhatsApp number, never
 * duplicating records (spec section 32) — phone number is the stable
 * lookup key.
 */
/**
 * Turns a customer row (or none) into the customer for this message. A new customer is created. For a known
 * customer the "last seen" time is refreshed only when it is more than 10 minutes old, and it is NOT waited
 * for: it is not needed to answer, and each database trip costs real time.
 */
async function ensureCustomer(row, whatsappNumber) {
  const prisma = getPrisma();
  if (!row) {
    try {
      return wrapCustomer(await prisma.customer.create({ data: { whatsappNumber } }));
    } catch (err) {
      if (err.code !== 'P2002') throw err; // two messages created the same customer at once: use the existing one
      return wrapCustomer(await prisma.customer.findUnique({ where: { whatsappNumber } }));
    }
  }
  const stale = !row.lastInteractionAt || Date.now() - new Date(row.lastInteractionAt).getTime() > 10 * 60 * 1000;
  if (stale) {
    prisma.customer
      .update({ where: { id: row.id }, data: { lastInteractionAt: new Date() } })
      .catch((err) => logger.warn({ err: err.message }, '[session] could not refresh the last-seen time'));
  }
  return wrapCustomer(row);
}

async function findOrCreateCustomer(whatsappNumber) {
  const prisma = getPrisma();
  return ensureCustomer(await prisma.customer.findUnique({ where: { whatsappNumber } }), whatsappNumber);
}

async function getOrCreateSession(whatsappNumber) {
  const prisma = getPrisma();
  // The customer and the session are looked up TOGETHER: one database trip instead of two.
  const [customerRow, sessionRow] = await Promise.all([
    prisma.customer.findUnique({ where: { whatsappNumber } }),
    prisma.session.findUnique({ where: { whatsappNumber } }),
  ]);
  const customer = await ensureCustomer(customerRow, whatsappNumber);

  let row = sessionRow;

  if (!row) {
    try {
      row = await prisma.session.create({
        data: {
          whatsappNumber,
          customerId: customer.id,
          // No language question: customers start in English on the main menu.
          language: 'en',
          state: STATES.MAIN_MENU,
        },
      });
    } catch (err) {
      if (err.code !== 'P2002') throw err; // created at the same moment by another message
      row = await prisma.session.findUnique({ where: { whatsappNumber } });
    }
    const created = wrapSession(row);
    created._touched = true;
    return { session: created, customer, resumed: false, wasExpired: false };
  }

  const session = wrapSession(row);

  const idleMinutes = dayjs().diff(dayjs(session.lastMessageAt), 'minute');
  const hasInProgressDraft = session.state.startsWith('BOOKING_') && session.draft?.tripType;

  const wasExpired =
    idleMinutes > env.SESSION_TIMEOUT_MINUTES &&
    ![STATES.MAIN_MENU, STATES.LANGUAGE_SELECTION, STATES.SESSION_EXPIRED].includes(session.state);

  if (wasExpired && hasInProgressDraft && session.state !== STATES.SESSION_EXPIRED) {
    session.previousState = session.state;
    session.state = STATES.SESSION_EXPIRED;
    await session.save();
  } else if (wasExpired) {
    session.state = session.language ? STATES.MAIN_MENU : STATES.LANGUAGE_SELECTION;
    session.resetDraft();
    await session.save();
  }

  // This message counts as activity: it is saved together with the first change made while answering.
  session.lastMessageAt = new Date();
  session._touched = true;

  return { session, customer, resumed: false, wasExpired };
}

async function touchSession(session) {
  if (!session._touched) session.lastMessageAt = new Date();
  await session.save(); // writes only if something changed since the last write
}

async function transition(session, nextState) {
  session.previousState = session.state;
  session.state = nextState;
  await session.save();
}

module.exports = { getOrCreateSession, touchSession, transition, findOrCreateCustomer };
