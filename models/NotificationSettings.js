const mongoose = require("mongoose");

const notificationSettingsSchema = new mongoose.Schema(
{
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    unique: true
  },
  email: {
    type: Boolean,
    default: true
  },
  sms: {
    type: Boolean,
    default: true
  },
  push: {
    type: Boolean,
    default: false
  }
},
{
  timestamps: true // automatically manages createdAt and updatedAt
}
);

const NotificationSettings = mongoose.model(
  "NotificationSettings",
  notificationSettingsSchema
);

module.exports = NotificationSettings;