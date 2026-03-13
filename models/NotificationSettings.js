// models/NotificationSettings.js
const mongoose = require("mongoose");

const notificationSettingsSchema = new mongoose.Schema(
{
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    unique: true
  },
  // Channel preferences
  channels: {
    email: {
      enabled: { type: Boolean, default: true },
      address: String
    },
    sms: {
      enabled: { type: Boolean, default: true },
      phone: String
    },
    push: {
      enabled: { type: Boolean, default: false },
      devices: [{
        deviceId: String,
        deviceType: String,
        pushToken: String,
        lastActive: Date
      }]
    },
    inApp: {
      enabled: { type: Boolean, default: true }
    }
  },
  
  // Notification type preferences
  preferences: {
    loan_created: {
      email: { type: Boolean, default: true },
      sms: { type: Boolean, default: false },
      push: { type: Boolean, default: false },
      inApp: { type: Boolean, default: true }
    },
    loan_approved: {
      email: { type: Boolean, default: true },
      sms: { type: Boolean, default: true },
      push: { type: Boolean, default: true },
      inApp: { type: Boolean, default: true }
    },
    loan_rejected: {
      email: { type: Boolean, default: true },
      sms: { type: Boolean, default: false },
      push: { type: Boolean, default: false },
      inApp: { type: Boolean, default: true }
    },
    loan_disbursed: {
      email: { type: Boolean, default: true },
      sms: { type: Boolean, default: true },
      push: { type: Boolean, default: true },
      inApp: { type: Boolean, default: true }
    },
    loan_completed: {
      email: { type: Boolean, default: true },
      sms: { type: Boolean, default: true },
      push: { type: Boolean, default: true },
      inApp: { type: Boolean, default: true }
    },
    payment_received: {
      email: { type: Boolean, default: true },
      sms: { type: Boolean, default: false },
      push: { type: Boolean, default: true },
      inApp: { type: Boolean, default: true }
    },
    payment_overdue: {
      email: { type: Boolean, default: true },
      sms: { type: Boolean, default: true },
      push: { type: Boolean, default: true },
      inApp: { type: Boolean, default: true }
    },
    payment_reminder: {
      email: { type: Boolean, default: true },
      sms: { type: Boolean, default: true },
      push: { type: Boolean, default: true },
      inApp: { type: Boolean, default: true }
    },
    guarantor_alerts: {
      email: { type: Boolean, default: true },
      sms: { type: Boolean, default: true },
      push: { type: Boolean, default: true },
      inApp: { type: Boolean, default: true }
    },
    risk_alerts: {
      email: { type: Boolean, default: true },
      sms: { type: Boolean, default: true },
      push: { type: Boolean, default: true },
      inApp: { type: Boolean, default: true }
    }
  },
  
  // Quiet hours
  quietHours: {
    enabled: { type: Boolean, default: false },
    start: String, // HH:mm format
    end: String,   // HH:mm format
    timezone: { type: String, default: 'UTC' }
  },
  
  // Rate limiting (prevent notification spam)
  rateLimit: {
    maxPerHour: { type: Number, default: 20 },
    maxPerDay: { type: Number, default: 100 }
  }
},
{
  timestamps: true
}
);

// Method to check if a notification type is allowed
notificationSettingsSchema.methods.isAllowed = function(type, channel) {
  const pref = this.preferences[type];
  if (!pref) return this.channels[channel]?.enabled || false;
  return pref[channel] && this.channels[channel]?.enabled;
};

// Method to check quiet hours
notificationSettingsSchema.methods.isQuietHours = function() {
  if (!this.quietHours.enabled) return false;
  
  const now = new Date();
  const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
  
  return currentTime >= this.quietHours.start && currentTime <= this.quietHours.end;
};

const NotificationSettings = mongoose.model(
  "NotificationSettings",
  notificationSettingsSchema
);

module.exports = NotificationSettings;