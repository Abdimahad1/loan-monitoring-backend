const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
require("dotenv").config();

const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const loanRoutes = require("./routes/loanRoutes");
const uploadRoutes = require('./routes/uploadRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const guarantorRoutes = require("./routes/guarantorRoutes");


const app = express();

// ==================== MIDDLEWARE ====================

// Security headers
app.use(helmet());

// ✅ CORS - Allow all origins
app.use(cors({
  origin: true,
  credentials: true
}));

// Body parser
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(cookieParser());

// ✅ NO RATE LIMITING - You can try as many times as you want!
console.log("🔓 Rate limiting: COMPLETELY REMOVED");

// Request logger
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// ==================== ROUTES ====================

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/loans", loanRoutes);
app.use('/uploads', express.static('uploads'));
app.use('/api/upload', uploadRoutes);
app.use('/api/payments', paymentRoutes);
app.use("/api/guarantor", guarantorRoutes);


// Test route
app.get("/test", (req, res) => {
  res.json({ 
    success: true, 
    message: "Server is running!",
    timestamp: new Date().toISOString()
  });
});

// ==================== ERROR HANDLING ====================

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.url}`
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error("❌ Server Error:", err.message);
  console.error(err.stack);
  
  res.status(500).json({
    success: false,
    message: err.message || 'Internal server error'
  });
});

// ==================== DATABASE CONNECTION ====================

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ MongoDB Connected");
    
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => {
      console.log(`✅ Server running on port ${PORT}`);
      console.log(`🌐 CORS: All origins allowed`);
      console.log(`🔗 Test: http://localhost:${PORT}/test`);
    });
    
  } catch (error) {
    console.error("❌ MongoDB connection error:", error.message);
    process.exit(1);
  }
};

connectDB();