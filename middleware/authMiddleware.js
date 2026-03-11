const jwt = require("jsonwebtoken");
const User = require("../models/User");

// Protect routes
exports.protect = async (req, res, next) => {
  try {
    let token;

    // Check for token in headers
    if (req.headers.authorization?.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    // Check for token in cookies (if using cookies)
    if (!token && req.cookies?.token) {
      token = req.cookies.token;
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Not authorized - No token provided"
      });
    }

    try {
      // Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET, {
        issuer: 'loan-api',
        audience: 'loan-app'
      });

      // Get user from token
      const user = await User.findById(decoded.id).select('-password');

      if (!user) {
        return res.status(401).json({
          success: false,
          message: "Not authorized - User not found"
        });
      }

      // Check if user is active
      if (!user.isActive) {
        return res.status(401).json({
          success: false,
          message: "Account deactivated. Contact support."
        });
      }

      // Check if account is locked
      if (user.isLocked && user.isLocked()) {
        return res.status(423).json({
          success: false,
          message: "Account locked. Try again later."
        });
      }

      // Check if password was changed after token was issued
      if (user.passwordChangedAt) {
        const changedTimestamp = parseInt(user.passwordChangedAt.getTime() / 1000, 10);
        if (decoded.iat < changedTimestamp) {
          return res.status(401).json({
            success: false,
            message: "Password recently changed. Please login again."
          });
        }
      }

      // Add user to request
      req.user = user;
      next();
      
    } catch (error) {
      if (error.name === 'JsonWebTokenError') {
        return res.status(401).json({
          success: false,
          message: "Not authorized - Invalid token"
        });
      }
      if (error.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          message: "Not authorized - Token expired"
        });
      }
      throw error;
    }
  } catch (error) {
    console.error("Auth middleware error:", error);
    res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
};

// Authorize by roles
exports.authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Not authorized"
      });
    }
    
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Role '${req.user.role}' not authorized. Required: ${roles.join(' or ')}`
      });
    }
    
    next();
  };
};

// Check if user can manage target user
exports.canManage = async (req, res, next) => {
  try {
    const { userId } = req.params;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID required"
      });
    }
    
    const targetUser = await User.findById(userId);
    
    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }
    
    if (!req.user.canManage(targetUser)) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to manage this user"
      });
    }
    
    req.targetUser = targetUser;
    next();
    
  } catch (error) {
    console.error("CanManage middleware error:", error);
    res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
};

// Rate limiting for auth attempts (simple version)
exports.authRateLimit = (req, res, next) => {
  // Simple in-memory rate limiting
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  
  if (!global.rateLimit) global.rateLimit = new Map();
  
  const now = Date.now();
  const windowMs = 15 * 60 * 1000; // 15 minutes
  const maxAttempts = 5;
  
  const attempts = global.rateLimit.get(ip) || [];
  const recentAttempts = attempts.filter(time => time > now - windowMs);
  
  if (recentAttempts.length >= maxAttempts) {
    return res.status(429).json({
      success: false,
      message: "Too many login attempts. Try again later."
    });
  }
  
  recentAttempts.push(now);
  global.rateLimit.set(ip, recentAttempts);
  
  next();
};