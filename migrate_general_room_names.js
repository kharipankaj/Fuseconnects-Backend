require("dotenv").config();
const mongoose = require("mongoose");
const GeneralRoom = require("./models/GeneralRoom");

function formatCityRoomName(city) {
  if (!city) return "Global";
  return city
    .toString()
    .trim()
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

async function run() {
  const mongoUrl = process.env.MONGO_URL;
  if (!mongoUrl) {
    throw new Error("MONGO_URL is missing in environment");
  }

  await mongoose.connect(mongoUrl);
  console.log("Connected to MongoDB");

  const rooms = await GeneralRoom.find({}).lean();
  let updated = 0;

  for (const room of rooms) {
    const nextName = formatCityRoomName(room.city);
    if (room.name === nextName) continue;

    await GeneralRoom.updateOne(
      { _id: room._id },
      { $set: { name: nextName } }
    );
    updated += 1;
  }

  console.log(`General rooms scanned: ${rooms.length}`);
  console.log(`General rooms updated: ${updated}`);

  await mongoose.disconnect();
  console.log("Migration completed");
}

run().catch(async (err) => {
  console.error("Migration failed:", err.message);
  try {
    await mongoose.disconnect();
  } catch (_) {}
  process.exit(1);
});
