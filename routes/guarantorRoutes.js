// routes/guarantorRoutes.js
const express = require("express");
const router = express.Router();
const { protect, authorize } = require("../middleware/authMiddleware");
const {
  getGuarantorStats,
  getGuarantorLoans,
  getGuarantorLoanById,
  getLoanSchedule,
  getLoanPayments,
  getGuarantorNotifications,
  markNotificationAsRead
} = require("../controllers/guarantorController");

// All routes are protected and require guarantor role
router.use(protect);
router.use(authorize('guarantor'));

// Dashboard stats
router.get("/stats", getGuarantorStats);

// Loans routes
router.get("/loans", getGuarantorLoans);
router.get("/loans/:id", getGuarantorLoanById);
router.get("/loans/:id/schedule", getLoanSchedule);
router.get("/loans/:id/payments", getLoanPayments);

// Notifications
router.get("/notifications", getGuarantorNotifications);
router.put("/notifications/:id/read", markNotificationAsRead);

module.exports = router;