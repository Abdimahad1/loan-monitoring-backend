// controllers/notificationSettingsController.js
const NotificationSettings = require("../models/NotificationSettings");

/**
 * @desc    Get user notification settings
 * @route   GET /api/notifications/settings
 * @access  Private
 */
exports.getNotificationSettings = async (req, res) => {
  try {
    let settings = await NotificationSettings.findOne({ user: req.user.id });

    // If no settings exist, create default ones
    if (!settings) {
      settings = new NotificationSettings({
        user: req.user.id,
        channels: {
          email: { enabled: true, address: req.user.email },
          sms: { enabled: true, phone: req.user.phone },
          push: { enabled: false, devices: [] },
          inApp: { enabled: true }
        }
      });
      await settings.save();
    }

    res.status(200).json({
      success: true,
      data: settings
    });
  } catch (error) {
    console.error("Error fetching notification settings:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch notification settings"
    });
  }
};

/**
 * @desc    Update notification settings
 * @route   PUT /api/notifications/settings
 * @access  Private
 */
exports.updateNotificationSettings = async (req, res) => {
  try {
    const { channels, preferences, quietHours } = req.body;

    let settings = await NotificationSettings.findOne({ user: req.user.id });

    if (!settings) {
      settings = new NotificationSettings({ user: req.user.id });
    }

    // Update channels
    if (channels) {
      if (channels.email !== undefined) {
        settings.channels.email.enabled = channels.email.enabled;
        if (channels.email.address) settings.channels.email.address = channels.email.address;
      }
      if (channels.sms !== undefined) {
        settings.channels.sms.enabled = channels.sms.enabled;
        if (channels.sms.phone) settings.channels.sms.phone = channels.sms.phone;
      }
      if (channels.push !== undefined) {
        settings.channels.push.enabled = channels.push.enabled;
      }
      if (channels.inApp !== undefined) {
        settings.channels.inApp.enabled = channels.inApp.enabled;
      }
    }

    // Update preferences
    if (preferences) {
      Object.keys(preferences).forEach(key => {
        if (settings.preferences[key]) {
          settings.preferences[key] = {
            ...settings.preferences[key],
            ...preferences[key]
          };
        }
      });
    }

    // Update quiet hours
    if (quietHours) {
      settings.quietHours = {
        ...settings.quietHours,
        ...quietHours
      };
    }

    await settings.save();

    res.status(200).json({
      success: true,
      message: "Notification settings updated successfully",
      data: settings
    });
  } catch (error) {
    console.error("Error updating notification settings:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update notification settings"
    });
  }
};

/**
 * @desc    Toggle a specific notification channel
 * @route   PATCH /api/notifications/settings/:type/toggle
 * @access  Private
 */
exports.toggleNotificationSetting = async (req, res) => {
  try {
    const { type } = req.params;
    
    if (!['email', 'sms', 'push', 'inApp'].includes(type)) {
      return res.status(400).json({
        success: false,
        message: "Invalid notification type"
      });
    }

    let settings = await NotificationSettings.findOne({ user: req.user.id });

    if (!settings) {
      settings = new NotificationSettings({ user: req.user.id });
    }

    // Toggle the setting
    settings.channels[type].enabled = !settings.channels[type].enabled;
    await settings.save();

    res.status(200).json({
      success: true,
      message: `${type} notifications ${settings.channels[type].enabled ? 'enabled' : 'disabled'}`,
      data: {
        [type]: settings.channels[type].enabled
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

/**
 * @desc    Register push notification device
 * @route   POST /api/notifications/settings/devices
 * @access  Private
 */
exports.registerDevice = async (req, res) => {
  try {
    const { deviceId, deviceType, pushToken } = req.body;

    if (!deviceId || !deviceType || !pushToken) {
      return res.status(400).json({
        success: false,
        message: "Device ID, type, and push token are required"
      });
    }

    let settings = await NotificationSettings.findOne({ user: req.user.id });

    if (!settings) {
      settings = new NotificationSettings({ user: req.user.id });
    }

    // Check if device already exists
    const existingDeviceIndex = settings.channels.push.devices.findIndex(
      d => d.deviceId === deviceId
    );

    const deviceData = {
      deviceId,
      deviceType,
      pushToken,
      lastActive: new Date()
    };

    if (existingDeviceIndex >= 0) {
      // Update existing device
      settings.channels.push.devices[existingDeviceIndex] = deviceData;
    } else {
      // Add new device
      settings.channels.push.devices.push(deviceData);
    }

    // Enable push if not already enabled
    settings.channels.push.enabled = true;

    await settings.save();

    res.status(200).json({
      success: true,
      message: "Device registered successfully"
    });
  } catch (error) {
    console.error("Error registering device:", error);
    res.status(500).json({
      success: false,
      message: "Failed to register device"
    });
  }
};

/**
 * @desc    Unregister push notification device
 * @route   DELETE /api/notifications/settings/devices/:deviceId
 * @access  Private
 */
exports.unregisterDevice = async (req, res) => {
  try {
    const { deviceId } = req.params;

    const settings = await NotificationSettings.findOne({ user: req.user.id });

    if (settings) {
      settings.channels.push.devices = settings.channels.push.devices.filter(
        d => d.deviceId !== deviceId
      );
      
      // Disable push if no devices left
      if (settings.channels.push.devices.length === 0) {
        settings.channels.push.enabled = false;
      }

      await settings.save();
    }

    res.status(200).json({
      success: true,
      message: "Device unregistered successfully"
    });
  } catch (error) {
    console.error("Error unregistering device:", error);
    res.status(500).json({
      success: false,
      message: "Failed to unregister device"
    });
  }
};