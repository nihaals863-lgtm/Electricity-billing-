const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const dotenv = require('dotenv');

// 💡 Load env FIRST
dotenv.config();

const modbusEngine = require('./services/modbusEngine');
const authRoutes = require('./routes/auth.routes');
const consumerRoutes = require('./routes/consumer.routes');
const billRoutes = require('./routes/bill.routes');
const paymentRoutes = require('./routes/payment.routes');
const complaintRoutes = require('./routes/complaint.routes');
const settingRoutes = require('./routes/setting.routes');
const operatorRoutes = require('./routes/operator.routes');
const notificationRoutes = require('./routes/notification.routes');
const meterRoutes = require('./routes/meter.routes');
const reportRoutes = require('./routes/report.routes');

const app = express();
const server = http.createServer(app);

// ======================================================
// ✅ CORS CONFIG (FIXED FOR PRODUCTION + RAILWAY)
// ======================================================

const FRONTEND_URLS = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
  'http://127.0.0.1:5173',
  'https://electricity-billing.kiaantechnology.com',
  'https://electricity-billing-production.up.railway.app',
  'https://electricity-billing-production-4c58.up.railway.app'
];
{/*
  app.use(cors({
  origin: function (origin, callback) {
    // 1. Allow Request with no origin (like Postman or mobile apps)
    if (!origin) return callback(null, true);

    // 2. Exact match check
    if (FRONTEND_URLS.includes(origin)) {
      return callback(null, true);
    }

    // 3. Pattern match check for localhost and Railway
    const isLocal = origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1');
    const isRailway = origin.endsWith('.railway.app');

    if (isLocal || isRailway) {
      return callback(null, true);
    }

    // 4. Fallback: Block unknown origins
    console.error("❌ CORS ERROR: Request from origin", origin, "is blocked.");
    return callback(new Error("Not allowed by CORS"), false);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept", "Origin"]
}));
  */}

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);

    if (
      origin.includes("localhost") ||
      origin.includes("127.0.0.1") ||
      origin.includes("railway.app") ||
      origin.includes("kiaantechnology.com")
    ) {
      return callback(null, true);
    }

    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true
}));


// ✅ VERY IMPORTANT (Preflight fix)
app.options('*', cors());

// ======================================================
// ✅ MIDDLEWARE
// ======================================================

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Debug logger
app.use((req, res, next) => {
  console.log(`🌐 ${req.method} ${req.originalUrl} | Origin: ${req.headers.origin}`);
  next();
});

// ======================================================
// ✅ HEALTH ROUTES (Railway ke liye important)
// ======================================================

app.get('/', (req, res) => {
  res.status(200).send('PowerBill API Running 🚀');
});

app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// ======================================================
// ✅ API ROUTES
// ======================================================

const apiRouter = express.Router();

apiRouter.use('/auth', authRoutes);
apiRouter.use('/consumers', consumerRoutes);
apiRouter.use('/bills', billRoutes);
apiRouter.use('/payments', paymentRoutes);
apiRouter.use('/complaints', complaintRoutes);
apiRouter.use('/settings', settingRoutes);
apiRouter.use('/operator', operatorRoutes);
apiRouter.use('/notifications', notificationRoutes);
apiRouter.use('/meters', meterRoutes);
apiRouter.use('/reports', reportRoutes);

app.use('/api', apiRouter);

console.log('✅ API routes loaded');

// ======================================================
// ✅ SOCKET.IO
// ======================================================

const io = new Server(server, {
  cors: {
    origin: FRONTEND_URLS,
    methods: ["GET", "POST"],
    credentials: true
  }
});

io.on('connection', (socket) => {
  console.log('🔌 Socket connected:', socket.id);

  socket.on('disconnect', () => {
    console.log('❌ Socket disconnected:', socket.id);
  });
});

// ======================================================
// ✅ ERROR HANDLER
// ======================================================

app.use((err, req, res, next) => {
  console.error('💥 ERROR:', err.message);

  res.status(500).json({
    success: false,
    message: err.message || 'Internal Server Error'
  });
});

// ======================================================
// ❗ 404 HANDLER (LAST)
// ======================================================

app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.originalUrl}`
  });
});

// ======================================================
// ✅ START SERVER
// ======================================================

const PORT = process.env.PORT || 5000;

server.listen(PORT, '0.0.0.0', async () => {
  console.log(`🚀 Server running on port ${PORT}`);

  try {
    await modbusEngine.init(io);
    console.log('⚡ Modbus initialized');
  } catch (err) {
    console.log('❌ Modbus failed:', err.message);
  }
});