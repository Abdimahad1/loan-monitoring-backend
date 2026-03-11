const NotificationSettings = require("../models/NotificationSettings");

// @desc    Get user notification settings
// @route   GET /api/notifications/settings
// @access  Private
exports.getNotificationSettings = async (req, res) => {
  try {
    let settings = await NotificationSettings.findOne({ user: req.user.id });

    // If no settings exist, create default ones
    if (!settings) {
      settings = new NotificationSettings({
        user: req.user.id,
        email: true,
        sms: true,
        push: false
      });
      await settings.save();
    }

    res.status(200).json({
      success: true,
      data: {
        email: settings.email,
        sms: settings.sms,
        push: settings.push
      }
    });
  } catch (error) {
    console.error("Error fetching notification settings:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch notification settings"
    });
  }
};

// @desc    Update notification settings
// @route   PUT /api/notifications/settings
// @access  Private
exports.updateNotificationSettings = async (req, res) => {
  try {
    const { email, sms, push } = req.body;

    // Validate input
    if (email !== undefined && typeof email !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: "Email setting must be a boolean"
      });
    }

    if (sms !== undefined && typeof sms !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: "SMS setting must be a boolean"
      });
    }

    if (push !== undefined && typeof push !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: "Push setting must be a boolean"
      });
    }

    // Find and update, or create if doesn't exist
    let settings = await NotificationSettings.findOne({ user: req.user.id });

    if (settings) {
      // Update existing
      if (email !== undefined) settings.email = email;
      if (sms !== undefined) settings.sms = sms;
      if (push !== undefined) settings.push = push;
      await settings.save();
    } else {
      // Create new
      settings = new NotificationSettings({
        user: req.user.id,
        email: email !== undefined ? email : true,
        sms: sms !== undefined ? sms : true,
        push: push !== undefined ? push : false
      });
      await settings.save();
    }

    res.status(200).json({
      success: true,
      message: "Notification settings updated successfully",
      data: {
        email: settings.email,
        sms: settings.sms,
        push: settings.push
      }
    });
  } catch (error) {
    console.error("Error updating notification settings:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update notification settings"
    });
  }
};

// @desc    Toggle a specific notification setting
// @route   PATCH /api/notifications/settings/:type
// @access  Private
exports.toggleNotificationSetting = async (req, res) => {
  try {
    const { type } = req.params;
    
    // Validate type
    if (!['email', 'sms', 'push'].includes(type)) {
      return res.status(400).json({
        success: false,
        message: "Invalid notification type. Must be email, sms, or push"
      });
    }

    let settings = await NotificationSettings.findOne({ user: req.user.id });

    if (!settings) {
      // Create default settings if none exist
      settings = new NotificationSettings({
        user: req.user.id,
        email: true,
        sms: true,
        push: false
      });
    }

    // Toggle the setting
    settings[type] = !settings[type];
    await settings.save();

    res.status(200).json({
      success: true,
      message: `${type} notifications ${settings[type] ? 'enabled' : 'disabled'}`,
      data: {
        [type]: settings[type]
      }
    });
  } catch (error) {
    console.error("Error toggling notification setting:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update notification setting"
    });
  }
};