const crypto = require('crypto');
const dayjs = require('dayjs');
const env = require('../config/env');
const { getPrisma } = require('../config/db');
const { logger } = require('../config/logger');
const dateParser = require('../conversation/nlu/dateParser'); // loads the dayjs time zone plugins

/**
 * A simple, read-only bookings page for the owner: GET /admin-bookings
 * Sign in with ANY user name and the ADMIN_API_KEY as the password (the browser asks for it).
 * Shows the latest bookings with status, trip, pickup, stops, drop, vehicle, fare, payment, passenger, phone and driver.
 * Optional filter: /admin-bookings?status=CONFIRMED
 */
const STATUSES = ['CREATED', 'PAYMENT_PENDING', 'CONFIRMED', 'ONGOING', 'COMPLETED', 'CANCELLED', 'EXPIRED'];
const MAX_ROWS = 100;

const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function authorized(req) {
  const header = String(req.headers.authorization || '');
  if (!header.startsWith('Basic ')) return false;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const password = decoded.slice(decoded.indexOf(':') + 1);
  const a = Buffer.from(password);
  const b = Buffer.from(env.ADMIN_API_KEY);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function money(v) {
  const n = Number(v);
  return Number.isFinite(n) ? `₹${n.toLocaleString('en-IN')}` : '';
}

function row(b, customer, payment) {
  const when = b.pickupAt ? dayjs(b.pickupAt).tz(dateParser.TZ).format('ddd D MMM YYYY, h:mm A') : '';
  const stops = ((b.drop && b.drop.stops) || []).map((s) => s.address).filter(Boolean);
  const fare = b.fare || {};
  const driver = b.driver && b.driver.name ? `${b.driver.name}${b.driver.phone ? ` (${b.driver.phone})` : ''}` : '';
  const phone = customer && customer.whatsappNumber ? customer.whatsappNumber : '';
  // The website's own booking number once the booking has reached it, or why it has not.
  const site = fare.site && fare.site.bookingNumber ? fare.site.bookingNumber : fare.siteError ? `error: ${fare.siteError.message}` : '';
  return `<tr>
<td><b>${esc(b.bookingNumber)}</b></td>
<td><span class="st st-${esc(b.status)}">${esc(b.status)}</span></td>
<td>${esc(when)}</td>
<td>${esc(b.tripType)}</td>
<td>${esc(b.pickup && b.pickup.address)}</td>
<td>${stops.map((s) => esc(s)).join('<br>')}</td>
<td>${esc(b.drop && b.drop.address)}</td>
<td>${esc(b.vehicle && b.vehicle.name)}</td>
<td>${esc(money(fare.total))}</td>
<td>${esc(money(fare.amountPaid))}</td>
<td>${esc(money(fare.amountDue))}</td>
<td>${esc(payment && payment.status)}</td>
<td>${esc(b.passenger && b.passenger.name)}${b.passenger && b.passenger.count ? ` (${esc(b.passenger.count)})` : ''}</td>
<td>${phone ? `<a href="tel:+${esc(phone)}">+${esc(phone)}</a>` : ''}</td>
<td>${esc(driver)}</td>
<td>${esc(site)}</td>
<td>${esc(dayjs(b.createdAt).tz(dateParser.TZ).format('D MMM, h:mm A'))}</td>
</tr>`;
}

function page(rows, counts, filter) {
  const chips = ['ALL', ...STATUSES].map((s) => {
    const n = s === 'ALL' ? rows.length : counts[s] || 0;
    const active = (filter || 'ALL') === s;
    return `<a class="chip${active ? ' on' : ''}" href="/admin-bookings${s === 'ALL' ? '' : `?status=${s}`}">${esc(s)} <b>${s === 'ALL' && filter ? '' : n}</b></a>`;
  }).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Bookings | ABHI CABS</title>
<style>
:root{--bg:#f3f6f4;--card:#fff;--text:#16241d;--muted:#5b6b63;--line:#d9e2dc;--accent:#0f5d4a}
@media (prefers-color-scheme: dark){:root{--bg:#101815;--card:#18221e;--text:#e8f0ec;--muted:#9bb0a5;--line:#2b3a33;--accent:#3fbf9b}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:system-ui,-apple-system,"Segoe UI",sans-serif;padding:14px}
h1{font-size:20px;margin:0 0 4px}.sub{color:var(--muted);font-size:14px;margin:0 0 12px}
.chips{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}.chip{border:1px solid var(--line);background:var(--card);color:var(--text);border-radius:18px;padding:6px 12px;font-size:13px;text-decoration:none}.chip.on{background:var(--accent);color:#fff;border-color:var(--accent)}
.wrap{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:12px}
table{border-collapse:collapse;width:100%;min-width:1500px;font-size:13px}th,td{padding:9px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}th{position:sticky;top:0;background:var(--card);color:var(--muted);font-weight:600;white-space:nowrap}
.st{display:inline-block;padding:2px 9px;border-radius:10px;font-size:12px;font-weight:600;background:#e5e7eb;color:#374151}
.st-CONFIRMED{background:#d1fae5;color:#065f46}.st-PAYMENT_PENDING{background:#fef3c7;color:#92400e}.st-CREATED{background:#e0e7ff;color:#3730a3}.st-CANCELLED,.st-EXPIRED{background:#fee2e2;color:#991b1b}.st-COMPLETED,.st-ONGOING{background:#cffafe;color:#155e75}
a{color:var(--accent)}
</style></head><body>
<h1>Bookings</h1><p class="sub">Latest ${rows.length} (newest first). Times are India time. Read-only.</p>
<div class="chips">${chips}</div>
<div class="wrap"><table><thead><tr><th>Booking</th><th>Status</th><th>Pickup time</th><th>Trip</th><th>Pickup</th><th>Stops</th><th>Drop</th><th>Vehicle</th><th>Fare</th><th>Paid</th><th>Due</th><th>Payment</th><th>Passenger</th><th>Phone</th><th>Driver</th><th>Website #</th><th>Booked</th></tr></thead><tbody>
${rows.length ? rows.join('\n') : '<tr><td colspan="17">No bookings found.</td></tr>'}
</tbody></table></div></body></html>`;
}

async function showBookings(req, res) {
  res.set('Cache-Control', 'no-store');
  res.set('X-Robots-Tag', 'noindex');
  if (!env.ADMIN_API_KEY) return res.status(503).type('text/plain').send('The bookings page is off: set ADMIN_API_KEY in Railway Variables.');
  if (!authorized(req)) {
    res.set('WWW-Authenticate', 'Basic realm="ABHI CABS bookings", charset="UTF-8"');
    return res.status(401).type('text/plain').send('Sign in: any user name, and your ADMIN_API_KEY as the password.');
  }

  try {
    const filter = STATUSES.includes(String(req.query.status || '').toUpperCase()) ? String(req.query.status).toUpperCase() : null;
    const prisma = getPrisma();
    const bookings = await prisma.booking.findMany({
      where: filter ? { status: filter } : {},
      orderBy: { createdAt: 'desc' },
      take: MAX_ROWS,
      include: { customer: true, payment: true },
    });

    // The counts above the table cover the rows shown. A customer missing from the result is looked up once.
    const counts = {};
    const customers = new Map();
    for (const b of bookings) {
      counts[b.status] = (counts[b.status] || 0) + 1;
      if (b.customer) customers.set(b.customerId, b.customer);
    }
    for (const id of new Set(bookings.map((b) => b.customerId))) {
      if (!customers.has(id)) customers.set(id, await prisma.customer.findUnique({ where: { id } }));
    }
    const rows = bookings.map((b) => row(b, customers.get(b.customerId), b.payment));
    return res.type('html').send(page(rows, counts, filter));
  } catch (err) {
    logger.error({ err: err.message }, '[bookingsPage] could not load the bookings');
    return res.status(500).type('text/plain').send('Could not load the bookings. Check the Railway Logs.');
  }
}

module.exports = { showBookings };
