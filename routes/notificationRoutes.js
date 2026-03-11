const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const {
  getNotificationSettings,
  updateNotificationSettings,
  toggleNotificationSetting
} = require("../controllers/notificationController");

// All routes are protected
router.use(protect);

// Get and update notification settings
router.route("/settings")
  .get(getNotificationSettings)
  .put(updateNotificationSettings);

// Toggle specific setting
router.patch("/settings/:type", toggleNotificationSetting);

module.exports = router;