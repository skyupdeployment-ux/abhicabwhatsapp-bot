const dayjs = require('dayjs');
const env = require('../../config/env');
const { logger } = require('../../config/logger');
const { getPrisma } = require('../../config/db');
const { writeBotColumns } = require('./siteColumns');

/**
 * Reads the WEBSITE's bookings (SELECT only: bookings, allocations, users, vehicles) for the bookings the bot sent there,
 * and brings the bot's record up to date, so My Booking, tracking and the reminders follow what the website team does:
 * cancel a booking, assign a driver and car, finish the trip.
 *
 * SITE_SYNC=on to switch it on. It never writes to the website's tables.
 */

// The website's status, as the bot's own status. null = leave the bot's status as it is.
const STATUS_MAP = {
  PENDING: null,
  CONFIRMED: null,
  ALLOCATED: 'DRIVER_ASSIGNED',
  EN_ROUTE: 'DRIVER_ASSIGNED',
  REACHED: 'DRIVER_ASSIGNED',
  ARRIVED: 'DRIVER_ASSIGNED',
  ONGOING: 'ONGOING',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
};
const OPEN = ['CONFIRMED', 'DRIVER_ASSIGNED', 'ONGOING'];

/** One SELECT for all the bookings: status, times, cancellation, and the driver and car on the active allocation. */
async function readSiteBookings(ids) {
  const prisma = getPrisma();
  return prisma.$queryRaw`SELECT b.id::text AS id, b.status::text AS status, b.pickup_at AS pickup_at, b.cancelled_at AS cancelled_at, b.cancellation_reason AS cancellation_reason, b.cancellation_fee::float8 AS cancellation_fee, u.name AS driver_name, u.phone AS driver_phone, v.registration_number AS vehicle_number, v.make_model AS vehicle_model FROM bookings b LEFT JOIN LATERAL (SELECT a.driver_id, a.vehicle_id FROM allocations a WHERE a.booking_id = b.id AND a.status = 'ACTIVE' ORDER BY a.created_at DESC LIMIT 1) al ON true LEFT JOIN users u ON u.id = al.driver_id LEFT JOIN vehicles v ON v.id = al.vehicle_id WHERE b.id = ANY(${ids}::uuid[])`;
}

/** Pure: what to change on the bot's booking, given the website's row. Returns null when nothing changed. */
function diffBooking(bot, site) {
  const patch = {};
  const mapped = Object.prototype.hasOwnProperty.call(STATUS_MAP, site.status) ? STATUS_MAP[site.status] : null;
  if (mapped && mapped !== bot.status) patch.status = mapped;

  const hasDriver = !!(site.driver_name || site.vehicle_number);
  const driver = hasDriver
    ? { name: site.driver_name || null, phone: site.driver_phone || null, vehicleNumber: site.vehicle_number || null, vehicleModel: site.vehicle_model || null }
    : null;
  const before = bot.driver || null;
  if (driver && JSON.stringify(driver) !== JSON.stringify(before)) patch.driver = driver;

  if (site.pickup_at && bot.pickupAt && Math.abs(new Date(site.pickup_at) - new Date(bot.pickupAt)) > 60000) patch.pickupAt = new Date(site.pickup_at);

  if (site.status === 'CANCELLED' && (!bot.cancellation || bot.cancellation.source !== 'website')) {
    patch.cancellation = {
      cancelledAt: site.cancelled_at ? new Date(site.cancelled_at).toISOString() : new Date().toISOString(),
      reason: site.cancellation_reason || null,
      fee: site.cancellation_fee === null || site.cancellation_fee === undefined ? null : Number(site.cancellation_fee),
      source: 'website',
    };
  }
  return Object.keys(patch).length ? patch : null;
}

async function syncSiteStatuses(now = new Date()) {
  if (env.SITE_SYNC !== 'on') return { checked: 0, updated: 0 };
  const prisma = getPrisma();
  const since = new Date(now.getTime() - 45 * 86400000);
  const rows = await prisma.booking.findMany({ where: { status: { in: OPEN }, createdAt: { gte: since } }, take: 300 });
  const mirrored = rows.filter((b) => b.fare && b.fare.site && b.fare.site.id);
  if (!mirrored.length) return { checked: 0, updated: 0 };

  let siteRows;
  try {
    siteRows = await readSiteBookings(mirrored.map((b) => b.fare.site.id));
  } catch (err) {
    logger.error({ err: err.message }, '[site-sync] could not read the website bookings');
    return { checked: mirrored.length, updated: 0, failed: true };
  }
  const byId = new Map(siteRows.map((r) => [r.id, r]));

  let updated = 0;
  for (const b of mirrored) {
    const s = byId.get(b.fare.site.id);
    if (!s) continue;
    const patch = diffBooking(b, s);
    if (!patch) continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      const fresh = await prisma.booking.update({ where: { id: b.id }, data: patch });
      updated += 1;
      logger.info({ booking: b.bookingNumber, from: b.status, to: patch.status || b.status, driver: !!patch.driver }, '[site-sync] booking updated from the website');
      if (env.SITE_COLUMNS === 'on') {
        // eslint-disable-next-line no-await-in-loop
        await writeBotColumns({ siteBookingId: b.fare.site.id, siteUserId: b.fare.site.userId, booking: { ...b, ...fresh }, customer: null });
      }
    } catch (err) {
      logger.error({ err: err.message, booking: b.bookingNumber }, '[site-sync] could not update the bot booking');
    }
  }
  return { checked: mirrored.length, updated };
}

module.exports = { syncSiteStatuses, diffBooking, readSiteBookings, STATUS_MAP };
