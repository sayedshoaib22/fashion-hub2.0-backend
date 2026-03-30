import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import Razorpay from 'razorpay';
import crypto from 'crypto';

dotenv.config();

// Validate environment variables
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID?.trim();
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET?.trim();

if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
  console.error('❌ Missing required environment variables:');
  console.error('   - RAZORPAY_KEY_ID:', RAZORPAY_KEY_ID ? '✅ Set' : '❌ Missing');
  console.error('   - RAZORPAY_KEY_SECRET:', RAZORPAY_KEY_SECRET ? '✅ Set' : '❌ Missing');
  console.error('Please check your .env file or Railway environment variables');
  process.exit(1);
}

console.log('✅ Environment variables loaded successfully');
console.log('🔑 Razorpay Key ID:', RAZORPAY_KEY_ID.substring(0, 10) + '...');

const razorpay = new Razorpay({
  key_id: RAZORPAY_KEY_ID,
  key_secret: RAZORPAY_KEY_SECRET,
});

const app = express();
const PORT = process.env.PORT || 3000;

// ── CORS ──────────────────────────────────────────────────────────────────────
// Add every origin that should be allowed to call this backend.
// GitHub Pages serves at https://sayedshoaib22.github.io — this MUST be here.
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5500',
  'http://localhost:5501',
  'http://localhost:5502',           // VS Code Live Server default port in your project
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5500',
  'http://127.0.0.1:5501',
  'http://127.0.0.1:5502',
  'https://sayedshoaib22.github.io', // ← your GitHub Pages frontend
  'https://royal-goa-ride-backend-production.up.railway.app',
];

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, curl, Postman, etc.)
    if (!origin) return callback(null, true);

    // Always allow whitelisted origins regardless of NODE_ENV
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    // In non-production, also allow any railway.app preview domain
    if (process.env.NODE_ENV !== 'production') {
      if (origin.includes('railway.app') || origin.includes('localhost') || origin.includes('127.0.0.1')) {
        return callback(null, true);
      }
    }

    console.warn('🚫 CORS blocked origin:', origin);
    callback(new Error(`Origin ${origin} not allowed by CORS`), false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));

// ── HEALTH CHECK ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
  });
});

// ── RAZORPAY CONFIG ───────────────────────────────────────────────────────────
app.get('/api/config', (req, res) => {
  console.log('📡 Config request from origin:', req.headers.origin || req.ip);
  try {
    res.json({
      razorpayKeyId: RAZORPAY_KEY_ID,
      success: true,
    });
  } catch (error) {
    console.error('❌ Config endpoint error:', error);
    res.status(500).json({ error: 'Configuration error', success: false });
  }
});

// ── CREATE RAZORPAY ORDER ─────────────────────────────────────────────────────
app.post('/api/create-order', async (req, res) => {
  console.log('💳 Order creation request from origin:', req.headers.origin || req.ip);

  try {
    const { amount, currency = 'INR' } = req.body;

    if (!amount || typeof amount !== 'number' || amount <= 0 || amount > 100000) {
      console.error('❌ Invalid amount:', amount);
      return res.status(400).json({
        error: 'Invalid amount. Must be between 1 and 100,000 INR',
        success: false,
      });
    }

    console.log('📊 Creating order for amount:', amount, currency);

    const options = {
      amount: Math.round(amount * 100), // paise
      currency: currency.toUpperCase(),
      receipt: `receipt_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    };

    const order = await razorpay.orders.create(options);
    console.log('✅ Order created:', order.id);

    res.json({ ...order, success: true });

  } catch (error) {
    console.error('❌ Order creation error:', error);
    if (error.error) {
      return res.status(400).json({
        error: error.error.description || 'Razorpay order creation failed',
        success: false,
      });
    }
    res.status(500).json({ error: 'Internal server error during order creation', success: false });
  }
});

// ── VERIFY PAYMENT ────────────────────────────────────────────────────────────
app.post('/api/verify-payment', (req, res) => {
  console.log('🔐 Payment verification request from origin:', req.headers.origin || req.ip);

  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      console.error('❌ Missing verification data');
      return res.status(400).json({ success: false, message: 'Missing payment verification data' });
    }

    const sign = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expectedSign = crypto
      .createHmac('sha256', RAZORPAY_KEY_SECRET)
      .update(sign)
      .digest('hex');

    if (razorpay_signature === expectedSign) {
      console.log('✅ Payment verified:', razorpay_payment_id);
      res.json({ success: true, message: 'Payment verified successfully' });
    } else {
      console.error('❌ Invalid signature for payment:', razorpay_payment_id);
      res.status(400).json({ success: false, message: 'Payment verification failed - invalid signature' });
    }

  } catch (error) {
    console.error('❌ Payment verification error:', error);
    res.status(500).json({ success: false, message: 'Internal server error during verification' });
  }
});

// ── ERROR HANDLING ────────────────────────────────────────────────────────────
app.use((error, req, res, next) => {
  console.error('💥 Global error handler:', error.message);
  // Return proper CORS error message instead of generic 500
  if (error.message && error.message.includes('not allowed by CORS')) {
    return res.status(403).json({ error: error.message, success: false });
  }
  res.status(500).json({ error: 'Internal server error', success: false });
});

app.use('*', (req, res) => {
  console.log('❓ 404:', req.method, req.originalUrl);
  res.status(404).json({ error: 'API endpoint not found', success: false });
});

// ── START ─────────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log('🚀 Server started!');
  console.log(`📍 http://localhost:${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔑 Razorpay: ${RAZORPAY_KEY_ID ? 'Configured' : 'Not configured'}`);
  console.log(`🌐 Allowed origins:\n   ${allowedOrigins.join('\n   ')}`);
  console.log('📡 Ready to accept requests...');
});
