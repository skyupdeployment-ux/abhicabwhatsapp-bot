/* eslint-disable no-console */
const { connectDB, disconnectDB } = require('../config/db');
const { syncFleet } = require('./fleet');

// Loads the ABHI CABS fleet and rates (see fleet.js) and switches off the older placeholder vehicles.
// The bot also does this by itself at start-up the first time, so running this by hand is only needed to reload the rates.
async function seed() {
  await connectDB();
  const { loaded, switchedOff } = await syncFleet();
  console.log(`Seeded ${loaded} vehicles. Switched off ${switchedOff} older vehicle(s).`);
  await disconnectDB();
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
