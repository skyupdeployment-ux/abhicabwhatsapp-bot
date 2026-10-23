const dayjs = require('dayjs');
const env = require('../../config/env');
const { logger } = require('../../config/logger');
const { getPrisma } = require('../../config/db');
const dateParser = require('../../conversation/nlu/dateParser'); // loads the dayjs time zone plugins
const siteApi = require('./siteApi');
const { writeBotColumns } = require('./siteColumns');

/**
 * Sends a CONFIRMED WhatsApp booking to the ABHI CABS website, through its own API, so it appears in the website's
 * admin and dispatch like any other booking. The website prices and numbers it with its own rules.
 *
 * SITE_BOOKINGS = off (default) | dry-run (only logs what would be sent) | on
 *
 * It never gets in the customer's way: it runs after the confirmation message, and a failure is only recorded
 * (booking.fare.siteError) and retried by a background job.
 */
const MODE_MAP = { PAY_LATER: 'ZERO', PARTIAL: 'PARTIAL', FULL: 'FULL' };
const MAX_ATTEMPTS = 8;

class SiteBookingError extends Error {} // a booking that can never be sent as it is (do not retry)

function loc(p) {
  if (!p) return null;
  const lat = Number(p.latitude);
  const lng = Number(p.longitude);
  const out = {};
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    out.lat = lat;
    out.lng = lng;
  }
  const address = p.address ? String(p.address).trim() : '';
  if (address.length >= 3) out.address = address.slice(0, 500);
  return out.lat !== undefined || out.address ? out : null;
}

const istDate = (d) => dayjs(d).tz(dateParser.TZ).format('YYYY-MM-DD');
const rupees = (n) => `Rs ${Number(n || 0).toLocaleString('en-IN')}`;

/** Pure: a bot booking (and its customer) in, the website's create-booking request out. */
function buildSiteBooking(booking, customer) {
  const tripType = booking.tripType;
  const vehicleClass = booking.vehicle && booking.vehicle.vehicleId;
  if (!vehicleClass) throw new SiteBookingError('the booking has no vehicle');
  const pickup = loc(booking.pickup);
  if (!pickup) throw new SiteBookingError('the booking has no usable pickup');
  const hourly = tripType === 'HOURLY';
  const drop = hourly ? null : loc(booking.drop);
  if (!hourly && !drop) throw new SiteBookingError('the booking has no usable drop');
  const stops = hourly ? [] : ((booking.drop && booking.drop.stops) || []).map(loc).filter(Boolean);

  const fare = booking.fare || {};
  const passenger = booking.passenger || {};
  const notes = [
    `WhatsApp booking ${booking.bookingNumber}.`,
    passenger.name ? `Passenger: ${passenger.name}${passenger.count ? `, ${passenger.count} passengers` : ''}.` : '',
    // Payment on WhatsApp goes through the bot's own Razorpay, so the website cannot see it yet: say it in the note.
    fare.amountPaid > 0 ? `Paid ${rupees(fare.amountPaid)} of ${rupees(fare.total)} on WhatsApp (Razorpay); balance ${rupees(fare.amountDue)}.` : `Total ${rupees(fare.total)}; pay later.`,
    booking.specialRequests ? String(booking.specialRequests) : '',
  ].filter(Boolean).join(' ');

  const payload = {
    cityId: Number(env.SITE_CITY_ID) || 1,
    vehicleClass,
    tripType,
    pickup,
    ...(drop ? { drop } : {}),
    ...(stops.length ? { stops } : {}),
    pickupAt: new Date(booking.pickupAt).toISOString(),
    scheduled: true,
    paymentMode: MODE_MAP[fare.paymentMode] || 'ZERO',
    specialRequests: notes.slice(0, 1000),
  };
  if (tripType === 'ROUND_TRIP') {
    if (!booking.returnAt) throw new SiteBookingError('a round trip has no return date');
    payload.returnAt = new Date(booking.returnAt).toISOString();
  }
  if (hourly) {
    const hours = Math.round(Number(booking.rentalHours));
    if (!(hours >= 1 && hours <= 24)) throw new SiteBookingError('a local trip needs 1 to 24 hours');
    payload.rentalHours = hours;
  }
  // The website wants a drop date when a one-way has stops. The bot does not ask for one, so the pickup day is used.
  if (stops.length && tripType !== 'ROUND_TRIP' && !hourly) payload.dropAt = istDate(booking.pickupAt);
  return payload;
}

async function recordResult(prisma, bookingId, patch) {
  // Read again right before writing: a payment may have updated the fare JSON in the meantime.
  const fresh = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!fresh) return;
  await prisma.booking.update({ where: { id: bookingId }, data: { fare: { ...fresh.fare, ...patch } } });
}

/** Sends one booking. Returns { status, ... } and never throws. */
async function mirrorBooking(bookingId) {
  const mode = env.SITE_BOOKINGS;
  if (mode !== 'on' && mode !== 'dry-run') return { status: 'off' };
  const prisma = getPrisma();
  try {
    const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) return { status: 'missing' };
    if (booking.status !== 'CONFIRMED') return { status: 'not-confirmed' };
    if (booking.fare && booking.fare.site) {
      // Already on the website: only keep the bot columns up to date (status, amounts paid), if they are switched on.
      if (env.SITE_COLUMNS === 'on') {
        const cust = await prisma.customer.findUnique({ where: { id: booking.customerId } });
        await writeBotColumns({ siteBookingId: booking.fare.site.id, siteUserId: booking.fare.site.userId, booking, customer: cust });
      }
      return { status: 'already-sent' };
    }
    if (booking.fare && booking.fare.siteError && booking.fare.siteError.permanent) return { status: 'gave-up' };
    const customer = await prisma.customer.findUnique({ where: { id: booking.customerId } });
    if (!customer || !customer.whatsappNumber) throw new SiteBookingError('the customer has no WhatsApp number');

    const payload = buildSiteBooking(booking, customer);
    if (mode === 'dry-run') {
      // The headers are shown too, because the website reads x-client-source into the booking's meta.source.
      const headers = { 'x-client-source': 'whatsapp-bot', 'Idempotency-Key': `bot-${booking.bookingNumber}`, 'x-service-key': '[hidden]', Authorization: 'Bearer [hidden]' };
      logger.info({ booking: booking.bookingNumber, headers, payload }, '[site-booking] DRY RUN: this would be sent to the website (nothing was sent)');
      return { status: 'dry-run', payload, headers };
    }

    const created = await siteApi.createBooking(customer.whatsappNumber, booking.passenger && booking.passenger.name, payload, `bot-${booking.bookingNumber}`);
    const siteTotal = Number(created.estimatedFare);
    const botTotal = Number(booking.fare && booking.fare.total);
    await recordResult(prisma, bookingId, {
      site: { id: created.id || null, userId: created.customerId || null, bookingNumber: created.bookingNumber || null, total: Number.isFinite(siteTotal) ? siteTotal : null, at: new Date().toISOString() },
      siteError: undefined,
    });
    // The bot's own columns on the website's rows (only when SITE_COLUMNS=on). A problem here never fails the booking.
    await writeBotColumns({ siteBookingId: created.id, siteUserId: created.customerId, booking, customer });
    if (Number.isFinite(siteTotal) && Number.isFinite(botTotal) && Math.abs(siteTotal - botTotal) > 1) {
      logger.warn({ booking: booking.bookingNumber, site: created.bookingNumber, botTotal, siteTotal }, '[site-booking] the website priced this trip differently from the bot');
    }
    logger.info({ booking: booking.bookingNumber, site: created.bookingNumber }, '[site-booking] sent to the website');
    return { status: 'sent', siteBookingNumber: created.bookingNumber };
  } catch (err) {
    const permanent = err instanceof SiteBookingError;
    const info = err instanceof SiteBookingError ? { status: null, code: 'BOT_VALIDATION', message: err.message } : siteApi.errorInfo(err);
    // 4xx answers other than "too many requests" mean the website refused the booking as it is: retrying would not help.
    const refused = info.status && info.status >= 400 && info.status < 500 && ![401, 408, 409, 429].includes(info.status);
    try {
      const fresh = await prisma.booking.findUnique({ where: { id: bookingId } });
      const attempts = ((fresh && fresh.fare && fresh.fare.siteError && fresh.fare.siteError.attempts) || 0) + 1;
      await recordResult(prisma, bookingId, {
        siteError: { ...info, attempts, permanent: permanent || refused || attempts >= MAX_ATTEMPTS, at: new Date().toISOString() },
      });
    } catch (writeErr) {
      logger.error({ err: writeErr.message }, '[site-booking] could not record the failure');
    }
    logger.error({ bookingId, ...info }, '[site-booking] could not send the booking to the website');
    return { status: 'failed', ...info };
  }
}

/** Called right after a booking is confirmed. Runs in the background so the customer is never kept waiting. */
function scheduleMirror(bookingId) {
  if (env.SITE_BOOKINGS !== 'on' && env.SITE_BOOKINGS !== 'dry-run') return;
  setImmediate(() => {
    mirrorBooking(bookingId).catch((err) => logger.error({ err: err.message }, '[site-booking] unexpected error'));
  });
}

/** Background job: tries again for confirmed bookings of the last 7 days that have not reached the website. */
async function retryPendingSiteBookings(now = new Date()) {
  if (env.SITE_BOOKINGS !== 'on') return 0;
  const prisma = getPrisma();
  const since = new Date(now.getTime() - 7 * 86400000);
  const rows = await prisma.booking.findMany({ where: { status: 'CONFIRMED', createdAt: { gte: since } }, take: 100 });
  let sent = 0;
  for (const b of rows) {
    const f = b.fare || {};
    if (f.site || (f.siteError && f.siteError.permanent)) continue;
    // eslint-disable-next-line no-await-in-loop
    const r = await mirrorBooking(b.id);
    if (r.status === 'sent') sent += 1;
  }
  return sent;
}

module.exports = { buildSiteBooking, mirrorBooking, scheduleMirror, retryPendingSiteBookings, SiteBookingError };
