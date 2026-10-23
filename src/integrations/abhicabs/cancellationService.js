const env = require('../../config/env');
const { getPrisma } = require('../../config/db');
const backendHttp = require('./backendHttp');
const { calculateCancellationFee } = require('../../utils/cancellationPolicy');
const siteApi = require('./siteApi');
const { mirroredBooking, siteNumber } = require('./siteCancel');

function withId(row) {
  return row ? { ...row, _id: row.id } : row;
}

const NON_CANCELLABLE_STATUSES = ['CANCELLED', 'COMPLETED', 'ONGOING', 'EXPIRED'];

/** getAvailableActions — equivalent of GET /bookings/:id/actions. */
async function getAvailableActions(bookingId) {
  if (env.BACKEND_MODE === 'remote') {
    const { data } = await backendHttp.get(`/bookings/${bookingId}/actions`);
    return data.actions;
  }
  const prisma = getPrisma();
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) return [];
  const actions = ['VIEW_DETAILS', 'INVOICE'];
  if (!NON_CANCELLABLE_STATUSES.includes(booking.status)) actions.push('CANCEL');
  if (['CONFIRMED', 'DRIVER_ASSIGNED', 'ONGOING'].includes(booking.status)) actions.push('TRACK');
  return actions;
}

/**
 * getCancellationQuote — equivalent of GET /bookings/:id/cancellation-quote.
 * Fee policy here is a placeholder tiered example; replace with the
 * real ABHI CABS policy once verified against the actual backend/source.
 */
async function getCancellationQuote(bookingId) {
  // A booking that is on the website is cancelled by the WEBSITE's policy: its fee and refund, never a guess.
  const site = await mirroredBooking(bookingId);
  if (site) {
    let q;
    try {
      q = await siteApi.cancellationQuote(site.phone, site.name, site.site.id);
    } catch (err) {
      const info = siteApi.errorInfo(err);
      // 409 / 422: the website says this booking can no longer be cancelled in its current state.
      if (info.status === 409 || info.status === 422) throw new Error('BOOKING_NOT_CANCELLABLE');
      throw err;
    }
    const fee = siteNumber(q && q.fee);
    const refundAmount = siteNumber(q && (typeof q.refund === 'object' && q.refund ? (q.refund.amount ?? q.refund.refundAmount) : q.refund));
    if (fee === null || refundAmount === null) throw new Error('SITE_QUOTE_INVALID'); // do not show numbers we cannot read
    return { bookingId, fee, refundAmount, feePercent: null, band: (q && q.band) || null, currency: 'INR', source: 'website' };
  }
  if (env.BACKEND_MODE === 'remote') {
    const { data } = await backendHttp.get(`/bookings/${bookingId}/cancellation-quote`);
    return data;
  }

  const prisma = getPrisma();
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) throw new Error('BOOKING_NOT_FOUND');
  if (NON_CANCELLABLE_STATUSES.includes(booking.status)) {
    throw new Error('BOOKING_NOT_CANCELLABLE');
  }

  const hoursToPickup = (new Date(booking.pickupAt) - Date.now()) / (1000 * 60 * 60);
  const { fee, refundAmount, feePercent } = calculateCancellationFee({
    hoursToPickup,
    total: booking.fare.total,
  });

  return { bookingId, fee, refundAmount, feePercent, currency: 'INR' };
}

/** cancelBooking — equivalent of POST /bookings/:id/cancel. Requires explicit confirmation upstream. */
async function cancelBooking(bookingId, { reason, confirmedFee, confirmedRefund }) {
  // On the website first: that is where dispatch, the fee and the refund are decided. Only then the bot's own record.
  const site = await mirroredBooking(bookingId);
  if (site) {
    let result;
    try {
      result = await siteApi.cancelBooking(site.phone, site.name, site.site.id, reason, `bot-cancel-${site.booking.bookingNumber}`);
    } catch (err) {
      const info = siteApi.errorInfo(err);
      if (info.status === 409 || info.status === 422 || info.code === 'INVALID_STATUS_TRANSITION') throw new Error('BOOKING_NOT_CANCELLABLE');
      throw err;
    }
    const sb = (result && result.booking) || {};
    const fee = siteNumber(sb.cancellationFee) ?? confirmedFee;
    const refundAmount = siteNumber(result && (typeof result.refund === 'object' && result.refund ? (result.refund.amount ?? result.refund.refundAmount) : result.refund)) ?? confirmedRefund;
    const prisma = getPrisma();
    const updated = await prisma.booking.update({
      where: { id: bookingId },
      data: {
        status: 'CANCELLED',
        cancellation: { cancelledAt: new Date().toISOString(), reason, fee, refundAmount, source: 'website' },
      },
    });
    return withId(updated);
  }
  if (env.BACKEND_MODE === 'remote') {
    const { data } = await backendHttp.post(`/bookings/${bookingId}/cancel`, { reason });
    return data;
  }

  const prisma = getPrisma();
  const booking = await prisma.booking.update({
    where: { id: bookingId },
    data: {
      status: 'CANCELLED',
      cancellation: {
        cancelledAt: new Date().toISOString(),
        reason,
        fee: confirmedFee,
        refundAmount: confirmedRefund,
      },
    },
  });
  return withId(booking);
}

module.exports = { getAvailableActions, getCancellationQuote, cancelBooking };
