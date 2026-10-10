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
const calendarLink = require('../../utils/calendarLink');

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
 * Pickup question. It is a normal button message, so it shows on every device (phone, Web, Desktop):
 *   [📍 Current location]  — then we ask for the location (see sendLocationPrompt)
 * Typing a place name, or sharing a pin with 📎 → Location, also works at any time.
 */
async function askPlace(ctx, kind = 'pickup') {
  const { language } = ctx;
  const question = t(language, kind === 'drop' ? 'ask_drop' : 'ask_pickup');

  if (kind === 'pickup') {
    const body = `${question}\n\n${tOr(language, 'pickup_button_hint', 'Tap Current location to share where you are, or Search place to find it by name.')}`;
    try {
      await ctx.send.buttonsRaw(body, [
        { id: 'PICKUP_CURRENT', title: tOr(language, 'btn_current_location', '📍 Current location') },
        { id: 'PICKUP_SEARCH', title: tOr(language, 'btn_search_place', '🔍 Search place') },
      ]);
      return;
    } catch (err) {
      logger.warn({ err: err.message }, '[booking] pickup button could not be sent, using plain text');
    }
  }
  const hint = tOr(language, 'location_hint', 'Type the place name, or tap 📎 → Location to pick it on the map.');
  await ctx.send.raw(`${question}\n\n${hint}`);
}

/**
 * The customer tapped "Current location". A plain text instruction always goes first (it shows
 * everywhere); WhatsApp's "Send location" button follows as an extra when it is switched on.
 * That button only appears on the phone app, so it must never be the only thing we send.
 */
async function sendLocationPrompt(ctx) {
  await ctx.send.raw(
    tOr(ctx.language, 'share_location_steps', '📍 Please share your current location:\ntap 📎 → Location → Send your current location.\n\nOr just type the place name.')
  );
  if (env.LOCATION_REQUEST_BUTTON) {
    try {
      await ctx.send.locationRequestRaw(tOr(ctx.language, 'share_location_button', 'Or tap the button below to share it.'));
    } catch (err) {
      logger.warn({ err: err.message }, '[booking] location button could not be sent');
    }
  }
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

async function finishPickup(ctx, location) {
  const { session } = ctx;
  session.draft.pickup = location;
  delete session.draft._placeOptions;
  delete session.draft._placeQuery;
  session.markModified('draft');
  await session.save();

  if (session.draft.tripType === 'HOURLY') {
    await transition(session, STATES.BOOKING_DATE);
    await promptDate(ctx);
  } else {
    await transition(session, STATES.BOOKING_DROP);
    await askDrop(ctx);
  }
}

/** One row of the place list: the name (up to 24 characters) with the full name and address underneath. */
const placeRow = (m, i) => ({
  id: `PLACE_${i}`,
  title: m.name.slice(0, 24),
  description: (m.name.length > 24 ? `${m.name} — ${m.address}` : m.address).slice(0, 72),
});

/** After a place is picked from the search results, show it on a small map. A failure never blocks the booking. */
async function showPlaceMap(ctx, place) {
  if (!env.PLACE_MAP_CARD || place.latitude == null || place.longitude == null) return;
  try {
    await ctx.send.locationCardRaw({ latitude: place.latitude, longitude: place.longitude, name: place.name, address: place.address });
  } catch (err) {
    logger.warn({ err: err.message }, '[booking] map card could not be sent');
  }
}

/** The address kept for the booking: the place name too, unless Google's address already has it. */
const placeAddress = (m) => (String(m.address).toLowerCase().includes(String(m.name).toLowerCase()) ? m.address : `${m.name}, ${m.address}`);

const TYPE_PICKUP_PROMPT = '🔍 Type the name of the place you are starting from (for example Rajajinagar or Majestic).';

async function handleBookingPickup(ctx) {
  const { message, session, language } = ctx;
  const title = (message.text || message.interactiveTitle || '').trim();
  const options = session.draft._placeOptions || [];

  // "Current location" button
  if (message.interactiveId === 'PICKUP_CURRENT' || /^(📍\s*)?current location$/i.test(title)) {
    await sendLocationPrompt(ctx);
    return;
  }

  // "Search place" button
  if (message.interactiveId === 'PICKUP_SEARCH' || /^(🔍\s*)?search place$/i.test(title)) {
    await ctx.send.raw(tOr(language, 'pickup_type_prompt', TYPE_PICKUP_PROMPT));
    return;
  }

  // A map pin / current location shared with WhatsApp
  if (message.location) {
    await finishPickup(ctx, await describePin(locationParser.fromWhatsAppLocationMessage(message.location)));
    return;
  }

  // Picking one of the suggestions shown earlier
  if (options.length) {
    const choice = readPlaceChoice(message, options);
    if (choice.option) {
      await showPlaceMap(ctx, choice.option);
      await finishPickup(ctx, { address: placeAddress(choice.option), latitude: choice.option.latitude, longitude: choice.option.longitude });
      return;
    }
    if (choice.again) {
      delete session.draft._placeOptions;
      session.markModified('draft');
      await session.save();
      await ctx.send.raw(tOr(language, 'pickup_type_prompt', TYPE_PICKUP_PROMPT));
      return;
    }
    if (choice.typed) {
      await finishPickup(ctx, locationParser.fromTypedText(session.draft._placeQuery || title));
      return;
    }
  }

  if (!title) {
    await askPlace(ctx, 'pickup');
    return;
  }

  // The customer typed a name: look it up and show the matches
  const matches = await searchPlaces(title);
  if (!matches.length) {
    const typed = locationParser.fromTypedText(title);
    if (locationParser.isAmbiguous(typed.address)) {
      await ctx.send.text('location_ambiguous');
      return;
    }
    await finishPickup(ctx, typed);
    return;
  }

  session.draft._placeOptions = matches;
  session.draft._placeQuery = title;
  session.markModified('draft');
  await session.save();

  await ctx.send.listRaw(
    tOr(language, 'pickup_choose_body', 'Select your pickup location'),
    tOr(language, 'btn_select_place', 'Select place'),
    [
      {
        title: tOr(language, 'drop_matches_title', 'Matches'),
        rows: matches.map(placeRow),
      },
      {
        title: tOr(language, 'date_section_more', 'More'),
        rows: [
          { id: 'PLACE_AGAIN', title: '🔍 Search again' },
          { id: 'PLACE_TYPED', title: '✏️ Use what I typed', description: title.slice(0, 72) },
        ],
      },
    ],
    { header: tOr(language, 'pickup_choose_header', '📍 Choose Pickup') }
  );
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
      await showPlaceMap(ctx, choice.option);
      await finishDrop(ctx, { address: placeAddress(choice.option), latitude: choice.option.latitude, longitude: choice.option.longitude });
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
        rows: matches.map(placeRow),
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
/** "Now: Fri 9 Oct 2026, 11:24 AM (IST)" — shown on the date step so the customer sees today's date and time. */
function nowLine(language) {
  return tOr(language, 'now_line', `🕒 Now: ${dateParser.now().format('ddd D MMM YYYY, h:mm A')} (IST)`);
}

/** Every half hour of the day as { id: '10:30', title: '10:30 AM' } for the Flow's time dropdown. */
function flowTimeSlots() {
  const slots = [];
  for (let m = 0; m < 24 * 60; m += 30) {
    const h = Math.floor(m / 60);
    const mi = m % 60;
    slots.push({ id: `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`, title: `${h % 12 || 12}:${String(mi).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}` });
  }
  return slots;
}

const calMonthKey = (returnTrip) => (returnTrip ? '_returnCalMonth' : '_calMonth');
const calWeekKey = (returnTrip) => (returnTrip ? '_returnCalWeek' : '_calWeek');

function calendarFor(session, returnTrip) {
  const from = returnTrip && session.draft.pickupAt ? session.draft.pickupAt : undefined;
  const bounds = dateParser.getCalendarBounds({ from });
  let month = dateParser.parseMonthKey(session.draft[calMonthKey(returnTrip)]) || bounds.firstMonth;
  if (month.isBefore(bounds.firstMonth)) month = bounds.firstMonth;
  if (month.isAfter(bounds.lastMonth)) month = bounds.lastMonth;
  return { ...bounds, month };
}

/** What the tap-only picker shows right now: the months, the weeks of a month, or the days of a week. */
function tapView(session, returnTrip, language) {
  const { min, month } = calendarFor(session, returnTrip);
  if (!dateParser.parseMonthKey(session.draft[calMonthKey(returnTrip)])) {
    return { view: 'months', month, rows: dateParser.getMonthRows({ min }) };
  }
  const weeks = dateParser.getWeeksOfMonth({ month, min });
  const idx = session.draft[calWeekKey(returnTrip)];
  if (!Number.isInteger(idx) || !weeks[idx]) {
    return { view: 'weeks', month, weeks, rows: dateParser.getWeekRows(weeks, { back: tOr(language, 'date_other_months', 'Other months') }) };
  }
  return {
    view: 'dates',
    month,
    week: weeks[idx],
    rows: dateParser.getDatesOfWeek(weeks[idx], {
      today: tOr(language, 'date_today', 'Today'),
      tomorrow: tOr(language, 'date_tomorrow', 'Tomorrow'),
      back: tOr(language, 'date_other_weeks', 'Other weeks'),
    }),
  };
}

/** Tap-only calendar: month -> week -> day. Nothing to type; it runs on into next year. */
async function promptTapDate(ctx, { returnTrip = false, question, header }) {
  const { language, session } = ctx;
  const v = tapView(session, returnTrip, language);
  const button = tOr(language, 'date_pick_button', 'Pick a date');

  if (v.view === 'months') {
    await ctx.send.listRaw(
      `${question}\n${nowLine(language)}`,
      button,
      [{ title: tOr(language, 'date_section_months', 'Choose month'), rows: v.rows }],
      { header, footer: tOr(language, 'date_taps_footer', 'Pick month, week, then day. Or type a date, e.g. 25 Oct') }
    );
    return;
  }
  if (v.view === 'weeks') {
    await ctx.send.listRaw(
      `${question}\n*${v.month.format('MMMM YYYY')}*`,
      button,
      [{ title: tOr(language, 'date_section_weeks', 'Choose week'), rows: v.rows }],
      { header, footer: tOr(language, 'date_taps_footer', 'Pick month, week, then day. Or type a date, e.g. 25 Oct') }
    );
    return;
  }
  await ctx.send.listRaw(
    `${question}\n*${v.week.first.format('D MMM')} – ${v.week.last.format('D MMM')}*`,
    button,
    [{ title: tOr(language, 'date_section_available', 'Available dates'), rows: v.rows }],
    { header, footer: tOr(language, 'date_taps_footer', 'Pick month, week, then day. Or type a date, e.g. 25 Oct') }
  );
}

/** Moves between the months / weeks / days views. */
async function handleTapNav(ctx, answer, { returnTrip = false } = {}) {
  const { session } = ctx;
  const mk = calMonthKey(returnTrip);
  const wk = calWeekKey(returnTrip);
  if (answer.month) {
    session.draft[mk] = answer.month;
    delete session.draft[wk];
  } else if (answer.week !== undefined) {
    session.draft[wk] = answer.week;
  } else if (answer.backMonths) {
    delete session.draft[mk];
    delete session.draft[wk];
  } else if (answer.backWeeks) {
    delete session.draft[wk];
  }
  session.markModified('draft');
  await session.save();
  await promptDate(ctx, { returnTrip });
}

const isTapNav = (a) => a.month || a.week !== undefined || a.backMonths || a.backWeeks;

/**
 * Month calendar with ◀ / ▶ buttons that run on into the next months and years.
 * The customer types the day number for the month shown (e.g. 15), or a full date (25 Dec 2026).
 */
async function promptDate(ctx, { returnTrip = false } = {}) {
  const { language, session } = ctx;
  const { min, month, lastMonth } = calendarFor(session, returnTrip);
  const cal = dateParser.renderMonthCalendar({ month, min, lastMonth });

  const question = returnTrip
    ? tOr(language, 'ask_return_date_body', 'What date will you return?')
    : tOr(language, 'ask_date_body', 'What date would you like to travel?');
  const header = returnTrip ? tOr(language, 'return_date_header', '📅 Return Date') : tOr(language, 'date_header', '📅 Pick a Date');
  const how = tOr(
    language,
    'calendar_how',
    `Type the day number (for example ${cal.firstAvailable || 15}) for ${cal.monthLabel}, or tap ◀ ▶ to change the month. A full date like 25 Dec 2026 also works.`
  );

  // A real tap-a-date calendar (WhatsApp Flow) when one is set up; the text calendar is the fallback.
  if (env.DATE_FLOW_ID) {
    try {
      await ctx.send.flowRaw({
        header,
        body: `${question}\n${nowLine(language)}\n\n${env.DATE_FLOW_TIME
          ? tOr(language, 'calendar_flow_hint_time', 'Tap the button to pick the date and time, or just type a date (e.g. 25 Oct).')
          : tOr(language, 'calendar_flow_hint', 'Tap the button to open the calendar, or just type a date (e.g. 25 Oct).')}`,
        flowId: env.DATE_FLOW_ID,
        cta: env.DATE_FLOW_TIME ? tOr(language, 'date_time_pick_button', 'Pick date and time') : tOr(language, 'date_pick_button', 'Pick a date'),
        screen: 'PICK_DATE',
        data: {
          min_date: min.format('YYYY-MM-DD'),
          max_date: lastMonth.endOf('month').format('YYYY-MM-DD'),
          ...(env.DATE_FLOW_TIME ? { time_slots: flowTimeSlots() } : {}),
        },
      });
      return;
    } catch (err) {
      logger.warn({ err: err.message }, '[booking] calendar flow could not be sent, using the text calendar');
    }
  }

  // A link that opens a real tap-a-date calendar page (needs PUBLIC_BASE_URL); falls through to the lists if it is not set up.
  if (env.DATE_PICKER === 'link' && calendarLink.enabled()) {
    const token = calendarLink.createToken({
      number: session.whatsappNumber,
      min: min.format('YYYY-MM-DD'),
      max: lastMonth.endOf('month').format('YYYY-MM-DD'),
      returnTrip,
    });
    await ctx.send.raw(
      `*${header}*\n${question}\n${nowLine(language)}\n\n${tOr(language, 'calendar_link_hint', 'Tap the link to open the calendar and pick your date:')}\n${calendarLink.linkFor(token)}\n\n${tOr(language, 'calendar_link_type', 'Or just type a date, e.g. 25 Oct.')}`
    );
    return;
  }

  if (env.DATE_PICKER !== 'text') {
    await promptTapDate(ctx, { returnTrip, question, header });
    return;
  }

  const buttons = [];
  if (cal.canPrev) buttons.push({ id: 'CAL_PREV', title: `◀ ${cal.prevLabel}` });
  if (cal.canNext) buttons.push({ id: 'CAL_NEXT', title: `${cal.nextLabel} ▶` });

  await ctx.send.buttonsRaw(`*${header}*\n${question}\n${nowLine(language)}\n\n\`\`\`\n${cal.text}\n\`\`\`\n${how}`, buttons);
}

/**
 * Reads the customer's date answer.
 * Returns { move: ±1 } (◀ / ▶), { day: n } (a day number of the month shown), { resolved } (a dayjs date),
 * or {} when it could not be understood.
 */
function readDateAnswer(message, rows = []) {
  const title = (message.text || message.interactiveTitle || '').trim();
  let id = message.interactiveId || '';

  // A tapped row can arrive as plain text: match it against the rows we just offered.
  if (!id && title) {
    const norm = (x) => String(x).replace(/\s+/g, ' ').trim().toLowerCase();
    const hit = rows.find((r) => norm(r.title) === norm(title));
    if (hit) id = hit.id;
  }

  const monthPick = /^CALMONTH_(\d{4}-\d{2})$/.exec(id);
  if (monthPick) return { month: monthPick[1] };
  const weekPick = /^CALWEEK_(\d+)$/.exec(id);
  if (weekPick) return { week: Number(weekPick[1]) };
  if (id === 'CAL_MONTHS') return { backMonths: true };
  if (id === 'CAL_WEEKS') return { backWeeks: true };

  if (id === 'CAL_PREV' || /^◀/.test(title)) return { move: -1 };
  if (id === 'CAL_NEXT' || /▶$/.test(title)) return { move: 1 };
  const flowDate = /^FLOWDATE_(\d{4}-\d{2}-\d{2})(?:_(\d{4}))?$/.exec(id);
  if (flowDate) {
    const picked = dateParser.resolveDatePhrase(flowDate[1]);
    return picked ? { resolved: picked, flowTimeId: flowDate[2] ? `TIME_${flowDate[2]}` : null } : {};
  }
  if (/^\d{1,2}$/.test(title)) return { day: Number(title) };

  const resolved = dateParser.resolveDatePhrase(dateParser.parseDateReply(id) || title);
  return resolved ? { resolved } : {};
}

/** Handles ◀ / ▶ and a typed day number. Returns a dayjs date when a day was picked, otherwise null. */
async function handleCalendarAnswer(ctx, answer, { returnTrip = false } = {}) {
  const { session } = ctx;
  const cal = calendarFor(session, returnTrip);
  const key = calMonthKey(returnTrip);

  if (answer.move) {
    const target = cal.month.add(answer.move, 'month');
    const ok = !target.isBefore(cal.firstMonth) && !target.isAfter(cal.lastMonth);
    session.draft[key] = (ok ? target : cal.month).format('YYYY-MM');
    session.markModified('draft');
    await session.save();
    await promptDate(ctx, { returnTrip });
    return null;
  }

  if (answer.day) {
    const picked = answer.day <= cal.month.daysInMonth() ? cal.month.date(answer.day) : null;
    if (picked && !picked.isBefore(cal.min)) return picked;
    await ctx.send.raw(
      tOr(ctx.language, 'calendar_day_unavailable', `${answer.day} is not available in ${cal.month.format('MMMM YYYY')}. Please pick another day.`)
    );
    await promptDate(ctx, { returnTrip });
    return null;
  }
  return null;
}

async function handleBookingDate(ctx) {
  const { message, session } = ctx;
  const rows = env.DATE_PICKER === 'text' ? [] : tapView(session, false, ctx.language).rows;
  const answer = readDateAnswer(message, rows);

  if (isTapNav(answer)) {
    await handleTapNav(ctx, answer);
    return;
  }

  let date = answer.resolved || null;
  if (answer.move || answer.day) {
    date = await handleCalendarAnswer(ctx, answer);
    if (!date) return;
  }
  const flowTimeId = answer.flowTimeId || null;

  if (!date) {
    await promptDate(ctx);
    return;
  }

  if (date.isBefore(dateParser.now().startOf('day'))) {
    await ctx.send.raw(tOr(ctx.language, 'date_in_past', 'That date has already passed. Please choose a date from today onwards.'));
    await promptDate(ctx);
    return;
  }

  session.draft._pendingDate = date.toISOString(); // temp holder until time is combined
  delete session.draft._calMonth;
  delete session.draft._calWeek;
  delete session.draft._timePage;
  session.markModified('draft');
  await session.save();
  await transition(session, STATES.BOOKING_TIME);
  if (flowTimeId) {
    // The calendar Flow already gave the time too: carry on as if the customer had tapped it.
    await handleBookingTime({ ...ctx, message: { interactiveId: flowTimeId } });
    return;
  }
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
  const showNow = !returnTrip && date.isSame(dateParser.now(), 'day');
  const { timeRows, moreRows } = dateParser.getTimePage({ slots, page, nowLabel: showNow ? dateParser.now().format('h:mm A') : null });

  const question = returnTrip
    ? tOr(language, 'ask_return_time_body', 'What time should we pick you up for the return? (IST)')
    : tOr(language, 'ask_time_body', 'What time should the cab arrive? (IST)');

  await ctx.send.listRaw(
    `Great — *${date.format('dddd, D MMM YYYY')}*.\n\n${question}\n${tOr(language, 'now_time_line', `🕒 Now: ${dateParser.now().format('h:mm A')}`)}`,
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

  if (id === 'TIME_NOW' || /^now\b/i.test(title)) return { now: true };
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
    delete session.draft._calMonth;
  delete session.draft._calWeek;
    delete session.draft._timePage;
    session.markModified('draft');
    await transition(session, STATES.BOOKING_DATE);
    await promptDate(ctx);
    return;
  }

  // _pendingDate is an ISO instant. Parse it as an instant and convert to India
  // time. (dayjs.tz(iso, TZ) reads the clock digits as India time instead, which
  // moved every booking one day earlier.)
  const dayjsDate = dayjs(session.draft._pendingDate).tz(dateParser.TZ);
  let combined;
  if (answer.now) {
    // "Now": the exact current time (only offered for today).
    if (!dayjsDate.isSame(dateParser.now(), 'day')) {
      await promptTime(ctx);
      return;
    }
    combined = dateParser.now().add(1, 'minute').startOf('minute');
  } else {
    const time = answer.time;
    if (!time) {
      await promptTime(ctx);
      return;
    }
    combined = dateParser.combineDateTime(dayjsDate, time);
  }

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
  const rows = env.DATE_PICKER === 'text' ? [] : tapView(session, true, ctx.language).rows;
  const answer = readDateAnswer(message, rows);

  if (isTapNav(answer)) {
    await handleTapNav(ctx, answer, { returnTrip: true });
    return;
  }

  let date = answer.resolved || null;
  if (answer.move || answer.day) {
    date = await handleCalendarAnswer(ctx, answer, { returnTrip: true });
    if (!date) return;
  }
  const flowTimeId = answer.flowTimeId || null;

  if (!date) {
    await promptDate(ctx, { returnTrip: true });
    return;
  }

  const pickupDay = session.draft.pickupAt ? dayjs(session.draft.pickupAt).tz(dateParser.TZ).startOf('day') : null;
  if (date.isBefore(dateParser.now().startOf('day')) || (pickupDay && date.isBefore(pickupDay))) {
    await ctx.send.raw(tOr(ctx.language, 'return_before_pickup', 'The return date cannot be before your pickup date. Please choose again.'));
    await promptDate(ctx, { returnTrip: true });
    return;
  }

  session.draft._pendingReturnDate = date.toISOString();
  delete session.draft._returnCalMonth;
  delete session.draft._returnCalWeek;
  delete session.draft._returnTimePage;
  session.markModified('draft');
  await session.save();
  await transition(session, STATES.BOOKING_RETURN_TIME);
  if (flowTimeId) {
    await handleBookingReturnTime({ ...ctx, message: { interactiveId: flowTimeId } });
    return;
  }
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
    delete session.draft._returnCalMonth;
  delete session.draft._returnCalWeek;
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
      return {
        id: `CAT_${c}`,
        number: i + 1,
        label: tOr(language, `cab_category_${c}`, titleCase(c)),
        description: `${g.length} option${g.length > 1 ? 's' : ''}`,
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
    description: `${o.vehicleName} · ${o.seatingCapacity} seats`,
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
