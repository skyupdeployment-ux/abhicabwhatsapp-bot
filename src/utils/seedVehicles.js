/* eslint-disable no-console */
const { connectDB, disconnectDB, getPrisma } = require('../config/db');

// The ABHI CABS fleet and rates, copied from the backend's Bengaluru rate card (vehicle catalogue + fare cards).
// One per-km rate covers one-way, round trip and airport (the backend uses the same rate for all three).
// baseFarePerHour is the backend's flexible hourly rate; Local trips are priced from rentalPackages.js when available.
// driverAllowancePerDay is the backend's driver allowance (bata). Airport trips are exempt (see fareService).
const VEHICLES = [
  { vehicleId: "swift-dzire", name: "Swift Dzire A/C", category: "SEDAN", seatingCapacity: 4, baseFarePerKm: 19, baseFarePerHour: 150, driverAllowancePerDay: 0 },
  { vehicleId: "swift-dzire-cng", name: "Swift Dzire A/C CNG", category: "SEDAN", seatingCapacity: 4, baseFarePerKm: 19, baseFarePerHour: 150, driverAllowancePerDay: 0 },
  { vehicleId: "ertiga", name: "Ertiga A/C", category: "SUV", seatingCapacity: 7, baseFarePerKm: 25, baseFarePerHour: 200, driverAllowancePerDay: 0 },
  { vehicleId: "innova", name: "Innova A/C", category: "SUV", seatingCapacity: 8, baseFarePerKm: 32, baseFarePerHour: 200, driverAllowancePerDay: 0 },
  { vehicleId: "innova-crysta", name: "Innova Crysta A/C", category: "PREMIUM", seatingCapacity: 8, baseFarePerKm: 35, baseFarePerHour: 250, driverAllowancePerDay: 0 },
  { vehicleId: "fortuner", name: "Toyota Fortuner", category: "LUXURY", seatingCapacity: 6, baseFarePerKm: 55, baseFarePerHour: 450, driverAllowancePerDay: 1000 },
  { vehicleId: "mercedes-e", name: "Mercedes-Benz E-Class", category: "LUXURY", seatingCapacity: 4, baseFarePerKm: 95, baseFarePerHour: 700, driverAllowancePerDay: 1000 },
  { vehicleId: "innova-hycross", name: "Innova Hycross A/C", category: "PREMIUM", seatingCapacity: 8, baseFarePerKm: 42, baseFarePerHour: 300, driverAllowancePerDay: 0 },
  { vehicleId: "tempo-12", name: "Tempo Traveller 12 A/C", category: "TEMPO_TRAVELLER", seatingCapacity: 12, baseFarePerKm: 41, baseFarePerHour: 250, driverAllowancePerDay: 0 },
  { vehicleId: "urbania-maharaja", name: "Urbania 1x1 Maharaja Luxury", category: "TEMPO_TRAVELLER", seatingCapacity: 12, baseFarePerKm: 60, baseFarePerHour: 400, driverAllowancePerDay: 0 },
  { vehicleId: "urbania-13", name: "Force Urbania 13 A/C", category: "TEMPO_TRAVELLER", seatingCapacity: 13, baseFarePerKm: 53, baseFarePerHour: 300, driverAllowancePerDay: 0 },
  { vehicleId: "urbania-16", name: "Force Urbania 16 A/C", category: "TEMPO_TRAVELLER", seatingCapacity: 16, baseFarePerKm: 60, baseFarePerHour: 350, driverAllowancePerDay: 0 },
  { vehicleId: "tempo-17", name: "Tempo Traveller 17 A/C", category: "TEMPO_TRAVELLER", seatingCapacity: 17, baseFarePerKm: 50, baseFarePerHour: 300, driverAllowancePerDay: 0 },
  { vehicleId: "benz-22", name: "Bharat Benz 22 Luxury", category: "BUS", seatingCapacity: 22, baseFarePerKm: 75, baseFarePerHour: 400, driverAllowancePerDay: 0 },
  { vehicleId: "benz-28", name: "Bharat Benz 28 Luxury", category: "BUS", seatingCapacity: 28, baseFarePerKm: 83, baseFarePerHour: 500, driverAllowancePerDay: 0 },
  { vehicleId: "benz-33", name: "Bharat Benz 33 Executive", category: "BUS", seatingCapacity: 33, baseFarePerKm: 87, baseFarePerHour: 500, driverAllowancePerDay: 0 },
];

const TRIP_TYPES = ['ONE_WAY', 'ROUND_TRIP', 'AIRPORT', 'HOURLY'];

async function seed() {
  await connectDB();
  const prisma = getPrisma();

  for (const v of VEHICLES) {
    const { vehicleId, ...rest } = v;
    // eslint-disable-next-line no-await-in-loop
    await prisma.vehicle.upsert({
      where: { vehicleId },
      update: { ...rest, ac: true, supportedTripTypes: TRIP_TYPES, active: true },
      create: { vehicleId, ...rest, ac: true, supportedTripTypes: TRIP_TYPES, active: true },
    });
  }

  // Any older vehicle that is not on this list (the earlier placeholder rates) is switched OFF, not deleted,
  // so past bookings that mention it are untouched and the customer no longer sees it.
  const off = await prisma.vehicle.updateMany({
    where: { vehicleId: { notIn: VEHICLES.map((v) => v.vehicleId) }, active: true },
    data: { active: false },
  });

  console.log(`Seeded ${VEHICLES.length} vehicles. Switched off ${off.count} older vehicle(s).`);
  await disconnectDB();
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});/* eslint-disable no-console */
const { connectDB, disconnectDB, getPrisma } = require('../config/db');

// The ABHI CABS fleet and rates, copied from the backend's Bengaluru rate card (vehicle catalogue + fare cards).
// One per-km rate covers one-way, round trip and airport (the backend uses the same rate for all three).
// baseFarePerHour is the backend's flexible hourly rate; Local trips are priced from rentalPackages.js when available.
// driverAllowancePerDay is the backend's driver allowance (bata). Airport trips are exempt (see fareService).
const VEHICLES = [
  { vehicleId: "swift-dzire", name: "Swift Dzire A/C", category: "SEDAN", seatingCapacity: 4, baseFarePerKm: 19, baseFarePerHour: 150, driverAllowancePerDay: 0 },
  { vehicleId: "swift-dzire-cng", name: "Swift Dzire A/C CNG", category: "SEDAN", seatingCapacity: 4, baseFarePerKm: 19, baseFarePerHour: 150, driverAllowancePerDay: 0 },
  { vehicleId: "ertiga", name: "Ertiga A/C", category: "SUV", seatingCapacity: 7, baseFarePerKm: 25, baseFarePerHour: 200, driverAllowancePerDay: 0 },
  { vehicleId: "innova", name: "Innova A/C", category: "SUV", seatingCapacity: 8, baseFarePerKm: 32, baseFarePerHour: 200, driverAllowancePerDay: 0 },
  { vehicleId: "innova-crysta", name: "Innova Crysta A/C", category: "PREMIUM", seatingCapacity: 8, baseFarePerKm: 35, baseFarePerHour: 250, driverAllowancePerDay: 0 },
  { vehicleId: "fortuner", name: "Toyota Fortuner", category: "LUXURY", seatingCapacity: 6, baseFarePerKm: 55, baseFarePerHour: 450, driverAllowancePerDay: 1000 },
  { vehicleId: "mercedes-e", name: "Mercedes-Benz E-Class", category: "LUXURY", seatingCapacity: 4, baseFarePerKm: 95, baseFarePerHour: 700, driverAllowancePerDay: 1000 },
  { vehicleId: "innova-hycross", name: "Innova Hycross A/C", category: "PREMIUM", seatingCapacity: 8, baseFarePerKm: 42, baseFarePerHour: 300, driverAllowancePerDay: 0 },
  { vehicleId: "tempo-12", name: "Tempo Traveller 12 A/C", category: "TEMPO_TRAVELLER", seatingCapacity: 12, baseFarePerKm: 41, baseFarePerHour: 250, driverAllowancePerDay: 0 },
  { vehicleId: "urbania-maharaja", name: "Urbania 1x1 Maharaja Luxury", category: "TEMPO_TRAVELLER", seatingCapacity: 12, baseFarePerKm: 60, baseFarePerHour: 400, driverAllowancePerDay: 0 },
  { vehicleId: "urbania-13", name: "Force Urbania 13 A/C", category: "TEMPO_TRAVELLER", seatingCapacity: 13, baseFarePerKm: 53, baseFarePerHour: 300, driverAllowancePerDay: 0 },
  { vehicleId: "urbania-16", name: "Force Urbania 16 A/C", category: "TEMPO_TRAVELLER", seatingCapacity: 16, baseFarePerKm: 60, baseFarePerHour: 350, driverAllowancePerDay: 0 },
  { vehicleId: "tempo-17", name: "Tempo Traveller 17 A/C", category: "TEMPO_TRAVELLER", seatingCapacity: 17, baseFarePerKm: 50, baseFarePerHour: 300, driverAllowancePerDay: 0 },
  { vehicleId: "benz-22", name: "Bharat Benz 22 Luxury", category: "BUS", seatingCapacity: 22, baseFarePerKm: 75, baseFarePerHour: 400, driverAllowancePerDay: 0 },
  { vehicleId: "benz-28", name: "Bharat Benz 28 Luxury", category: "BUS", seatingCapacity: 28, baseFarePerKm: 83, baseFarePerHour: 500, driverAllowancePerDay: 0 },
  { vehicleId: "benz-33", name: "Bharat Benz 33 Executive", category: "BUS", seatingCapacity: 33, baseFarePerKm: 87, baseFarePerHour: 500, driverAllowancePerDay: 0 },
];

const TRIP_TYPES = ['ONE_WAY', 'ROUND_TRIP', 'AIRPORT', 'HOURLY'];

async function seed() {
  await connectDB();
  const prisma = getPrisma();

  for (const v of VEHICLES) {
    const { vehicleId, ...rest } = v;
    // eslint-disable-next-line no-await-in-loop
    await prisma.vehicle.upsert({
      where: { vehicleId },
      update: { ...rest, ac: true, supportedTripTypes: TRIP_TYPES, active: true },
      create: { vehicleId, ...rest, ac: true, supportedTripTypes: TRIP_TYPES, active: true },
    });
  }

  // Any older vehicle that is not on this list (the earlier placeholder rates) is switched OFF, not deleted,
  // so past bookings that mention it are untouched and the customer no longer sees it.
  const off = await prisma.vehicle.updateMany({
    where: { vehicleId: { notIn: VEHICLES.map((v) => v.vehicleId) }, active: true },
    data: { active: false },
  });

  console.log(`Seeded ${VEHICLES.length} vehicles. Switched off ${off.count} older vehicle(s).`);
  await disconnectDB();
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
