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

// CORS configuration - Allow all origins for development, restrict in production
const allowedOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://royal-goa-ride-backend-production.up.railway.app',
  'https://your-frontend-domain.com' // replace with your real prod frontend URL
];

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);

    // In development, allow localhost and Railway preview domains
    if (process.env.NODE_ENV !== 'production') {
      if (origin.includes('localhost') || origin.includes('127.0.0.1') || origin.includes('railway.app')) {
        return callback(null, true);
      }
      return callback(new Error('Not allowed by CORS'), false);
    }

    // Production: only allow exact whitelisted origins
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    callback(new Error(`Origin ${origin} not allowed by CORS`), false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Razorpay configuration endpoint
app.get('/api/config', (req, res) => {
  console.log('📡 Config request from:', req.ip);
  try {
    res.json({
      razorpayKeyId: RAZORPAY_KEY_ID,
      success: true
    });
  } catch (error) {
    console.error('❌ Config endpoint error:', error);
    res.status(500).json({
      error: 'Configuration error',
      success: false
    });
  }
});

// Create Razorpay order endpoint
app.post('/api/create-order', async (req, res) => {
  console.log('💳 Order creation request from:', req.ip);

  try {
    const { amount, currency = 'INR' } = req.body;

    // Validate amount
    if (!amount || typeof amount !== 'number' || amount <= 0 || amount > 100000) {
      console.error('❌ Invalid amount:', amount);
      return res.status(400).json({
        error: 'Invalid amount. Must be between 1 and 100,000 INR',
        success: false
      });
    }

    console.log('📊 Creating order for amount:', amount, currency);

    const options = {
      amount: Math.round(amount * 100), // Convert to paisa
      currency: currency.toUpperCase(),
      receipt: `receipt_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    };

    const order = await razorpay.orders.create(options);

    console.log('✅ Order created successfully:', order.id);

    res.json({
      ...order,
      success: true
    });

  } catch (error) {
    console.error('❌ Order creation error:', error);

    // Handle specific Razorpay errors
    if (error.error) {
      return res.status(400).json({
        error: error.error.description || 'Razorpay order creation failed',
        success: false
      });
    }

    res.status(500).json({
      error: 'Internal server error during order creation',
      success: false
    });
  }
});

// Verify payment endpoint
app.post('/api/verify-payment', (req, res) => {
  console.log('🔐 Payment verification request from:', req.ip);

  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    // Validate required fields
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      console.error('❌ Missing verification data:', {
        order_id: !!razorpay_order_id,
        payment_id: !!razorpay_payment_id,
        signature: !!razorpay_signature
      });
      return res.status(400).json({
        success: false,
        message: 'Missing payment verification data'
      });
    }

    console.log('🔍 Verifying payment:', razorpay_payment_id);

    // Create expected signature
    const sign = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expectedSign = crypto
      .createHmac('sha256', RAZORPAY_KEY_SECRET)
      .update(sign)
      .digest('hex');

    // Verify signature
    if (razorpay_signature === expectedSign) {
      console.log('✅ Payment verified successfully:', razorpay_payment_id);
      res.json({
        success: true,
        message: 'Payment verified successfully'
      });
    } else {
      console.error('❌ Invalid signature for payment:', razorpay_payment_id);
      res.status(400).json({
        success: false,
        message: 'Payment verification failed - invalid signature'
      });
    }

  } catch (error) {
    console.error('❌ Payment verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error during verification'
    });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('💥 Global error handler:', error);
  res.status(500).json({
    error: 'Internal server error',
    success: false
  });
});

// 404 handler
app.use('*', (req, res) => {
  console.log('❓ 404 - Route not found:', req.method, req.originalUrl);
  res.status(404).json({
    error: 'API endpoint not found',
    success: false
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('🚀 Server started successfully!');
  console.log(`📍 Running on: http://localhost:${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔑 Razorpay: ${RAZORPAY_KEY_ID ? 'Configured' : 'Not configured'}`);
  console.log('📡 Ready to accept requests...');
});
