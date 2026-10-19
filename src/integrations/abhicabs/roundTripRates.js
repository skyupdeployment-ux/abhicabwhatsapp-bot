/**
 * Round-trip rate per km, for vehicles where it is DIFFERENT from the one-way rate.
 *
 * In the ABHI CABS backend a round trip carries the same per-km rate as a one-way for every vehicle, but its own notes say
 * the client wants round trips to be cheaper per km: the one example given was Swift Dzire, Rs 19 one-way and Rs 12 round
 * trip. The other vehicles were never agreed. Nothing is changed here until you fill a number in, so prices stay as they are.
 *
 * To switch one on, remove the // in front of its line and write the agreed rate. The vehicle list and the booking
 * summary then show that rate for round trips. Example:  'swift-dzire': 12,
 */
const ROUND_TRIP_PER_KM = {
  // 'swift-dzire': 12, // the client's stated example (one-way 19): confirm before switching on
  // 'swift-dzire-cng': 12,
  // 'ertiga': 25,
  // 'innova': 32,
  // 'innova-crysta': 35,
  // 'innova-hycross': 42,
  // 'fortuner': 55,
  // 'mercedes-e': 95,
  // 'tempo-12': 41,
  // 'tempo-17': 50,
  // 'urbania-13': 53,
  // 'urbania-16': 60,
  // 'urbania-maharaja': 60,
  // 'benz-22': 75,
  // 'benz-28': 83,
  // 'benz-33': 87,
};

/** The round-trip rate for a vehicle: the one written above, or the normal per-km rate. */
function roundTripRate(vehicleId, normalRate) {
  const r = ROUND_TRIP_PER_KM[vehicleId];
  return Number.isFinite(r) ? r : normalRate;
}

module.exports = { ROUND_TRIP_PER_KM, roundTripRate };
