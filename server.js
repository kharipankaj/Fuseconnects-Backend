require('dotenv').config();

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

const connectDB = require('./db');

const GameEngine = require('./gameEngine');
const User = require('./models/User');
const { AviatorRound } = require('./models/Aviator-round');
const { Bet: AviatorBet } = require('./models/Aviator-bet');

const app = express();
const server = http.createServer(app);

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

// ✅ SOCKET
const io = new Server(server, {
  cors: {
    origin: FRONTEND_URL,
    credentials: true,
  },
  pingTimeout: 20000,
  pingInterval: 25000,
});

// ✅ PRODUCTION MIDDLEWARE
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const morgan = require('morgan');

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 req/user
  message: { success: false, message: 'Too many requests' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(compression());
app.use(morgan('combined'));
app.use(limiter);
app.use(helmet({
  contentSecurityPolicy: process.env.NODE_ENV === 'production' ? {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      scriptSrc: ["'self'"],
    },
  } : undefined,
}));
app.use(cors({ 
  origin: FRONTEND_URL, 
  credentials: true,
  optionsSuccessStatus: 200 
}));
app.use(express.json({ limit: '50kb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser(process.env.NODE_ENV === 'production' ? { secure: true } : undefined));

// ✅ SANITIZATION + PROD SEC
app.use((req, res, next) => {
  if (req.body) {
    for (let key in req.body) {
      if (typeof req.body[key] === 'string') {
        req.body[key] = req.body[key].trim().substring(0, 1000);
      }
    }
  }
  next();
});

// ✅ ENV CHECK
const requiredEnv = ['JWT_SECRET', 'REFRESH_TOKEN_SECRET', 'MONGO_URL'];
const missingEnv = requiredEnv.filter(env => !process.env[env]);

if (missingEnv.length > 0) {
  console.error('Missing env vars:', missingEnv);
  console.log('Create Backend/.env with all vars');
  process.exit(1);
}

// ✅ GAME ENGINE
let engine;

function startGame() {
  engine = new GameEngine(io, User, AviatorRound, AviatorBet);
  engine.start();
}

// ✅ SOCKET AUTH MIDDLEWARE - ENHANCED DEBUG LOGGING
io.use((socket, next) => {
  console.log('🔌 Socket connect attempt:', socket.id?.slice(0,8));
  
  try {
    let token = socket.handshake.auth?.token;
    console.log('🔌 Token source:', token ? 'auth.token' : 'checking cookies');

    if (!token && socket.handshake.headers['cookie']) {
      const cookies = socket.handshake.headers['cookie'].split(';');
      const match = cookies.find(c => c.trim().startsWith('accessToken='));
      if (match) {
        token = decodeURIComponent(match.split('=')[1]);
        console.log('🔌 Token extracted from cookie');
      } else {
        console.log('🔌 No accessToken cookie found');
      }
    }

    // 🔌 HMR BYPASS FULLY DISABLED FOR AUTH DEBUG
    // Re-enable only after socket auth working:
    /*
    const isHMR = socket.handshake.headers['next-router-prefetch'] !== undefined;
    if (isHMR) {
      console.log('🔌 HMR bypass - no auth required');
      socket.user = null;
      return next();
    }
    */


    if (!token) {
      console.log('❌ No token provided');
      return next(new Error('No token provided'));
    }

    if ((token.match(/\./g) || []).length !== 2) {
      console.log('❌ Invalid JWT format, dots:', (token.match(/\./g) || []).length);
      return next(new Error('Invalid token format'));
    }

    console.log('🔐 Verifying token (preview:', token.slice(0,20) + '...', ')');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.user = {
      userId: decoded.id || decoded.userId,
      username: decoded.username,
      role: decoded.role || 'user',
    };
    
    console.log('✅ Socket auth SUCCESS:', socket.user.username, socket.user.userId?.slice(-4));

    next();

  } catch (err) {
    console.error('❌ Socket auth FAILED:', err.message);
    console.error('   Token preview:', token ? token.slice(0,20) + '...' : 'MISSING');
    console.error('   Full error:', err.toString());
    socket.user = null;
    next(new Error('Authentication failed'));
  }
});

// ✅ SOCKET EVENTS
io.on('connection', (socket) => {
  socket.emit('user:connected', socket.user);

  if (engine) {
    socket.emit('game:state', engine.getState());
  }

  socket.on('bet:place', async (data, cb) => {
    if (!engine) {
      return cb?.({ success: false, message: 'Game not ready' });
    }

    if (!socket.user) {
      return cb?.({ success: false, message: 'Not authenticated' });
    }

    const result = await engine.placeBet(socket, data);
    cb?.(result);
  });

  socket.on('bet:cashout', async (data, cb) => {
    if (!engine) {
      return cb?.({ success: false, message: 'Game not ready' });
    }

    if (!socket.user) {
      return cb?.({ success: false, message: 'Not authenticated' });
    }

    const result = await engine.cashOut(socket, data);
    cb?.(result);
  });

  socket.on('disconnect', () => {});
});

// ✅ ROUTES
app.get('/', (req, res) => {
  res.json({ message: 'Server running 🚀' });
});

app.use('/refresh', require('./routes/refresh'));
app.use('/signup', require('./routes/signup'));
app.use('/profile', require('./routes/profile'));
app.use('/login', require('./routes/login'));
app.use('/aviator', require('./routes/aviator'));
app.use('/logout', require('./routes/logout'));

// ✅ 404
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Not found' });
});

// ✅ ERROR
app.use((err, req, res, next) => {
  res.status(500).json({ success: false, message: 'Server error' });
});

// ✅ START SERVER
const startServer = async () => {
  try {
    await connectDB();
    startGame();

    const PORT = process.env.PORT || 5000;
    server.listen(PORT);

  } catch (err) {
    process.exit(1);
  }

};

startServer();