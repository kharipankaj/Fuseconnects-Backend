
require("dotenv").config();
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const User = require("./models/User");

const JWT_SECRET = process.env.JWT_SECRET;
const MONGO_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/fuseconnects";

console.log("\n🔍 AUTH DEBUG SCRIPT\n");
console.log("=" .repeat(60));

console.log("\n✅ Environment Variables Check:");
console.log(`   JWT_SECRET: ${JWT_SECRET ? "✓ SET" : "❌ MISSING"}`);
console.log(`   JWT_SECRET length: ${JWT_SECRET ? JWT_SECRET.length : 0} chars`);
console.log(`   MONGODB_URI: ${MONGO_URI ? "✓ SET" : "❌ MISSING"}`);
console.log(`   NODE_ENV: ${process.env.NODE_ENV || "development"}`);

if (JWT_SECRET) {
  if (JWT_SECRET.length < 32) {
    console.log("\n⚠️  WARNING: JWT_SECRET is too short (< 32 chars)");
    console.log("   For production, use minimum 32 characters");
  } else {
    console.log(`\n✓ JWT_SECRET length is good: ${JWT_SECRET.length} chars`);
  }
}

(async () => {
  try {
    console.log("\n🔌 Connecting to MongoDB...");
    await mongoose.connect(MONGO_URI);
    console.log("✓ Connected to MongoDB");

    console.log("\n📋 Users in Database:");
    console.log("-" .repeat(60));
    
    const users = await User.find().select('username role email').lean();
    
    if (users.length === 0) {
      console.log("❌ No users found in database");
    } else {
      console.log(`Found ${users.length} user(s):\n`);
      users.forEach((user, idx) => {
        const roleColor = user.role === 'admin' ? '✓' : 
                         user.role === 'moderator' ? '◆' : '○';
        console.log(`  ${idx + 1}. ${roleColor} ${user.username}`);
        console.log(`     Role: ${user.role}`);
        console.log(`     Email: ${user.email}`);
        console.log();
      });
    }

    if (JWT_SECRET && users.length > 0) {
      console.log("\n🎫 JWT Token Test:");
      console.log("-" .repeat(60));
      
      const testUser = users[0];
      console.log(`Using test user: ${testUser.username} (role: ${testUser.role})`);
      
      try {
        const token = jwt.sign(
          {
            id: testUser._id,
            username: testUser.username,
            role: testUser.role,
            type: "access",
          },
          JWT_SECRET,
          { expiresIn: "15m" }
        );
        
        console.log(`\n✓ Token created successfully`);
        console.log(`  Length: ${token.length} chars`);
        console.log(`  Preview: ${token.substring(0, 20)}...${token.substring(token.length - 10)}`);
        
        const decoded = jwt.verify(token, JWT_SECRET);
        console.log(`\n✓ Token verified successfully`);
        console.log(`  Decoded payload:`);
        console.log(`    - id: ${decoded.id}`);
        console.log(`    - username: ${decoded.username}`);
        console.log(`    - role: ${decoded.role}`);
        console.log(`    - type: ${decoded.type}`);
        console.log(`    - iat: ${new Date(decoded.iat * 1000).toISOString()}`);
        console.log(`    - exp: ${new Date(decoded.exp * 1000).toISOString()}`);
        
      } catch (err) {
        console.log(`❌ JWT Error: ${err.message}`);
      }
    }

    console.log("\n🔐 Auth Middleware Simulation:");
    console.log("-" .repeat(60));
    
    if (JWT_SECRET && users.length > 0) {
      const testUser = users[0];
      const token = jwt.sign(
        {
          id: testUser._id,
          username: testUser.username,
          role: testUser.role,
          type: "access",
        },
        JWT_SECRET,
        { expiresIn: "15m" }
      );
      
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        
        // Simulate auth middleware
        if (decoded.type !== "access") {
          console.log("❌ Token type check FAILED");
        } else {
          console.log("✓ Token type check passed");
        }
        
        // Fetch user from DB
        const dbUser = await User.findById(decoded.id).select('role username');
        if (!dbUser) {
          console.log("❌ User NOT found in database");
        } else {
          console.log("✓ User found in database");
          console.log(`  Username: ${dbUser.username}`);
          console.log(`  Role: ${dbUser.role}`);
        }
        
        // Final req.user object
        const simulatedReqUser = {
          id: decoded.id,
          username: dbUser.username,
          role: dbUser.role
        };
        
        console.log(`\n✓ Final req.user object:`);
        console.log(`  ${JSON.stringify(simulatedReqUser, null, 2)}`);
        
        // Check moderator access
        const allowedRoles = ["admin", "moderator"];
        if (allowedRoles.includes(simulatedReqUser.role)) {
          console.log(`\n✅ ${simulatedReqUser.role.toUpperCase()} - Can access /moderation`);
        } else {
          console.log(`\n❌ USER - Cannot access /moderation`);
          console.log(`   Current role: "${simulatedReqUser.role}"`);
          console.log(`   Allowed roles: ${allowedRoles.join(', ')}`);
          console.log(`   To fix: Update role to "moderator" or "admin"`);
        }
        
      } catch (err) {
        console.log(`❌ Middleware simulation error: ${err.message}`);
      }
    }

    // Check 7: Recommendations
    console.log("\n💡 Recommendations:");
    console.log("-" .repeat(60));
    
    const adminUsers = users.filter(u => u.role === 'admin');
    const modUsers = users.filter(u => u.role === 'moderator');
    
    if (adminUsers.length === 0) {
      console.log("⚠️  No admin users found!");
      console.log("   To create first admin, run in mongosh:");
      console.log(`   db.users.updateOne({ username: "your_username" }, { $set: { role: "admin" } })`);
    } else {
      console.log(`✓ Found ${adminUsers.length} admin user(s)`);
    }
    
    if (modUsers.length === 0) {
      console.log("⚠️  No moderator users found");
      console.log("   To create moderator, use: POST /moderation/assign-role (admin-only)");
    } else {
      console.log(`✓ Found ${modUsers.length} moderator user(s)`);
    }

  } catch (err) {
    console.error("\n❌ ERROR:", err.message);
    if (err.message.includes("connect")) {
      console.log("\n🔌 MongoDB Connection Failed");
      console.log("   Make sure MongoDB is running:");
      console.log("   - Local: mongod");
      console.log("   - Atlas: Check connection string in .env");
    }
  } finally {
    await mongoose.disconnect();
    console.log("\n" + "=".repeat(60));
    console.log("Debug script completed\n");
    process.exit(0);
  }
})();
