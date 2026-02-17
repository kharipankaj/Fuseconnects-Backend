require("dotenv").config();
const express = require("express");
const cors = require("cors");
const compression = require("compression");
const bodyParser = require("body-parser");
const cookieParser = require("cookie-parser");
const { createServer } = require("http");
const { Server } = require("socket.io");
const cron = require("node-cron");
const jwt = require("jsonwebtoken");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const connectDB = require("./db");
const auth = require("./middleware/auth");
const Room = require("./models/Room");
const User = require("./models/User");
// Socket handlers (general + user rooms, Redis-ready)
const setupSocketHandlers = require("./sockets");

const app = express();
const httpServer = createServer(app);
const PORT = process.env.PORT;

app.use(helmet());
app.use(compression());
app.use(cookieParser());
app.use(bodyParser.json());

if (process.env.NODE_ENV !== "production") {
  app.use(
    morgan("tiny", {
      skip: function (req, res) {
        return req.method === "GET";
      },
    })
  );

}

app.use(rateLimit({ windowMs: 60 * 1000, max: 100 }));

const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:3001",
  "https://fuseconnects.in",
  "https://www.fuseconnects.in",
  (process.env.FRONTEND_URL || "").trim(),
];
const vercelRegex = /^https:\/\/[\w-]+\.vercel\.app$/;

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin) || vercelRegex.test(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  })
);

app.get("/", (req, res) => {
  res.send("Backend is running 🚀")
})


app.use("/userinfo", require("./routes/signup"));
app.use("/anonhub", require("./routes/anonhub"));
app.use("/login", require("./routes/login"));
app.use("/forgotpassword", require("./routes/forgotpassword"));
app.use("/refresh", require("./routes/refresh"));
app.use("/home", require("./routes/home"));
app.use("/profile", auth, require("./routes/profile"));
app.use("/posts", auth, require("./routes/posts"));
app.use("/photos", auth, require("./routes/photo"));
app.use("/sparks", auth, require("./routes/sparks"));
app.use("/upload", auth, require("./routes/upload"));
app.use("/story", auth, require("./routes/story"));
app.use("/highlight", auth, require("./routes/highlight"));
app.use("/search", require("./routes/search"));
app.use("/feed", auth, require("./routes/feed"));
app.use("/user", require("./routes/userProfile"));
app.use("/follow", require("./routes/follow"));
app.use("/logout", require("./routes/logout"));
app.use("/stories", auth, require("./routes/uploadstory"));
app.use("/referral", require("./routes/referral"));
app.use("/notifications", auth, require("./routes/notifications"));
app.use("/admin", auth, require("./routes/admin"));
app.use("/rooms", require("./routes/room"));
app.use("/moderation", require("./routes/moderation"));
app.use("/managestaff", require("./routes/managestaff"));
app.use("/roomaddmember", require("./routes/joinroom"));

const io = new Server(httpServer, {
  cors: {
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin) || vercelRegex.test(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  },
});

const attachAll = setupSocketHandlers(io);

io.use(require("./middleware/socketAuth"));

io.on("connection", async (socket) => {
  console.log("🔌 User connected:", socket.id);

  try {
    await attachAll(socket);
  } catch (err) {
    console.error("Error attaching socket handlers:", err);
  }

  socket.on("disconnect", () => {
    console.log("❌ User disconnected:", socket.id);
  });
});





connectDB()
  .then(() => {
    httpServer.listen(PORT, () => {
      console.log(`✅ Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("❌ DB connection failed:", err);
  });

process.on("SIGINT", () => {
  io.close(() => {
    process.exit(0);
  });
});

module.exports = { app, io };

// fuseconnects
