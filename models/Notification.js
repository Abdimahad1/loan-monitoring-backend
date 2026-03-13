// models/Notification.js
const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    userRole: {
      type: String,
      enum: ['borrower', 'guarantor', 'admin'],
      required: true
    },
    type: {
      type: String,
      enum: [
        'loan_created',
        'loan_approved',
        'loan_rejected',
        'loan_disbursed',
        'loan_completed',
        'payment_received',
        'payment_overdue',
        'payment_reminder',
        'guarantor_added',
        'guarantor_confirmed',
        'guarantor_alert',
        'risk_alert',
        'document_uploaded',
        'system'
      ],
      required: true
    },
    title: {
      type: String,
      required: true
    },
    message: {
      type: String,
      required: true
    },
    data: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical'],
      default: 'medium'
    },
    isRead: {
      type: Boolean,
      default: false,
      index: true
    },
    isArchived: {
      type: Boolean,
      default: false,
      index: true
    },
    readAt: {
      type: Date
    },
    expiresAt: {
      type: Date,
      default: () => new Date(+new Date() + 30*24*60*60*1000) // 30 days from now
    },
    action: {
      label: String,
      route: String,
      data: mongoose.Schema.Types.Mixed
    },
    metadata: {
      ip: String,
      userAgent: String,
      source: String
    }
  },
  {
    timestamps: true
  }
);

// Indexes for efficient querying
notificationSchema.index({ user: 1, createdAt: -1 });
notificationSchema.index({ user: 1, isRead: 1 });
notificationSchema.index({ type: 1, createdAt: -1 });
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Virtual for time ago
notificationSchema.virtual('timeAgo').get(function() {
  const now = new Date();
  const diff = now - this.createdAt;
  
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  
  if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  return 'Just now';
});

// Method to mark as read
notificationSchema.methods.markAsRead = function() {
  this.isRead = true;
  this.readAt = new Date();
  return this.save();
};

// Method to mark as unread
notificationSchema.methods.markAsUnread = function() {
  this.isRead = false;
  this.readAt = null;
  return this.save();
};

// Static method to get unread count
notificationSchema.statics.getUnreadCount = function(userId) {
  return this.countDocuments({ user: userId, isRead: false });
};

const Notification = mongoose.model("Notification", notificationSchema);

module.exports = Notification;