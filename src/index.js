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
// ✅ 1. CORS CONFIGURATION
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

app.use(cors({
  origin: function (origin, callback) {
    // allow requests with no origin (like Postman)
    if (!origin) return callback(null, true);

    const isAllowed = FRONTEND_URLS.includes(origin) || 
                     origin.startsWith('http://localhost') || 
                     origin.startsWith('http://127.0.0.1') || 
                     origin.endsWith('.railway.app');

    if (isAllowed) {
      callback(null, true);
    } else {
      console.error("❌ CORS ERROR: Blocked origin:", origin);
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept", "Origin"]
}));

// ✅ 2. PREFLIGHT & EXTRA SAFETY HEADERS
app.options('*', cors());

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && (FRONTEND_URLS.includes(origin) || origin.startsWith('http://localhost') || origin.endsWith('.railway.app'))) {
    res.header("Access-Control-Allow-Origin", origin);
  }
  res.header("Access-Control-Allow-Credentials", "true");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, PATCH");
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// ======================================================
// ✅ 3. MIDDLEWARE
// ======================================================

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Debug logger
app.use((req, res, next) => {
  console.log(`🌐 ${req.method} ${req.originalUrl} | Origin: ${req.headers.origin}`);
  next();
});

// Health Checks
app.get('/', (req, res) => res.status(200).send('PowerBill API Running 🚀'));
app.get('/health', (req, res) => res.status(200).send('OK'));

// ======================================================
// ✅ 4. API ROUTES
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

// ======================================================
// ✅ 5. SOCKET.IO
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
  socket.on('disconnect', () => console.log('❌ Socket disconnected:', socket.id));
});

// ======================================================
// ✅ 6. ERROR HANDLING
// ======================================================

app.use((err, req, res, next) => {
  console.error('💥 ERROR:', err.message);
  res.status(500).json({ success: false, message: err.message || 'Internal Server Error' });
});

app.use('*', (req, res) => {
  res.status(404).json({ success: false, message: `Route not found: ${req.originalUrl}` });
});

// ======================================================
// ✅ 7. START SERVER
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
