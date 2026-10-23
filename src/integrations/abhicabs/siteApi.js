const axios = require('axios');
const env = require('../../config/env');

/**
 * The ABHI CABS website's own API, used the way the website backend intends the WhatsApp bot to use it:
 *
 *   1. POST /auth/service/whatsapp-session   header x-service-key, body { phone, profileName }
 *      -> a normal short-lived (15 minute) customer token. The phone MUST be the number from the verified WhatsApp
 *         webhook, never text a customer typed (see sessionManager: the customer record is keyed by the webhook number).
 *   2. POST /bookings   Authorization: Bearer <token>, header Idempotency-Key
 *      -> the website creates the booking with ALL of its own rules (price, attempt log, booking number, events).
 *
 * SITE_API_URL is the API base including /api/v1, for example https://your-website-api.up.railway.app/api/v1
 */
const tokens = new Map(); // phone -> { token, expiresAt }

const base = () => String(env.SITE_API_URL || '').replace(/\/+$/, '');
const unwrap = (res) => (res && res.data && res.data.data !== undefined ? res.data.data : res && res.data);

/** A short, safe description of a failed call (no tokens, no keys). */
function errorInfo(err) {
  const body = err && err.response && err.response.data;
  return {
    status: (err && err.response && err.response.status) || null,
    code: (body && ((body.error && body.error.code) || body.code)) || (err && err.code) || null,
    message: String((body && (body.message || (body.error && body.error.message))) || (err && err.message) || 'unknown error').slice(0, 300),
  };
}

async function startSession(phone, profileName, { force = false } = {}) {
  const cached = tokens.get(phone);
  if (!force && cached && cached.expiresAt - Date.now() > 60 * 1000) return cached;
  const res = await axios.post(
    `${base()}/auth/service/whatsapp-session`,
    { phone: String(phone), ...(profileName ? { profileName: String(profileName).slice(0, 120) } : {}) },
    { headers: { 'x-service-key': env.SITE_SERVICE_KEY, 'Content-Type': 'application/json' }, timeout: 12000 }
  );
  const d = unwrap(res);
  if (!d || !d.accessToken) throw new Error('the website did not return an access token');
  const entry = { token: d.accessToken, expiresAt: Date.now() + (Number(d.expiresIn) || 900) * 1000, customer: d.customer || null };
  if (tokens.size > 2000) tokens.clear();
  tokens.set(phone, entry);
  return entry;
}

/** Creates the booking on the website for this phone number. Returns the website's booking object. */
async function createBooking(phone, profileName, payload, idempotencyKey) {
  const post = async (session) =>
    axios.post(`${base()}/bookings`, payload, {
      headers: {
        Authorization: `Bearer ${session.token}`,
        'Idempotency-Key': idempotencyKey,
        'Content-Type': 'application/json',
        // The website stores this in the booking's own `meta` field (meta.source), so every WhatsApp booking can be
        // told apart in its table without adding any column.
        'x-client-source': 'whatsapp-bot',
      },
      timeout: 20000,
    });
  let res;
  try {
    res = await post(await startSession(phone, profileName));
  } catch (err) {
    if (err && err.response && err.response.status === 401) {
      tokens.delete(phone); // the 15 minute token ran out: exchange the key again, once
      res = await post(await startSession(phone, profileName, { force: true }));
    } else {
      throw err;
    }
  }
  const d = unwrap(res);
  return (d && d.booking) || d;
}

function clearSessions() {
  tokens.clear();
}

module.exports = { startSession, createBooking, errorInfo, clearSessions };
