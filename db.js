const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const MONGO_URI = process.env.MONGO_URL;
    if (!MONGO_URI) {
      throw new Error('MONGO_URL environment variable is missing or undefined. Please check Backend/.env file.');
    }
    await mongoose.connect(MONGO_URI);
  } catch (error) {
    process.exit(1);
  }
};

module.exports = connectDB;
