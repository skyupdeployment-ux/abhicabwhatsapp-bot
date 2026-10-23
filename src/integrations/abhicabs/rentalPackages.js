/**
 * Fixed local-rental packages, copied from the ABHI CABS backend rate card (Bengaluru).
 * A "Local" (hourly) booking is priced from the smallest package that covers the hours asked; beyond 12 hours the
 * 12-hour package plus the extra-hour rate. Kilometres over the package are not tracked in the bot, so extra km are not charged here.
 */
const PACKAGES = {
  "swift-dzire": [
    { hours: 4, km: 40, fare: 840, extraPerHour: 150, extraPerKm: 14 },
    { hours: 8, km: 80, fare: 2000, extraPerHour: 150, extraPerKm: 14 },
    { hours: 12, km: 120, fare: 3160, extraPerHour: 150, extraPerKm: 14 },
  ],
  "swift-dzire-cng": [
    { hours: 4, km: 40, fare: 840, extraPerHour: 150, extraPerKm: 14 },
    { hours: 8, km: 80, fare: 2000, extraPerHour: 150, extraPerKm: 14 },
    { hours: 12, km: 120, fare: 3160, extraPerHour: 150, extraPerKm: 14 },
  ],
  "ertiga": [
    { hours: 4, km: 40, fare: 980, extraPerHour: 200, extraPerKm: 18 },
    { hours: 8, km: 80, fare: 2500, extraPerHour: 200, extraPerKm: 18 },
    { hours: 12, km: 120, fare: 4020, extraPerHour: 200, extraPerKm: 18 },
  ],
  "innova": [
    { hours: 4, km: 40, fare: 980, extraPerHour: 200, extraPerKm: 18 },
    { hours: 8, km: 80, fare: 2500, extraPerHour: 200, extraPerKm: 18 },
    { hours: 12, km: 120, fare: 4020, extraPerHour: 200, extraPerKm: 18 },
  ],
  "innova-crysta": [
    { hours: 4, km: 40, fare: 1200, extraPerHour: 250, extraPerKm: 20 },
    { hours: 8, km: 80, fare: 3000, extraPerHour: 250, extraPerKm: 20 },
    { hours: 12, km: 120, fare: 4800, extraPerHour: 250, extraPerKm: 20 },
  ],
  "fortuner": [
    { hours: 4, km: 40, fare: 2600, extraPerHour: 450, extraPerKm: 55 },
    { hours: 8, km: 80, fare: 6000, extraPerHour: 450, extraPerKm: 55 },
    { hours: 12, km: 120, fare: 9400, extraPerHour: 450, extraPerKm: 55 },
  ],
  "mercedes-e": [
    { hours: 4, km: 40, fare: 4400, extraPerHour: 700, extraPerKm: 95 },
    { hours: 8, km: 80, fare: 11000, extraPerHour: 700, extraPerKm: 95 },
    { hours: 12, km: 120, fare: 17600, extraPerHour: 700, extraPerKm: 95 },
  ],
  "innova-hycross": [
    { hours: 4, km: 40, fare: 1300, extraPerHour: 300, extraPerKm: 25 },
    { hours: 8, km: 80, fare: 3500, extraPerHour: 300, extraPerKm: 25 },
    { hours: 12, km: 120, fare: 5700, extraPerHour: 300, extraPerKm: 25 },
  ],
  "tempo-12": [
    { hours: 4, km: 40, fare: 1920, extraPerHour: 250, extraPerKm: 27 },
    { hours: 8, km: 80, fare: 4000, extraPerHour: 250, extraPerKm: 27 },
    { hours: 12, km: 120, fare: 6080, extraPerHour: 250, extraPerKm: 27 },
  ],
  "urbania-maharaja": [
    { hours: 4, km: 40, fare: 4800, extraPerHour: 400, extraPerKm: 40 },
    { hours: 8, km: 80, fare: 8000, extraPerHour: 400, extraPerKm: 40 },
    { hours: 12, km: 120, fare: 11200, extraPerHour: 400, extraPerKm: 40 },
  ],
  "urbania-13": [
    { hours: 4, km: 40, fare: 4400, extraPerHour: 300, extraPerKm: 35 },
    { hours: 8, km: 80, fare: 7000, extraPerHour: 300, extraPerKm: 35 },
    { hours: 12, km: 120, fare: 9600, extraPerHour: 300, extraPerKm: 35 },
  ],
  "urbania-16": [
    { hours: 4, km: 40, fare: 4500, extraPerHour: 350, extraPerKm: 40 },
    { hours: 8, km: 80, fare: 7500, extraPerHour: 350, extraPerKm: 40 },
    { hours: 12, km: 120, fare: 10500, extraPerHour: 350, extraPerKm: 40 },
  ],
  "tempo-17": [
    { hours: 4, km: 40, fare: 2280, extraPerHour: 300, extraPerKm: 33 },
    { hours: 8, km: 80, fare: 4800, extraPerHour: 300, extraPerKm: 33 },
    { hours: 12, km: 120, fare: 7320, extraPerHour: 300, extraPerKm: 33 },
  ],
  "benz-22": [
    { hours: 4, km: 40, fare: 3800, extraPerHour: 400, extraPerKm: 50 },
    { hours: 8, km: 80, fare: 7400, extraPerHour: 400, extraPerKm: 50 },
    { hours: 12, km: 120, fare: 11000, extraPerHour: 400, extraPerKm: 50 },
  ],
  "benz-28": [
    { hours: 4, km: 40, fare: 3300, extraPerHour: 500, extraPerKm: 55 },
    { hours: 8, km: 80, fare: 7500, extraPerHour: 500, extraPerKm: 55 },
    { hours: 12, km: 120, fare: 11700, extraPerHour: 500, extraPerKm: 55 },
  ],
  "benz-33": [
    { hours: 4, km: 40, fare: 3680, extraPerHour: 500, extraPerKm: 58 },
    { hours: 8, km: 80, fare: 8000, extraPerHour: 500, extraPerKm: 58 },
    { hours: 12, km: 120, fare: 12320, extraPerHour: 500, extraPerKm: 58 },
  ],
};

/** { fare, package, extraHours } for this vehicle and number of hours, or null when the vehicle has no packages. */
function packageFare(vehicleId, hours, listOverride) {
  // listOverride: the vehicle's packages read from the website tables (when RATES_SOURCE=website). An empty list means none.
  const list = Array.isArray(listOverride) ? listOverride : PACKAGES[vehicleId];
  if (!list || list.length === 0) return null;
  const sorted = [...list].sort((a, b) => a.hours - b.hours);
  const h = Math.max(1, Math.ceil(Number(hours) || 0));
  const fit = sorted.find((p) => h <= p.hours);
  if (fit) return { fare: fit.fare, package: fit, extraHours: 0 };
  const last = sorted[sorted.length - 1];
  const extraHours = h - last.hours;
  return { fare: last.fare + extraHours * last.extraPerHour, package: last, extraHours };
}

module.exports = { PACKAGES, packageFare };
