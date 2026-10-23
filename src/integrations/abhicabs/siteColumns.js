const env = require('../../config/env');
const { logger } = require('../../config/logger');
const { getPrisma } = require('../../config/db');

/**
 * Fills the bot's own columns on the WEBSITE's tables (bookings.bot_*, customers.bot_*), so the WhatsApp side of a booking
 * lives inside the website's rows and not in a separate copy.
 *
 * It only ever writes columns whose name starts with bot_. Those columns exist only after the website team has run
 * teammate-patch/bot-columns/migration.sql, which is why SITE_COLUMNS is off by default. Every value is passed as a
 * query parameter, never joined into the SQL text. A failure here is logged and never touches the booking itself.
 */
const json = (v) => (v === undefined || v === null ? null : JSON.stringify(v));

/** The bot's own view of a booking, without the bot's bookkeeping about the website (fare.site / fare.siteError). */
function botFare(booking) {
  const { site, siteError, ...rest } = booking.fare || {};
  return rest;
}

async function writeBotColumns({ siteBookingId, siteUserId, booking, customer }) {
  if (env.SITE_COLUMNS !== 'on') return { status: 'off' };
  if (!siteBookingId) return { status: 'no-site-booking' };
  const prisma = getPrisma();
  try {
    const data = {
      channel: booking.channel || 'WHATSAPP',
      customerType: booking.customerType || null,
      companyName: booking.companyName || null,
      gstNumber: booking.gstNumber || null,
      driver: booking.driver || null,
      cancellation: booking.cancellation || null,
      invoiceUrl: booking.invoiceUrl || null,
    };
    await prisma.$executeRaw`UPDATE bookings SET bot_booking_number = ${booking.bookingNumber}, bot_passenger = ${json(booking.passenger)}::jsonb, bot_fare = ${json(botFare(booking))}::jsonb, bot_status = ${booking.status}, bot_data = ${json(data)}::jsonb WHERE id = ${siteBookingId}::uuid`;
    if (siteUserId && customer) {
      const cdata = { name: customer.name || null, customerType: customer.customerType || null, companyName: customer.companyName || null, gstNumber: customer.gstNumber || null };
      await prisma.$executeRaw`UPDATE customers SET bot_language = ${customer.preferredLanguage || 'en'}, bot_last_seen_at = ${customer.lastInteractionAt ? new Date(customer.lastInteractionAt) : new Date()}, bot_data = ${json(cdata)}::jsonb WHERE user_id = ${siteUserId}::uuid`;
    }
    return { status: 'written' };
  } catch (err) {
    logger.error({ err: err.message, booking: booking.bookingNumber }, '[site-columns] could not write the bot columns (has the website database change been applied?)');
    return { status: 'failed', error: err.message };
  }
}

module.exports = { writeBotColumns };
