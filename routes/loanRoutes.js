const express = require("express");
const router = express.Router();
const { body } = require("express-validator");
const { protect, authorize } = require("../middleware/authMiddleware");
const {
  createLoan,
  getLoans,
  getLoanById,
  updateLoan,
  approveLoan,
  disburseLoan,
  rejectLoan,
  recordPayment,
  addNote,
  deleteLoan,
  getLoanStats,
  verifyCollateral,
  checkNationalId,
  getLoansWithProgress  // Make sure this is imported
} = require("../controllers/loanController");

// All routes are protected
router.use(protect);

// National ID check route
router.post("/check-national-id", checkNationalId);

// Stats route - must come before /:id routes
router.get("/stats/overview", authorize('super_admin', 'admin', 'borrower', 'guarantor'), getLoanStats);

// Get loans with accurate progress data - PUT THIS BEFORE /:id ROUTES
router.get('/with-progress', 
  authorize('super_admin', 'admin'), 
  getLoansWithProgress
);

// Main CRUD routes
router.route("/")
  .get(authorize('super_admin', 'admin', 'borrower', 'guarantor'), getLoans)
  .post(
    authorize('super_admin', 'admin', 'loan_officer'),
    [], // Empty array = no validation
    createLoan
  );

// Get single loan by ID - THIS COMES AFTER /with-progress
router.route("/:id")
  .get(authorize('super_admin', 'admin', 'borrower', 'guarantor'), getLoanById)
  .put(
    authorize('super_admin', 'admin'),
    [
      body('amount').optional().isFloat({ min: 100 }),
      body('interestRate').optional().isFloat({ min: 0, max: 100 }),
      body('term').optional().isInt({ min: 1 })
    ],
    updateLoan
  )
  .delete(authorize('super_admin'), deleteLoan);

// Loan workflow routes
router.put("/:id/approve", 
  authorize('super_admin', 'admin'), 
  approveLoan
);

router.put("/:id/disburse", 
  authorize('super_admin', 'admin'), 
  disburseLoan
);

router.put("/:id/reject", 
  authorize('super_admin', 'admin'),
  [
    body('reason').notEmpty().withMessage('Rejection reason is required')
  ],
  rejectLoan
);

// Collateral verification route
router.put("/:id/verify-collateral", 
  authorize('super_admin', 'admin'),
  verifyCollateral
);

// Payment routes
router.post("/:id/payments",
  authorize('super_admin', 'admin', 'borrower'),
  [
    body('amount').isFloat({ min: 0.01 }),
    body('method').isIn(['cash', 'bank_transfer', 'mobile_money', 'check'])
  ],
  recordPayment
);

// Notes routes
router.post("/:id/notes",
  authorize('super_admin', 'admin'),
  [
    body('text').notEmpty().trim()
  ],
  addNote
);

module.exports = router;