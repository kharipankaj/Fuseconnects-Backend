#!/usr/bin/env node

/**
 * Quick Setup Script
 * Creates first admin user in database
 * Run: node Backend/setup-admin.js
 */

require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("./models/User");

const MONGO_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/fuseconnects";

console.log("\n🚀 ADMIN SETUP SCRIPT\n");
console.log("=".repeat(60));

(async () => {
  try {
    console.log("\n🔌 Connecting to MongoDB...");
    await mongoose.connect(MONGO_URI);
    console.log("✓ Connected");

    // Check if admin already exists
    const existingAdmin = await User.findOne({ role: "admin" });
    if (existingAdmin) {
      console.log("\n✅ Admin already exists!");
      console.log(`   Username: ${existingAdmin.username}`);
      console.log(`   Email: ${existingAdmin.email}`);
      console.log(`   Role: ${existingAdmin.role}`);
      console.log("\nNo changes needed.");
      await mongoose.disconnect();
      process.exit(0);
    }

    // Check if any users exist
    const userCount = await User.countDocuments();
    if (userCount === 0) {
      console.log("\n❌ No users in database!");
      console.log("\nYou must create a user first by:");
      console.log("1. Sign up via frontend: http://localhost:3000");
      console.log("2. Or run this script after signup\n");
      await mongoose.disconnect();
      process.exit(1);
    }

    // List all users
    console.log(`\n📋 Found ${userCount} user(s) in database:`);
    const users = await User.find().select('username email role').lean();
    users.forEach((user, idx) => {
      console.log(`  ${idx + 1}. ${user.username} (${user.role})`);
    });

    // Prompt for which user to promote
    console.log("\n" + "=".repeat(60));
    console.log("\n❓ To make a user admin, update directly:\n");
    console.log("mongosh");
    console.log("use fuseconnects");
    console.log("db.users.updateOne(");
    console.log('  { username: "your_username" },');
    console.log('  { $set: { role: "admin" } }');
    console.log(")");
    console.log("\nThen run this script again to verify.");

  } catch (err) {
    console.error("\n❌ Error:", err.message);
    if (err.message.includes("connect")) {
      console.log("\nMake sure MongoDB is running:");
      console.log("- Local: mongod");
      console.log("- Atlas: Check MONGODB_URI in .env");
    }
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
})();
