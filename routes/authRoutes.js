const express = require("express");
const router = express.Router();
const { body } = require("express-validator");
const { protect, authorize, authRateLimit } = require("../middleware/authMiddleware");
const {
  register,
  login,
  refreshToken,
  getMe,
  updateProfile,
  changePassword,
  getUsers,
  deleteUser
} = require("../controllers/authController");
const {
  requestPasswordReset,
  verifyOTP,
  resetPassword,
  resendOTP
} = require('../controllers/passwordResetController');

// Add these routes (public, no authentication required)
router.post('/forgot-password', requestPasswordReset);
router.post('/verify-otp', verifyOTP);
router.post('/reset-password', resetPassword);
router.post('/resend-otp', resendOTP);

// ==================== PUBLIC ROUTES ====================

// Login with rate limiting
router.post("/login", [
  authRateLimit,
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').notEmpty().withMessage('Password required')
], login);

// Refresh token
router.post("/refresh-token", refreshToken);

// ==================== PROTECTED ROUTES ====================
router.use(protect);

// Get current user
router.get("/me", getMe);

// Update profile
router.put("/profile", [
  body('name').optional().trim().isLength({ min: 2 }),
  body('phone').optional().matches(/^\+?[1-9]\d{1,14}$/)
], updateProfile);

// Change password
router.put("/change-password", [
  body('currentPassword').notEmpty(),
  body('newPassword').isLength({ min: 6 })
], changePassword);

// ==================== ADMIN ROUTES ====================

// Register new user (Admin+)
router.post("/register", 
  authorize('super_admin', 'admin'),
  [
    body('name').notEmpty().trim(),
    body('email').isEmail().normalizeEmail(),
    body('phone').matches(/^\+?[1-9]\d{1,14}$/),
    body('password').isLength({ min: 6 }),
    body('role').isIn(['admin', 'loan_officer', 'borrower', 'guarantor'])
  ], 
  register
);

// Get all users (Admin+)
router.get("/users", 
  authorize('super_admin', 'admin'), 
  getUsers
);

// Delete user (Super Admin only)
router.delete("/users/:id", 
  authorize('super_admin'), 
  deleteUser
);

module.exports = router;