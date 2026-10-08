const dayjs = require('dayjs');
const { STATES } = require('../states');
const { transition } = require('../sessionManager');
const { t } = require('../../utils/i18n');
const dateParser = require('../nlu/dateParser');
const locationParser = require('../nlu/locationParser');
const { callTool } = require('../../integrations/ai/tools');
const { logger } = require('../../config/logger');
const { toNumbered, rememberOptions } = require('../numberedMenu');
const { inr } = require('../../utils/format');
const env = require('../../config/env');
const { reverseGeocode } = require('../../integrations/abhicabs/geocodeService');
const { searchPlaces } = require('../../integrations/abhicabs/placeSearchService');

const TRIP_TYPES = [
  { id: 'TRIP_ONE_WAY', value: 'ONE_WAY', key: 'trip_one_way', number: 1, listLabel: 'One Way', description: 'Pickup to drop, single journey', aliases: ['one way', 'oneway'] },
  { id: 'TRIP_ROUND_TRIP', value: 'ROUND_TRIP', key: 'trip_round_trip', number: 2, listLabel: 'Round Trip', description: 'Go and return', aliases: ['round trip', 'roundtrip', 'round'] },
  { id: 'TRIP_HOURLY', value: 'HOURLY', key: 'trip_hourly', number: 3, listLabel: 'Local', description: 'Hourly cab within the city', aliases: ['local', 'hourly', 'rental'] },
  { id: 'TRIP_AIRPORT', value: 'AIRPORT', key: 'trip_airport', number: 4, listLabel: 'Airport', description: 'Airport pickup or drop', aliases: ['airport'] },
];

/**
 * Like t(), but returns `fallback` when the key is missing in the customer's
 * language file, so a language that has not been updated yet never shows a raw key.
 */
function tOr(language, key, fallback) {
  try {
    const v = t(language, key);
    if (!v || typeof v !== 'string' || v.includes(key)) return fallback;
    return v;
  } catch (e) {
    return fallback;
  }
}

/**
 * "Book a Cab": a new one-way booking that starts straight at the pickup question.
 * (The trip-type question was removed from the flow.)
 */
async function startBooking(ctx) {
  const { session } = ctx;
  session.resetDraft();
  await session.save();
  await transition(session, STATES.BOOKING_TRIP_TYPE);
  await promptTripType(ctx);
}

/**
 * Pickup question: WhatsApp's "Send location" button shares the customer's current
 * location. Typing a place name still works.
 */
async function askPlace(ctx, kind = 'pickup') {
  const { language } = ctx;
  const question = t(language, kind === 'drop' ? 'ask_drop' : 'ask_pickup');

  if (kind === 'pickup' && env.LOCATION_REQUEST_BUTTON) {
    const body = `${question}\n\n${tOr(language, 'pickup_button_hint', 'Tap the button to share your current location, or type the place name.')}`;
    try {
      await ctx.send.locationRequestRaw(body);
      return;
    } catch (err) {
      logger.warn({ err: err.message }, '[booking] location button could not be sent, using plain text');
    }
  }
  const hint = tOr(language, 'location_hint', 'Type the place name, or tap 📎 → Location to pick it on the map.');
  await ctx.send.raw(`${question}\n\n${hint}`);
}

/** Drop question: a "Search place" button; the customer then types the name and picks a match. */
async function askDrop(ctx) {
  const { language } = ctx;
  const body = `${t(language, 'ask_drop')}\n\n${tOr(language, 'drop_search_hint', 'Tap Search place, type the name, and pick it from the matches.')}`;
  try {
    await ctx.send.buttonsRaw(body, [{ id: 'DROP_SEARCH', title: tOr(language, 'btn_search_place', '🔍 Search place') }]);
  } catch (err) {
    logger.warn({ err: err.message }, '[booking] search button could not be sent, using plain text');
    await ctx.send.raw(`${t(language, 'ask_drop')}\n\n${tOr(language, 'drop_type_prompt', '🔍 Type the name of the place you are going to.')}`);
  }
}

/** A shared pin may have no name. Give it a readable address (Google) or, failing that, its coordinates. */
async function describePin(location) {
  if (location.address) return location;
  const address = await reverseGeocode(location.latitude, location.longitude);
  return {
    ...location,
    address: address || `Pinned location (${Number(location.latitude).toFixed(5)}, ${Number(location.longitude).toFixed(5)})`,
  };
}

// ── STEP 1: Trip type ──────────────────────────────────────────────

async function promptTripType(ctx) {
  const items = TRIP_TYPES.map((tt) => ({
    id: tt.id,
    number: tt.number,
    label: tOr(ctx.language, `trip_list_${tt.value.toLowerCase()}`, tt.listLabel),
    description: tt.description,
  }));
  const { rows, map } = toNumbered(items);
  // The list button needs a SHORT label (max 20 chars).
  await ctx.send.listRaw(
    tOr(ctx.language, 'ask_trip_type', 'What type of trip do you need?'),
    tOr(ctx.language, 'btn_select_trip', 'Select Trip'),
    [{ title: 'Trip Type', rows }],
    { header: tOr(ctx.language, 'trip_header', '🚕 Select Trip Type') }
  );
  await rememberOptions(ctx.session, map);
}

async function handleBookingTripType(ctx) {
  const { message, session } = ctx;
  const picked = TRIP_TYPES.find((tt) => tt.id === message.interactiveId);

  if (!picked) {
    // Allow free text like "one way" / natural language via nluRouter's entity hint.
    const typed = (message.text || message.interactiveTitle || '').toLowerCase();
    const guess = TRIP_TYPES.find((tt) => tt.aliases.some((a) => typed.includes(a)));
    if (!guess) {
      await promptTripType(ctx);
      return;
    }
    session.draft.tripType = guess.value;
  } else {
    session.draft.tripType = picked.value;
  }

  await session.save();
  await transition(session, STATES.BOOKING_PICKUP);
  await askPlace(ctx, 'pickup');
}

// ── STEP 2: Pickup ──────────────────────────────────────────────────

async function handleBookingPickup(ctx) {
  const { message, session } = ctx;

  let location;
  if (message.location) {
    location = await describePin(locationParser.fromWhatsAppLocationMessage(message.location));
  } else if (message.text) {
    location = locationParser.fromTypedText(message.text);
    if (locationParser.isAmbiguous(location.address)) {
      await ctx.send.text('location_ambiguous');
      return;
    }
  } else {
    await askPlace(ctx, 'pickup');
    return;
  }

  session.draft.pickup = location;
  await session.save();

  if (session.draft.tripType === 'HOURLY') {
    await transition(session, STATES.BOOKING_DATE);
    await promptDate(ctx);
  } else {
    await transition(session, STATES.BOOKING_DROP);
    await askDrop(ctx);
  }
}

// ── STEP 3: Drop (skipped for HOURLY) ───────────────────────────────

const TYPE_PLACE_PROMPT = '🔍 Type the name of the place you are going to (for example Hebbal or Kempegowda Airport).';

/** Which suggestion did the customer tap? Works for a row id, or for a row that arrives as plain text. */
function readPlaceChoice(message, options) {
  const id = message.interactiveId || '';
  const title = (message.text || message.interactiveTitle || '').trim();

  if (id === 'PLACE_AGAIN' || /search again/i.test(title)) return { again: true };
  if (id === 'PLACE_TYPED' || /use what i typed/i.test(title)) return { typed: true };
  const m = /^PLACE_(\d)$/.exec(id);
  if (m && options[Number(m[1])]) return { option: options[Number(m[1])] };

  const plain = title.toLowerCase();
  const byName = options.find((o) => plain && (plain === o.name.slice(0, 24).toLowerCase() || plain === o.name.toLowerCase()));
  return byName ? { option: byName } : {};
}

async function finishDrop(ctx, location) {
  const { session } = ctx;
  session.draft.drop = location;
  delete session.draft._placeOptions;
  delete session.draft._placeQuery;
  session.markModified('draft');
  await session.save();
  await transition(session, STATES.BOOKING_DATE);
  await promptDate(ctx);
}

async function handleBookingDrop(ctx) {
  const { message, session, language } = ctx;
  const options = session.draft._placeOptions || [];
  const title = (message.text || message.interactiveTitle || '').trim();

  // A map pin shared with 📎 → Location
  if (message.location) {
    await finishDrop(ctx, await describePin(locationParser.fromWhatsAppLocationMessage(message.location)));
    return;
  }

  // "Search place" button
  if (message.interactiveId === 'DROP_SEARCH' || /^(🔍\s*)?search place$/i.test(title)) {
    await ctx.send.raw(tOr(language, 'drop_type_prompt', TYPE_PLACE_PROMPT));
    return;
  }

  // Picking one of the suggestions shown earlier
  if (options.length) {
    const choice = readPlaceChoice(message, options);
    if (choice.option) {
      await finishDrop(ctx, { address: choice.option.address, latitude: choice.option.latitude, longitude: choice.option.longitude });
      return;
    }
    if (choice.again) {
      delete session.draft._placeOptions;
      session.markModified('draft');
      await session.save();
      await ctx.send.raw(tOr(language, 'drop_type_prompt', TYPE_PLACE_PROMPT));
      return;
    }
    if (choice.typed) {
      await finishDrop(ctx, locationParser.fromTypedText(session.draft._placeQuery || title));
      return;
    }
  }

  if (!title) {
    await askDrop(ctx);
    return;
  }

  // The customer typed a name: look it up and show the matches
  const matches = await searchPlaces(title, { near: session.draft.pickup });
  if (!matches.length) {
    // No search result (or search not available): use the text as typed, as before
    const typed = locationParser.fromTypedText(title);
    if (locationParser.isAmbiguous(typed.address)) {
      await ctx.send.text('location_ambiguous');
      return;
    }
    await finishDrop(ctx, typed);
    return;
  }

  session.draft._placeOptions = matches;
  session.draft._placeQuery = title;
  session.markModified('draft');
  await session.save();

  await ctx.send.listRaw(
    tOr(language, 'drop_choose_body', 'Select your drop location'),
    tOr(language, 'btn_select_place', 'Select place'),
    [
      {
        title: tOr(language, 'drop_matches_title', 'Matches'),
        rows: matches.map((m, i) => ({ id: `PLACE_${i}`, title: m.name.slice(0, 24), description: m.address.slice(0, 72) })),
      },
      {
        title: tOr(language, 'date_section_more', 'More'),
        rows: [
          { id: 'PLACE_AGAIN', title: '🔍 Search again' },
          { id: 'PLACE_TYPED', title: '✏️ Use what I typed', description: title.slice(0, 72) },
        ],
      },
    ],
    { header: tOr(language, 'drop_choose_header', '📍 Choose Drop') }
  );
}

// ── STEP 4: Date (calendar list) ────────────────────────────────────

/**
 * Sends the calendar: a tap-to-select WhatsApp list with Today, Tomorrow, the
 * following days, and an "Another date" row for anything else.
 * For the return date of a round trip, the list starts from the pickup day.
 */
async function promptDate(ctx, { returnTrip = false } = {}) {
  const { language, session } = ctx;
  const page = session.draft[returnTrip ? '_returnDatePage' : '_datePage'] || 0;
  const labels = {
    today: tOr(language, 'date_today', 'Today'),
    tomorrow: tOr(language, 'date_tomorrow', 'Tomorrow'),
  };
  const from = returnTrip && session.draft.pickupAt ? session.draft.pickupAt : undefined;
  const { dateRows, moreRows } = dateParser.getDatePage({ page, from, labels });

  await ctx.send.listRaw(
    returnTrip
      ? tOr(language, 'ask_return_date_body', 'What date will you return?')
      : tOr(language, 'ask_date_body', 'What date would you like to travel?'),
    tOr(language, 'date_pick_button', 'Pick a date'),
    [
      { title: tOr(language, 'date_section_available', 'Available dates'), rows: dateRows },
      { title: tOr(language, 'date_section_more', 'More'), rows: moreRows },
    ],
    {
      header: returnTrip ? tOr(language, 'return_date_header', '📅 Return Date') : tOr(language, 'date_header', '📅 Pick a Date'),
      footer: tOr(language, 'date_footer', 'Tap "Next 7 days" to see more, or type a date'),
    }
  );
}

/**
 * Reads the customer's date answer, whether they tapped a row or typed.
 * Returns { resolved } (a dayjs date), { nav: +1/-1 } for Next 7 days / Earlier dates,
 * { other: true } for the old "Another date" row, or {} when it could not be understood.
 */
function readDateAnswer(message) {
  const title = (message.text || message.interactiveTitle || '').trim();

  if (message.interactiveId === 'DATE_NEXT' || /next\s*7\s*days/i.test(title)) return { nav: 1 };
  if (message.interactiveId === 'DATE_PREV' || /earlier\s*dates/i.test(title)) return { nav: -1 };
  if (message.interactiveId === 'DATE_OTHER' || /^another date$/i.test(title)) return { other: true };

  const tapped = dateParser.parseDateReply(message.interactiveId);
  // A tapped row can also arrive as plain text, e.g. "Today · Thu 08 Oct" or "Sat 10 Oct".
  const rowText = title.match(/[A-Za-z]{3}\s+(\d{1,2})\s+([A-Za-z]{3})\s*$/);
  const resolved = dateParser.resolveDatePhrase(tapped || (rowText ? `${rowText[1]} ${rowText[2]}` : title));
  return resolved ? { resolved } : {};
}

async function changeDatePage(ctx, answer, { returnTrip = false } = {}) {
  const { session } = ctx;
  const key = returnTrip ? '_returnDatePage' : '_datePage';
  session.draft[key] = Math.max(0, (session.draft[key] || 0) + answer.nav);
  session.markModified('draft');
  await session.save();
  await promptDate(ctx, { returnTrip });
}

async function handleBookingDate(ctx) {
  const { message, session } = ctx;
  const answer = readDateAnswer(message);

  if (answer.nav) {
    await changeDatePage(ctx, answer);
    return;
  }

  if (answer.other) {
    await ctx.send.raw(
      tOr(ctx.language, 'ask_date_typed', '📅 Please type the travel date, for example 25 October or 25/10.')
    );
    return;
  }

  if (!answer.resolved) {
    await promptDate(ctx);
    return;
  }

  if (answer.resolved.isBefore(dateParser.now().startOf('day'))) {
    await ctx.send.raw(tOr(ctx.language, 'date_in_past', 'That date has already passed. Please choose a date from today onwards.'));
    await promptDate(ctx);
    return;
  }

  session.draft._pendingDate = answer.resolved.toISOString(); // temp holder until time is combined
  delete session.draft._datePage;
  delete session.draft._timePage;
  session.markModified('draft');
  await session.save();
  await transition(session, STATES.BOOKING_TIME);
  await promptTime(ctx);
}

// ── STEP 5: Time ─────────────────────────────────────────────────────

/** Time list: 7 slots, "More times", "Change date". Today starts from the current time. */
async function promptTime(ctx, { returnTrip = false } = {}) {
  const { language, session } = ctx;
  const date = dayjs(returnTrip ? session.draft._pendingReturnDate : session.draft._pendingDate).tz(dateParser.TZ);
  const notBefore = returnTrip && session.draft.pickupAt ? dayjs(session.draft.pickupAt).tz(dateParser.TZ) : null;
  const slots = dateParser.getTimeSlots({ date, notBefore });

  if (!slots.length) {
    await ctx.send.raw(tOr(language, 'no_slots_left', 'There are no more time slots left on that day. Please choose another date.'));
    await transition(session, returnTrip ? STATES.BOOKING_RETURN_DATE : STATES.BOOKING_DATE);
    await promptDate(ctx, { returnTrip });
    return;
  }

  const key = returnTrip ? '_returnTimePage' : '_timePage';
  const { lastPage } = dateParser.getTimePage({ slots, page: 0 });
  const page = Math.min(session.draft[key] || 0, lastPage);
  const { timeRows, moreRows } = dateParser.getTimePage({ slots, page });

  const question = returnTrip
    ? tOr(language, 'ask_return_time_body', 'What time should we pick you up for the return? (IST)')
    : tOr(language, 'ask_time_body', 'What time should the cab arrive? (IST)');

  await ctx.send.listRaw(
    `Great — *${date.format('dddd, D MMM YYYY')}*.\n\n${question}`,
    tOr(language, 'time_pick_button', 'Pick a time'),
    [
      { title: tOr(language, 'time_section_available', 'Available time slots'), rows: timeRows },
      { title: tOr(language, 'date_section_more', 'More'), rows: moreRows },
    ],
    {
      header: tOr(language, 'time_header', '⏰ Pick a Time'),
      footer: tOr(language, 'time_footer', 'All times are in IST. Or type a time, e.g. 6:45 PM'),
    }
  );
}

/** Reads a time answer: tapped slot, "More times", "Earlier times", "Change date", or typed text. */
function readTimeAnswer(message) {
  const title = (message.text || message.interactiveTitle || '').trim();
  const id = message.interactiveId || '';

  if (id === 'TIME_MORE' || /more\s*times/i.test(title)) return { nav: 1 };
  if (id === 'TIME_EARLIER' || /earlier\s*times/i.test(title)) return { nav: -1 };
  if (id === 'TIME_CHANGE_DATE' || /change\s*date/i.test(title)) return { changeDate: true };

  const time = dateParser.parseTimeReply(id) || dateParser.resolveTimePhrase(title);
  return time ? { time } : {};
}

async function changeTimePage(ctx, answer, { returnTrip = false } = {}) {
  const { session } = ctx;
  const key = returnTrip ? '_returnTimePage' : '_timePage';
  session.draft[key] = Math.max(0, (session.draft[key] || 0) + answer.nav);
  session.markModified('draft');
  await session.save();
  await promptTime(ctx, { returnTrip });
}

async function handleBookingTime(ctx) {
  const { message, session } = ctx;
  const answer = readTimeAnswer(message);

  if (answer.nav) {
    await changeTimePage(ctx, answer);
    return;
  }
  if (answer.changeDate) {
    delete session.draft._datePage;
    delete session.draft._timePage;
    session.markModified('draft');
    await transition(session, STATES.BOOKING_DATE);
    await promptDate(ctx);
    return;
  }

  const time = answer.time;
  if (!time) {
    await promptTime(ctx);
    return;
  }

  // _pendingDate is an ISO instant. Parse it as an instant and convert to India
  // time. (dayjs.tz(iso, TZ) reads the clock digits as India time instead, which
  // moved every booking one day earlier.)
  const dayjsDate = dayjs(session.draft._pendingDate).tz(dateParser.TZ);
  const combined = dateParser.combineDateTime(dayjsDate, time);

  if (dateParser.isPast(combined)) {
    await ctx.send.raw(tOr(ctx.language, 'time_in_past', 'That time has already passed. Please choose a later date or time.'));
    await transition(session, STATES.BOOKING_DATE);
    await promptDate(ctx);
    return;
  }

  delete session.draft._timePage;
  session.draft.pickupAt = combined.toDate();
  session.markModified('draft');
  await session.save();

  if (session.draft.tripType === 'ROUND_TRIP') {
    await transition(session, STATES.BOOKING_RETURN_DATE);
    await promptDate(ctx, { returnTrip: true });
    return;
  }
  if (session.draft.tripType === 'HOURLY') {
    await transition(session, STATES.BOOKING_RENTAL_HOURS);
    await ctx.send.text('ask_rental_hours');
    return;
  }

  await showVehicleOptions(ctx);
}

// ── STEP 5b: Round trip return date/time ────────────────────────────

async function handleBookingReturnDate(ctx) {
  const { message, session } = ctx;
  const answer = readDateAnswer(message);

  if (answer.nav) {
    await changeDatePage(ctx, answer, { returnTrip: true });
    return;
  }

  if (answer.other) {
    await ctx.send.raw(
      tOr(ctx.language, 'ask_date_typed', '📅 Please type the travel date, for example 25 October or 25/10.')
    );
    return;
  }

  if (!answer.resolved) {
    await promptDate(ctx, { returnTrip: true });
    return;
  }

  const pickupDay = session.draft.pickupAt ? dayjs(session.draft.pickupAt).tz(dateParser.TZ).startOf('day') : null;
  if (answer.resolved.isBefore(dateParser.now().startOf('day')) || (pickupDay && answer.resolved.isBefore(pickupDay))) {
    await ctx.send.raw(tOr(ctx.language, 'return_before_pickup', 'The return date cannot be before your pickup date. Please choose again.'));
    await promptDate(ctx, { returnTrip: true });
    return;
  }

  session.draft._pendingReturnDate = answer.resolved.toISOString();
  delete session.draft._returnDatePage;
  delete session.draft._returnTimePage;
  session.markModified('draft');
  await session.save();
  await transition(session, STATES.BOOKING_RETURN_TIME);
  await promptTime(ctx, { returnTrip: true });
}

async function handleBookingReturnTime(ctx) {
  const { message, session } = ctx;
  const answer = readTimeAnswer(message);

  if (answer.nav) {
    await changeTimePage(ctx, answer, { returnTrip: true });
    return;
  }
  if (answer.changeDate) {
    delete session.draft._returnDatePage;
    delete session.draft._returnTimePage;
    session.markModified('draft');
    await transition(session, STATES.BOOKING_RETURN_DATE);
    await promptDate(ctx, { returnTrip: true });
    return;
  }

  const time = answer.time;
  if (!time) {
    await promptTime(ctx, { returnTrip: true });
    return;
  }
  const dayjsDate = dayjs(session.draft._pendingReturnDate).tz(dateParser.TZ);
  const combined = dateParser.combineDateTime(dayjsDate, time);

  if (combined.isBefore(dayjs(session.draft.pickupAt))) {
    // return before pickup — ask again
    await ctx.send.raw(tOr(ctx.language, 'return_before_pickup', 'The return date cannot be before your pickup date. Please choose again.'));
    await transition(session, STATES.BOOKING_RETURN_DATE);
    await promptDate(ctx, { returnTrip: true });
    return;
  }

  delete session.draft._returnTimePage;
  session.draft.returnAt = combined.toDate();
  session.markModified('draft');
  await session.save();
  await showVehicleOptions(ctx);
}

// ── STEP 5c: Hourly rental package ──────────────────────────────────

async function handleBookingRentalHours(ctx) {
  const { message, session } = ctx;
  const hoursMatch = (message.text || message.interactiveTitle || '').match(/\d+/);
  if (!hoursMatch) {
    await ctx.send.text('ask_rental_hours');
    return;
  }
  session.draft.rentalHours = parseInt(hoursMatch[0], 10);
  await session.save();
  await showVehicleOptions(ctx);
}

// ── STEP 6: Cab type (fares come from the fare engine — never invented) ────

const MAX_LIST_ROWS = 10; // WhatsApp allows at most 10 rows in one list
const CATEGORY_ORDER = ['SEDAN', 'SUV', 'PREMIUM', 'LUXURY', 'TEMPO_TRAVELLER', 'BUS'];

const titleCase = (s) =>
  String(s).toLowerCase().split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

/**
 * Fetches priced cab options for this trip and shows them.
 * minSeats: only offer cabs that seat at least this many (used when the passenger
 * count turned out to be more than the chosen cab holds).
 */
async function showVehicleOptions(ctx, { minSeats = 0 } = {}) {
  const { session } = ctx;
  await ctx.send.text('checking_vehicles');

  let options;
  try {
    options = await callTool('getFareOptions', {
      tripType: session.draft.tripType,
      pickup: session.draft.pickup,
      drop: session.draft.drop,
      pickupAt: session.draft.pickupAt,
      returnAt: session.draft.returnAt,
      rentalHours: session.draft.rentalHours,
    });
  } catch (err) {
    logger.error({ err: err.message }, '[booking] getFareOptions failed');
    await ctx.send.text('fare_api_failed');
    return;
  }

  options = (options || []).filter((o) => o.seatingCapacity >= minSeats);

  if (options.length === 0) {
    await ctx.send.text('no_vehicles_available');
    const { escalateToHuman } = require('./handoff.handler');
    await escalateToHuman(ctx, 'NO_VEHICLES_AVAILABLE', { category: 'BOOKING_ISSUE' });
    return;
  }

  options.sort((a, b) => a.fare.total - b.fare.total);

  // Persist minimal option data on the session so the selection survives a restart.
  session.draft._vehicleOptions = options.map((o) => ({
    vehicleId: o.vehicleId,
    vehicleName: o.vehicleName,
    category: o.category,
    seatingCapacity: o.seatingCapacity,
    ac: o.ac,
    fareQuoteId: o.fareQuoteId,
    fare: o.fare,
  }));
  session.draft._vehicleCategory = null;
  session.draft.vehicleId = null;
  session.markModified('draft');

  await transition(session, STATES.BOOKING_VEHICLE_SELECTION);
  await sendVehicleChoices(ctx);
}

/**
 * Shows either the cab list, or — when there are more than 10 cabs, which WhatsApp
 * cannot fit in one list — a short "Cab Type" list (Sedan, SUV, Tempo Traveller...)
 * followed by the cabs of the chosen type.
 */
async function sendVehicleChoices(ctx) {
  const { session, language } = ctx;
  const all = session.draft._vehicleOptions || [];
  const category = session.draft._vehicleCategory;

  if (!category && all.length > MAX_LIST_ROWS) {
    const groups = new Map();
    for (const o of all) {
      if (!groups.has(o.category)) groups.set(o.category, []);
      groups.get(o.category).push(o);
    }
    const rank = (c) => (CATEGORY_ORDER.indexOf(c) === -1 ? 99 : CATEGORY_ORDER.indexOf(c));
    const categories = [...groups.keys()].sort((a, b) => rank(a) - rank(b)).slice(0, MAX_LIST_ROWS);

    const rows = categories.map((c, i) => {
      const g = groups.get(c);
      const from = Math.min(...g.map((o) => o.fare.total));
      return {
        id: `CAT_${c}`,
        number: i + 1,
        label: tOr(language, `cab_category_${c}`, titleCase(c)),
        description: `${g.length} option${g.length > 1 ? 's' : ''} · from ${inr(from)}`,
      };
    });
    const { rows: numbered, map } = toNumbered(rows);
    await ctx.send.listRaw(
      t(language, 'ask_cab_type'),
      tOr(language, 'btn_select_cab_type', 'Select Cab Type'),
      [{ title: 'Cab types', rows: numbered }]
    );
    await rememberOptions(session, map);
    return;
  }

  const pool = (category ? all.filter((o) => o.category === category) : all).slice(0, MAX_LIST_ROWS);
  const rows = pool.map((o, i) => ({
    id: `VEHICLE_${o.vehicleId}`,
    number: i + 1,
    label: `${o.vehicleName}`.slice(0, 22),
    // The row title is cut off at 24 characters by WhatsApp, so the full name goes here too.
    description: `${o.vehicleName} · ${o.seatingCapacity} seats · ${inr(o.fare.total)}`,
  }));
  const { rows: numbered, map } = toNumbered(rows);
  await ctx.send.listRaw(
    t(language, 'select_vehicle'),
    tOr(language, 'btn_select_vehicle', 'Select Vehicle'),
    [{ title: 'Vehicles', rows: numbered }]
  );
  await rememberOptions(session, map);
}

async function chooseVehicle(ctx, option) {
  const { session } = ctx;
  session.draft.vehicleId = option.vehicleId;
  session.draft.vehicleName = option.vehicleName;
  session.draft.vehicleClass = option.category;
  session.draft.fareQuoteId = option.fareQuoteId;
  session.draft.fare = option.fare;
  session.markModified('draft');
  await session.save();

  // Came back here because the group was bigger than the cab? Details are already known.
  if (session.draft.passengerName && session.draft.passengerCount) {
    const { showBookingReview } = require('./bookingReview.handler');
    await showBookingReview(ctx);
    return;
  }

  await transition(session, STATES.BOOKING_CUSTOMER_NAME);
  await ctx.send.text('ask_name');
}

async function handleBookingVehicleSelection(ctx) {
  const { message, session } = ctx;
  const id = message.interactiveId || '';
  const all = session.draft._vehicleOptions || [];

  // Tapped a cab type (Sedan / SUV / ...)
  if (id.startsWith('CAT_')) {
    const category = id.slice(4);
    const inCategory = all.filter((o) => o.category === category);
    if (inCategory.length === 1) {
      await chooseVehicle(ctx, inCategory[0]); // only one cab of this type: no need to ask again
      return;
    }
    if (inCategory.length > 1) {
      session.draft._vehicleCategory = category;
      session.markModified('draft');
      await session.save();
      await sendVehicleChoices(ctx);
      return;
    }
  }

  const vehicleId = id.replace(/^VEHICLE_/, '');
  const option = all.find((o) => o.vehicleId === vehicleId);
  if (!option) {
    await sendVehicleChoices(ctx);
    return;
  }

  await chooseVehicle(ctx, option);
}

// ── STEP 7: Passenger details (name is asked in bookingReview.handler, then the count here) ──

async function handleBookingPassengers(ctx) {
  const { message, session } = ctx;
  const countMatch = (message.text || message.interactiveTitle || '').match(/\d+/);
  const count = countMatch ? parseInt(countMatch[0], 10) : 0;
  if (!count || count > 60) {
    await ctx.send.text('ask_passenger_count');
    return;
  }

  session.draft.passengerCount = count;
  await session.save();

  const chosen = (session.draft._vehicleOptions || []).find((o) => o.vehicleId === session.draft.vehicleId);
  if (chosen && count > chosen.seatingCapacity) {
    await ctx.send.text('passenger_exceeds', { cab: chosen.vehicleName, seats: chosen.seatingCapacity });
    await showVehicleOptions(ctx, { minSeats: count });
    return;
  }

  const { showBookingReview } = require('./bookingReview.handler');
  await showBookingReview(ctx);
}

async function showFareConfirmation(ctx, option) {
  const { session } = ctx;
  const f = option.fare;
  const body =
    `${t(ctx.language, 'fare_estimate_title')}\n\n` +
    `Vehicle: ${option.vehicleName}\n` +
    `Base Fare: ₹${f.baseFare}\n` +
    (f.driverAllowance ? `Driver Allowance: ₹${f.driverAllowance}\n` : '') +
    (f.surge ? `Surge: ₹${f.surge}\n` : '') +
    `Tax: ₹${f.tax}\n\n` +
    `Total: ₹${f.total}`;

  await transition(session, STATES.BOOKING_FARE_CONFIRMATION);

  if (ctx.fareOnly) {
    await ctx.send.raw(body);
    const { renderMainMenu } = require('./mainMenu.handler');
    await transition(session, STATES.MAIN_MENU);
    await renderMainMenu(ctx);
    return;
  }

  const buttons = [
    { id: 'FARE_CONTINUE', number: 1, label: t(ctx.language, 'continue_booking') },
    { id: 'FARE_CHANGE_VEHICLE', number: 2, label: t(ctx.language, 'change_vehicle') },
    { id: 'FARE_MODIFY_TRIP', number: 3, label: t(ctx.language, 'modify_trip') },
  ];
  const { rows: numberedButtons, map } = toNumbered(
    buttons.map((b) => ({ ...b, maxTitleLength: 20 }))
  );

  await ctx.send.buttonsRaw(
    body,
    numberedButtons.map((b) => ({ id: b.id, title: b.title }))
  );
  await rememberOptions(session, map);
}

async function handleBookingFareConfirmation(ctx) {
  const { message, session } = ctx;

  if (message.interactiveId === 'FARE_CHANGE_VEHICLE') {
    await showVehicleOptions(ctx);
    return;
  }
  if (message.interactiveId === 'FARE_MODIFY_TRIP') {
    session.resetDraft();
    await transition(session, STATES.BOOKING_TRIP_TYPE);
    await promptTripType(ctx);
    return;
  }

  // Default / FARE_CONTINUE
  await transition(session, STATES.BOOKING_CUSTOMER_NAME);
  await ctx.send.text('ask_name');
}

module.exports = {
  startBooking,
  promptTripType,
  promptDate,
  showVehicleOptions,
  handleBookingTripType,
  handleBookingPickup,
  handleBookingDrop,
  handleBookingDate,
  handleBookingTime,
  handleBookingReturnDate,
  handleBookingReturnTime,
  handleBookingRentalHours,
  handleBookingPassengers,
  handleBookingVehicleSelection,
  handleBookingFareConfirmation,
};
