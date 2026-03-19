// routes/notificationRoutes.js
const express = require("express");
const router = express.Router();
const { protect, authorize } = require("../middleware/authMiddleware");
const {
  getNotifications,
  getUnreadCount,
  getNotificationById,
  markAsRead,
  markAllAsRead,
  archiveNotification,
  deleteNotification,
  clearAllNotifications
} = require("../controllers/notificationController");
const {
  getNotificationSettings,
  updateNotificationSettings,
  toggleNotificationSetting
} = require("../controllers/notificationSettingsController");

// All routes are protected
router.use(protect);

// ==================== NOTIFICATION ROUTES ====================

// Get all notifications with pagination
router.get("/", getNotifications);

// Get unread count
router.get("/unread-count", getUnreadCount);

// Mark all as read
router.put("/read-all", markAllAsRead);

// Clear all archived notifications
router.delete("/clear-all", clearAllNotifications);

// Get single notification
router.get("/:id", getNotificationById);

// Mark as read
router.put("/:id/read", markAsRead);

// Archive notification
router.put("/:id/archive", archiveNotification);

// Delete notification
router.delete("/:id", deleteNotification);

// ==================== SETTINGS ROUTES ====================

// Get and update notification settings
router.route("/settings")
  .get(getNotificationSettings)
  .put(updateNotificationSettings);

// Toggle specific setting
router.patch("/settings/:type/toggle", toggleNotificationSetting);
// Add these after the existing routes (around line after deleteNotification)

// ==================== PUSH NOTIFICATION TOKENS ====================

/**
 * @route   POST /api/notifications/register-token
 * @desc    Register device token for push notifications
 * @access  Private
 */
router.post('/register-token', async (req, res) => {
  try {
    const { token, platform } = req.body;
    // Dynamic import to avoid circular dependency
    const { registerDeviceToken } = require('../services/pushService');
    
    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Token is required'
      });
    }

    await registerDeviceToken(req.user.id, token, platform || 'flutter');
    
    res.json({
      success: true,
      message: 'Device token registered successfully'
    });
  } catch (error) {
    console.error('Error registering token:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to register device token'
    });
  }
});

// TEMPORARY TEST ENDPOINT - Add this before module.exports
// @route   POST /api/notifications/test-create
// @desc    Create a test notification (FOR TESTING ONLY)
// @access  Private
router.post('/test-create', async (req, res) => {
  try {
    const { userId, type, title, message } = req.body;
    
    // Use the createNotification function from your controller
    const { createNotification } = require('../controllers/notificationController');
    
    const notification = await createNotification({
      userId: userId || req.user.id,
      userRole: 'borrower',
      type: type || 'system',
      title: title || 'Test Notification',
      message: message || 'This is a test notification from Postman',
      priority: 'high',
      action: {
        label: 'View',
        route: '/notifications'
      }
    });

    res.json({
      success: true,
      message: 'Test notification created',
      data: notification
    });
  } catch (error) {
    console.error('Error creating test notification:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});


/**
 * @route   DELETE /api/notifications/unregister-token
 * @desc    Unregister device token
 * @access  Private
 */
router.delete('/unregister-token', async (req, res) => {
  try {
    const { token } = req.body;
    const { unregisterDeviceToken } = require('../services/pushService');
    
    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Token is required'
      });
    }

    await unregisterDeviceToken(req.user.id, token);
    
    res.json({
      success: true,
      message: 'Device token unregistered successfully'
    });
  } catch (error) {
    console.error('Error unregistering token:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to unregister device token'
    });
  }
});

module.exports = router;