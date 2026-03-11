const express = require("express");
const router = express.Router();
const { body } = require("express-validator");
const { protect, authorize } = require("../middleware/authMiddleware");
const {
  getUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  restoreUser,
  bulkCreateUsers,
  checkNationalId
} = require("../controllers/userController");

// All routes are protected
router.use(protect);

// GET routes - Admin+ can access
router.get("/", authorize("super_admin", "admin"), getUsers);
router.get("/:id", authorize("super_admin", "admin"), getUserById);

// POST routes
router.post("/",
  authorize("super_admin", "admin"),
  [
    body('name').notEmpty().trim().withMessage('Name is required'),
    body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
    body('phone').matches(/^\+?[1-9]\d{1,14}$/).withMessage('Valid phone number required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('role').isIn(['admin', 'loan_officer', 'borrower', 'guarantor']).withMessage('Invalid role')
  ],
  createUser
);

// Bulk create - Super Admin only
router.post("/bulk",
  authorize("super_admin"),
  bulkCreateUsers
);
// National ID check route
router.post("/check-national-id", protect, checkNationalId);

// PUT routes
router.put("/:id",
  authorize("super_admin", "admin"),
  updateUser
);

router.put("/:id/restore",
  authorize("super_admin"),
  restoreUser
);

// DELETE routes - Super Admin only
router.delete("/:id",
  authorize("super_admin"),
  deleteUser
);

module.exports = router;