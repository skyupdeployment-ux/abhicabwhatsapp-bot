const env = require('../../config/env');
const { getPrisma } = require('../../config/db');

/**
 * Helpers for cancelling on the website. A booking is "mirrored" when it was sent to the website (booking.fare.site.id).
 * Only a mirrored booking is ever cancelled through the website, and only when SITE_CANCEL=on and the API address and
 * key are set. Everything else keeps working the bot's own way.
 */
const enabled = () => env.SITE_CANCEL === 'on' && !!env.SITE_API_URL && !!env.SITE_SERVICE_KEY;

/** { booking, site, phone, name } for a booking that is on the website, or null. */
async function mirroredBooking(bookingId) {
  if (!enabled()) return null;
  const prisma = getPrisma();
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  const site = booking && booking.fare && booking.fare.site;
  if (!site || !site.id) return null;
  const customer = await prisma.customer.findUnique({ where: { id: booking.customerId } });
  if (!customer || !customer.whatsappNumber) return null;
  return { booking, site, phone: customer.whatsappNumber, name: booking.passenger && booking.passenger.name };
}

/** A money value from the website (number or numeric text) as a number, or null when it is not one. */
function siteNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

module.exports = { mirroredBooking, siteNumber, enabled };
