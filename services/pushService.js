// services/pushService.js
const admin = require('firebase-admin');
const User = require('../models/User');

// Initialize Firebase Admin SDK
// You'll need to download your service account key from Firebase Console
// Project Settings > Service Accounts > Generate new private key
let serviceAccount;
try {
  // Try to load the service account file
  serviceAccount = require('../config/firebase-service-account.json');
} catch (error) {
  console.error('❌ Firebase service account not found. Push notifications disabled.');
  console.error('   Place firebase-service-account.json in /config folder');
}

if (serviceAccount) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log('✅ Firebase Admin initialized for push notifications');
  } catch (error) {
    console.error('❌ Failed to initialize Firebase Admin:', error.message);
  }
}

/**
 * Send push notification to a specific user
 */
exports.sendPushNotification = async (userId, notification) => {
  try {
    if (!serviceAccount || !admin.apps.length) {
      console.log('📱 Push notifications disabled (no Firebase config)');
      return false;
    }

    // Get user's device tokens
    const user = await User.findById(userId).select('pushTokens');
    if (!user || !user.pushTokens || user.pushTokens.length === 0) {
      console.log(`📱 No device tokens for user ${userId}`);
      return false;
    }

    console.log(`📱 Sending push to user ${userId} (${user.pushTokens.length} devices)`);

    const message = {
      notification: {
        title: notification.title,
        body: notification.message,
      },
      data: {
        type: notification.type || 'general',
        notificationId: notification._id.toString(),
        loanId: notification.data?.loanId || '',
        loanDisplayId: notification.data?.loanDisplayId || '',
        amount: notification.data?.amount?.toString() || '',
        click_action: 'FLUTTER_NOTIFICATION_CLICK',
      },
      android: {
        priority: 'high',
        notification: {
          channelId: 'loan_notifications',
          color: '#10b981',
          sound: 'default',
          priority: 'high',
          visibility: 'public',
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
            'content-available': 1,
          },
        },
        headers: {
          'apns-priority': '10',
        },
      },
      tokens: user.pushTokens,
    };

    // Send to all user's devices
    const response = await admin.messaging().sendEachForMulticast(message);
    
    console.log(`✅ Push sent: ${response.successCount}/${response.responses.length} successful`);
    
    // Remove invalid tokens
    if (response.failureCount > 0) {
      const failedTokens = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          console.log(`❌ Failed token: ${resp.error?.message}`);
          failedTokens.push(user.pushTokens[idx]);
        }
      });
      
      if (failedTokens.length > 0) {
        await User.findByIdAndUpdate(userId, {
          $pull: { pushTokens: { $in: failedTokens } }
        });
        console.log(`🗑️ Removed ${failedTokens.length} invalid tokens`);
      }
    }

    return true;
  } catch (error) {
    console.error('❌ Error sending push notification:', error);
    return false;
  }
};

/**
 * Register device token for a user
 */
exports.registerDeviceToken = async (userId, token, platform = 'flutter') => {
  try {
    const user = await User.findById(userId);
    if (!user) {
      console.log(`❌ User ${userId} not found`);
      return false;
    }

    // Initialize pushTokens array if it doesn't exist
    if (!user.pushTokens) {
      user.pushTokens = [];
    }

    // Add token if not already present
    if (!user.pushTokens.includes(token)) {
      user.pushTokens.push(token);
      await user.save();
      console.log(`✅ Device token registered for user ${userId} (${platform})`);
    } else {
      console.log(`📱 Device token already exists for user ${userId}`);
    }

    return true;
  } catch (error) {
    console.error('❌ Error registering device token:', error);
    return false;
  }
};

/**
 * Unregister device token
 */
exports.unregisterDeviceToken = async (userId, token) => {
  try {
    const result = await User.findByIdAndUpdate(userId, {
      $pull: { pushTokens: token }
    });
    
    if (result) {
      console.log(`✅ Device token removed for user ${userId}`);
      return true;
    }
    return false;
  } catch (error) {
    console.error('❌ Error unregistering device token:', error);
    return false;
  }
};