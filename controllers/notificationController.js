// controllers/notificationController.js
const Notification = require("../models/Notification");
const Loan = require("../models/Loan");
const User = require("../models/User");
const NotificationSettings = require("../models/NotificationSettings");
const { sendPushNotification } = require("../services/pushService");

const { 
  sendWelcomeEmail, 
  sendNotificationEmail, // ADD THIS
  sendPasswordResetEmail, 
  sendPasswordResetConfirmation 
} = require("../services/emailService");

// ==================== GET NOTIFICATIONS ====================

/**
 * @desc    Get user notifications with pagination
 * @route   GET /api/notifications
 * @access  Private
 */
exports.getNotifications = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      page = 1,
      limit = 20,
      type,
      isRead,
      priority,
      startDate,
      endDate
    } = req.query;

    const query = { user: userId, isArchived: false };

    // Apply filters
    if (type && type !== 'all') query.type = type;
    if (isRead !== undefined) query.isRead = isRead === 'true';
    if (priority && priority !== 'all') query.priority = priority;
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const notifications = await Notification.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await Notification.countDocuments(query);
    const unreadCount = await Notification.countDocuments({ 
      user: userId, 
      isRead: false,
      isArchived: false 
    });

    // Add timeAgo to each notification
    const notificationsWithTime = notifications.map(notif => ({
      ...notif,
      timeAgo: getTimeAgo(notif.createdAt)
    }));

    res.status(200).json({
      success: true,
      data: notificationsWithTime,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
        unreadCount
      }
    });
  } catch (error) {
    console.error("Error fetching notifications:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch notifications"
    });
  }
};

/**
 * @desc    Get unread notifications count
 * @route   GET /api/notifications/unread-count
 * @access  Private
 */
exports.getUnreadCount = async (req, res) => {
  try {
    const count = await Notification.countDocuments({ 
      user: req.user.id, 
      isRead: false,
      isArchived: false 
    });
    
    res.status(200).json({
      success: true,
      count
    });
  } catch (error) {
    console.error("Error fetching unread count:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch unread count"
    });
  }
};

/**
 * @desc    Get single notification by ID
 * @route   GET /api/notifications/:id
 * @access  Private
 */
exports.getNotificationById = async (req, res) => {
  try {
    const notification = await Notification.findOne({
      _id: req.params.id,
      user: req.user.id,
      isArchived: false
    });

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: "Notification not found"
      });
    }

    res.status(200).json({
      success: true,
      data: notification
    });
  } catch (error) {
    console.error("Error fetching notification:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch notification"
    });
  }
};

// ==================== UPDATE NOTIFICATIONS ====================

/**
 * @desc    Mark notification as read
 * @route   PUT /api/notifications/:id/read
 * @access  Private
 */
exports.markAsRead = async (req, res) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, user: req.user.id },
      { 
        isRead: true, 
        readAt: new Date() 
      },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: "Notification not found"
      });
    }

    res.status(200).json({
      success: true,
      message: "Notification marked as read"
    });
  } catch (error) {
    console.error("Error marking notification as read:", error);
    res.status(500).json({
      success: false,
      message: "Failed to mark notification as read"
    });
  }
};

/**
 * @desc    Mark all notifications as read
 * @route   PUT /api/notifications/read-all
 * @access  Private
 */
exports.markAllAsRead = async (req, res) => {
  try {
    await Notification.updateMany(
      { user: req.user.id, isRead: false, isArchived: false },
      { 
        $set: { 
          isRead: true, 
          readAt: new Date() 
        } 
      }
    );

    res.status(200).json({
      success: true,
      message: "All notifications marked as read"
    });
  } catch (error) {
    console.error("Error marking all as read:", error);
    res.status(500).json({
      success: false,
      message: "Failed to mark all as read"
    });
  }
};

/**
 * @desc    Archive notification
 * @route   PUT /api/notifications/:id/archive
 * @access  Private
 */
exports.archiveNotification = async (req, res) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, user: req.user.id },
      { isArchived: true },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: "Notification not found"
      });
    }

    res.status(200).json({
      success: true,
      message: "Notification archived"
    });
  } catch (error) {
    console.error("Error archiving notification:", error);
    res.status(500).json({
      success: false,
      message: "Failed to archive notification"
    });
  }
};

/**
 * @desc    Delete notification
 * @route   DELETE /api/notifications/:id
 * @access  Private
 */
exports.deleteNotification = async (req, res) => {
  try {
    const notification = await Notification.findOneAndDelete({
      _id: req.params.id,
      user: req.user.id
    });

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: "Notification not found"
      });
    }

    res.status(200).json({
      success: true,
      message: "Notification deleted"
    });
  } catch (error) {
    console.error("Error deleting notification:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete notification"
    });
  }
};

/**
 * @desc    Clear all archived notifications
 * @route   DELETE /api/notifications/clear-all
 * @access  Private
 */
exports.clearAllNotifications = async (req, res) => {
  try {
    await Notification.deleteMany({ 
      user: req.user.id,
      isArchived: true 
    });

    res.status(200).json({
      success: true,
      message: "All archived notifications cleared"
    });
  } catch (error) {
    console.error("Error clearing notifications:", error);
    res.status(500).json({
      success: false,
      message: "Failed to clear notifications"
    });
  }
};

// ==================== NOTIFICATION CREATION HELPERS ====================

/**
 * Create a notification for a user
 */

exports.createNotification = async ({
  userId,
  userRole,
  type,
  title,
  message,
  data = {},
  priority = 'medium',
  action = null
}) => {
  try {
    // Create notification in database
    const notification = await Notification.create({
      user: userId,
      userRole,
      type,
      title,
      message,
      data,
      priority,
      action,
      isRead: false,
      isArchived: false
    });

    // Get user details for email
    const user = await User.findById(userId).select('name email');
    
    // Send email for high priority notifications
    if (priority === 'high' || priority === 'critical') {
      // Determine frontend URL
      const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      
      // Build action URL if action exists
      let actionUrl = null;
      if (action?.route) {
        actionUrl = `${baseUrl}${action.route}`;
        // Add any data parameters if needed
        if (action.data && Object.keys(action.data).length > 0) {
          const params = new URLSearchParams(action.data).toString();
          actionUrl = `${actionUrl}?${params}`;
        }
      }
      
      // Format amount if present in data
      const amount = data?.amount ? formatCurrency(data.amount) : null;
      
      // Send notification email
      await sendNotificationEmail({
        email: user.email,
        name: user.name,
        type: type,
        title: title,
        message: message,
        actionLabel: action?.label,
        actionUrl: actionUrl,
        amount: amount,
        loanId: data?.loanDisplayId
      }).catch(err => console.error("Failed to send notification email:", err));
    }

    // ALWAYS send push notification for ALL notifications (user can disable in app)
    // Don't await - let it run in background
    sendPushNotification(userId, notification).catch(err => 
      console.error("Failed to send push notification:", err)
    );

    console.log(`✅ Notification created for user ${userId}: ${type}`);
    return notification;
  } catch (error) {
    console.error("Error creating notification:", error);
    return null;
  }
};

// ==================== EVENT-BASED NOTIFICATIONS ====================

/**
 * Notify about loan creation
 */
exports.notifyLoanCreated = async (loan) => {
  try {
    // Get borrower details
    const borrower = await User.findById(loan.borrower.id).select('name email');
    
    // Notify borrower
    await exports.createNotification({
      userId: loan.borrower.id,
      userRole: 'borrower',
      type: 'loan_created',
      title: 'Loan Application Submitted',
      message: `Your loan application ${loan.loanId} for ${formatCurrency(loan.amount)} has been submitted successfully.`,
      data: { 
        loanId: loan._id, 
        loanDisplayId: loan.loanId, 
        amount: loan.amount 
      },
      priority: 'medium',
      action: {
        label: 'Track Application',
        route: '/my-loans',
        data: { loanId: loan._id }
      }
    });

    // Notify guarantor if exists
    if (loan.guarantor?.id) {
      const guarantor = await User.findById(loan.guarantor.id).select('name email');
      
      await exports.createNotification({
        userId: loan.guarantor.id,
        userRole: 'guarantor',
        type: 'guarantor_added',
        title: 'Added as Guarantor',
        message: `You have been added as a guarantor for ${borrower?.name || 'a borrower'}'s loan of ${formatCurrency(loan.amount)}.`,
        data: { 
          loanId: loan._id, 
          loanDisplayId: loan.loanId, 
          amount: loan.amount,
          borrowerName: borrower?.name || 'Borrower'
        },
        priority: 'high',
        action: {
          label: 'View Details',
          route: '/guarantor/loans',
          data: { loanId: loan._id }
        }
      });
    }
  } catch (error) {
    console.error("Error in loan created notification:", error);
  }
};

/**
 * Notify about loan approval
 */
exports.notifyLoanApproved = async (loan) => {
  try {
    const borrower = await User.findById(loan.borrower.id).select('name');
    
    // Notify borrower
    await exports.createNotification({
      userId: loan.borrower.id,
      userRole: 'borrower',
      type: 'loan_approved',
      title: '✅ Loan Approved!',
      message: `Congratulations! Your loan ${loan.loanId} for ${formatCurrency(loan.amount)} has been approved.`,
      data: { 
        loanId: loan._id, 
        loanDisplayId: loan.loanId, 
        amount: loan.amount 
      },
      priority: 'high',
      action: {
        label: 'View Loan',
        route: `/loan-details/${loan._id}`,
        data: { loanId: loan._id }
      }
    });

    // Notify guarantor
    if (loan.guarantor?.id) {
      await exports.createNotification({
        userId: loan.guarantor.id,
        userRole: 'guarantor',
        type: 'loan_approved',
        title: 'Loan Approved - Action Required',
        message: `The loan you're guaranteeing for ${borrower?.name || 'a borrower'} has been approved. Please review the terms.`,
        data: { 
          loanId: loan._id, 
          loanDisplayId: loan.loanId, 
          amount: loan.amount,
          borrowerName: borrower?.name || 'Borrower'
        },
        priority: 'high',
        action: {
          label: 'Review Loan',
          route: `/guarantor/loan-details/${loan._id}`,
          data: { loanId: loan._id }
        }
      });
    }
  } catch (error) {
    console.error("Error in loan approved notification:", error);
  }
};

/**
 * Notify about loan rejection
 */
exports.notifyLoanRejected = async (loan) => {
  try {
    await exports.createNotification({
      userId: loan.borrower.id,
      userRole: 'borrower',
      type: 'loan_rejected',
      title: 'Loan Application Update',
      message: `Your loan application ${loan.loanId} was not approved at this time.`,
      data: { 
        loanId: loan._id, 
        loanDisplayId: loan.loanId 
      },
      priority: 'medium',
      action: {
        label: 'Contact Support',
        route: '/support',
        data: {}
      }
    });
  } catch (error) {
    console.error("Error in loan rejected notification:", error);
  }
};

/**
 * Notify about loan disbursement
 */
exports.notifyLoanDisbursed = async (loan) => {
  try {
    await exports.createNotification({
      userId: loan.borrower.id,
      userRole: 'borrower',
      type: 'loan_disbursed',
      title: '💰 Loan Disbursed',
      message: `${formatCurrency(loan.amount)} has been disbursed to your account.`,
      data: { 
        loanId: loan._id, 
        loanDisplayId: loan.loanId, 
        amount: loan.amount 
      },
      priority: 'high',
      action: {
        label: 'View Transaction',
        route: '/payments',
        data: {}
      }
    });
  } catch (error) {
    console.error("Error in loan disbursed notification:", error);
  }
};

/**
 * Notify about loan completion
 */
exports.notifyLoanCompleted = async (loan) => {
  try {
    const borrower = await User.findById(loan.borrower.id).select('name');
    
    // Notify borrower
    await exports.createNotification({
      userId: loan.borrower.id,
      userRole: 'borrower',
      type: 'loan_completed',
      title: '🎉 Loan Completed!',
      message: `Congratulations! You've successfully repaid your loan ${loan.loanId}.`,
      data: { 
        loanId: loan._id, 
        loanDisplayId: loan.loanId 
      },
      priority: 'high',
      action: {
        label: 'View Summary',
        route: `/loan-details/${loan._id}`,
        data: { loanId: loan._id }
      }
    });

    // Notify guarantor
    if (loan.guarantor?.id) {
      await exports.createNotification({
        userId: loan.guarantor.id,
        userRole: 'guarantor',
        type: 'loan_completed',
        title: 'Loan Completed',
        message: `The loan you guaranteed for ${borrower?.name || 'a borrower'} has been fully repaid.`,
        data: { 
          loanId: loan._id, 
          loanDisplayId: loan.loanId,
          borrowerName: borrower?.name || 'Borrower'
        },
        priority: 'high',
        action: {
          label: 'View Details',
          route: `/guarantor/loan-details/${loan._id}`,
          data: { loanId: loan._id }
        }
      });
    }
  } catch (error) {
    console.error("Error in loan completed notification:", error);
  }
};

/**
 * Notify about payment received
 */
exports.notifyPaymentReceived = async (payment, loan) => {
  try {
    const borrower = await User.findById(loan.borrower.id).select('name');
    
    // Notify borrower
    await exports.createNotification({
      userId: payment.userId,
      userRole: 'borrower',
      type: 'payment_received',
      title: '✅ Payment Received',
      message: `Your payment of ${formatCurrency(payment.amount)} for loan ${loan.loanId} has been received.`,
      data: { 
        loanId: loan._id, 
        loanDisplayId: loan.loanId, 
        paymentId: payment._id,
        amount: payment.amount,
        transactionId: payment.transactionId
      },
      priority: 'high',
      action: {
        label: 'View Receipt',
        route: `/payments/${payment._id}`,
        data: { paymentId: payment._id }
      }
    });

    // Notify guarantor of payment
    if (loan.guarantor?.id) {
      await exports.createNotification({
        userId: loan.guarantor.id,
        userRole: 'guarantor',
        type: 'payment_received',
        title: 'Payment Made',
        message: `${borrower?.name || 'Borrower'} made a payment of ${formatCurrency(payment.amount)} on their loan.`,
        data: { 
          loanId: loan._id, 
          loanDisplayId: loan.loanId,
          borrowerName: borrower?.name || 'Borrower',
          amount: payment.amount
        },
        priority: 'medium',
        action: {
          label: 'View Loan',
          route: `/guarantor/loan-details/${loan._id}`,
          data: { loanId: loan._id }
        }
      });
    }
  } catch (error) {
    console.error("Error in payment received notification:", error);
  }
};

/**
 * Notify about overdue payment
 */
exports.notifyPaymentOverdue = async (loan, installment) => {
  try {
    const daysOverdue = installment.daysOverdue || 
      Math.ceil((new Date() - new Date(installment.dueDate)) / (1000 * 60 * 60 * 24));
    
    const severity = daysOverdue > 30 ? 'critical' : 'high';
    const borrower = await User.findById(loan.borrower.id).select('name');
    
    // Notify borrower
    await exports.createNotification({
      userId: loan.borrower.id,
      userRole: 'borrower',
      type: 'payment_overdue',
      title: '⚠️ Payment Overdue',
      message: `Your payment of ${formatCurrency(installment.amount)} for loan ${loan.loanId} is ${daysOverdue} days overdue.`,
      data: { 
        loanId: loan._id, 
        loanDisplayId: loan.loanId,
        installmentNo: installment.installmentNo,
        amount: installment.amount,
        dueDate: installment.dueDate,
        daysOverdue
      },
      priority: severity,
      action: {
        label: 'Pay Now',
        route: '/payments',
        data: { loanId: loan._id, amount: installment.amount }
      }
    });

    // Notify guarantor of overdue
    if (loan.guarantor?.id) {
      await exports.createNotification({
        userId: loan.guarantor.id,
        userRole: 'guarantor',
        type: 'payment_overdue',
        title: '⚠️ Payment Overdue Alert',
        message: `The loan you guaranteed for ${borrower?.name || 'a borrower'} is ${daysOverdue} days overdue (${formatCurrency(installment.amount)}).`,
        data: { 
          loanId: loan._id, 
          loanDisplayId: loan.loanId,
          borrowerName: borrower?.name || 'Borrower',
          amount: installment.amount,
          daysOverdue
        },
        priority: 'critical',
        action: {
          label: 'View Details',
          route: `/guarantor/loan-details/${loan._id}`,
          data: { loanId: loan._id }
        }
      });
    }
  } catch (error) {
    console.error("Error in overdue notification:", error);
  }
};

/**
 * Notify about payment reminder (before due date)
 */
exports.notifyPaymentReminder = async (loan, installment) => {
  try {
    const daysUntilDue = Math.ceil((new Date(installment.dueDate) - new Date()) / (1000 * 60 * 60 * 24));
    
    if (daysUntilDue <= 0) return; // Already overdue, handled by overdue notification
    
    await exports.createNotification({
      userId: loan.borrower.id,
      userRole: 'borrower',
      type: 'payment_reminder',
      title: 'Payment Reminder',
      message: `Your payment of ${formatCurrency(installment.amount)} for loan ${loan.loanId} is due in ${daysUntilDue} days.`,
      data: { 
        loanId: loan._id, 
        loanDisplayId: loan.loanId,
        installmentNo: installment.installmentNo,
        amount: installment.amount,
        dueDate: installment.dueDate,
        daysUntilDue
      },
      priority: daysUntilDue <= 3 ? 'high' : 'medium',
      action: {
        label: 'Pay Now',
        route: '/payments',
        data: { loanId: loan._id, amount: installment.amount }
      }
    });
  } catch (error) {
    console.error("Error in payment reminder notification:", error);
  }
};

/**
 * Notify about risk level change
 */
exports.notifyRiskLevelChange = async (loan, oldRisk, newRisk) => {
  try {
    const borrower = await User.findById(loan.borrower.id).select('name');
    
    // Notify borrower
    await exports.createNotification({
      userId: loan.borrower.id,
      userRole: 'borrower',
      type: 'risk_alert',
      title: 'Risk Assessment Update',
      message: `Your loan risk level has changed from ${oldRisk?.toUpperCase()} to ${newRisk?.toUpperCase()}.`,
      data: { 
        loanId: loan._id, 
        loanDisplayId: loan.loanId,
        oldRisk,
        newRisk
      },
      priority: newRisk === 'critical' ? 'critical' : 'high',
      action: {
        label: 'View Details',
        route: `/loan-details/${loan._id}`,
        data: { loanId: loan._id }
      }
    });

    // Notify guarantor of risk change for high/critical risks
    if (loan.guarantor?.id && ['high', 'critical'].includes(newRisk)) {
      await exports.createNotification({
        userId: loan.guarantor.id,
        userRole: 'guarantor',
        type: 'risk_alert',
        title: '⚠️ Risk Alert',
        message: `The loan you're guaranteeing for ${borrower?.name || 'a borrower'} has changed to ${newRisk?.toUpperCase()} risk level.`,
        data: { 
          loanId: loan._id, 
          loanDisplayId: loan.loanId,
          borrowerName: borrower?.name || 'Borrower',
          riskLevel: newRisk
        },
        priority: newRisk === 'critical' ? 'critical' : 'high',
        action: {
          label: 'Review Risk',
          route: `/guarantor/loan-details/${loan._id}`,
          data: { loanId: loan._id }
        }
      });
    }
  } catch (error) {
    console.error("Error in risk change notification:", error);
  }
};

/**
 * Notify about guarantor confirmation
 */
exports.notifyGuarantorConfirmed = async (loan) => {
  try {
    await exports.createNotification({
      userId: loan.borrower.id,
      userRole: 'borrower',
      type: 'guarantor_confirmed',
      title: 'Guarantor Confirmed',
      message: `${loan.guarantor.name} has confirmed their role as your guarantor.`,
      data: { 
        loanId: loan._id, 
        loanDisplayId: loan.loanId,
        guarantorName: loan.guarantor.name
      },
      priority: 'high',
      action: {
        label: 'View Loan',
        route: `/loan-details/${loan._id}`,
        data: { loanId: loan._id }
      }
    });
  } catch (error) {
    console.error("Error in guarantor confirmed notification:", error);
  }
};

// ==================== HELPER FUNCTIONS ====================

/**
 * Helper function to format currency
 */
function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0
  }).format(amount);
}

/**
 * Helper function to get time ago string
 */
function getTimeAgo(date) {
  const now = new Date();
  const diff = now - new Date(date);
  
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  
  if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  return 'Just now';
}