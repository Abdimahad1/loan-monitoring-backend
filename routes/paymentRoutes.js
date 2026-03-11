const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const paymentController = require('../controllers/paymentController');

// All payment routes require authentication
router.use(protect);

// ========== PAYMENT PROCESSING ==========
/**
 * @route   POST /api/payments/process
 * @desc    Process a new loan payment with installment tracking
 * @access  Private (Borrower)
 */
router.post('/process', paymentController.processLoanPayment);

// ========== PAYMENT HISTORY ==========
/**
 * @route   GET /api/payments/history
 * @desc    Get user's payment history with pagination
 * @access  Private
 */
router.get('/history', paymentController.getUserPaymentHistory);

/**
 * @route   GET /api/payments/stats
 * @desc    Get payment statistics for user
 * @access  Private
 */
router.get('/stats', paymentController.getPaymentStats);

/**
 * @route   GET /api/payments/summary
 * @desc    Get comprehensive payment summary for dashboard
 * @access  Private
 */
router.get('/summary', paymentController.getPaymentSummary);

// ========== LOAN-SPECIFIC PAYMENT INFO ==========
/**
 * @route   GET /api/payments/loan/:loanId/summary
 * @desc    Get payment summary for a specific loan with installment progress
 * @access  Private
 */
router.get('/loan/:loanId/summary', paymentController.getLoanPaymentSummary);

// ========== SINGLE PAYMENT DETAILS ==========
/**
 * @route   GET /api/payments/:paymentId
 * @desc    Get details of a specific payment
 * @access  Private
 */
router.get('/:paymentId', paymentController.getPaymentDetails);

// ========== DEBUG ENDPOINTS (Development only) ==========
/**
 * @route   GET /api/payments/debug/loan/:loanId
 * @desc    Debug endpoint to check loan ownership and installment status
 * @access  Private (Development only)
 */
if (process.env.NODE_ENV === 'development') {
  router.get('/debug/loan/:loanId', paymentController.debugLoanOwnership);
}

module.exports = router;