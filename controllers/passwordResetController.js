const User = require('../models/User');
const Otp = require('../models/Otp');
const { 
  sendWelcomeEmail,
  sendPasswordResetEmail, 
  sendPasswordResetConfirmation 
} = require('../services/emailService');
const crypto = require('crypto');

// Generate 6-digit OTP
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Generate random temporary password
const generateTempPassword = () => {
  return crypto.randomBytes(4).toString('hex'); // 8 characters
};

// @desc    Request password reset OTP
// @route   POST /api/auth/forgot-password
// @access  Public
exports.requestPasswordReset = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    // Find user by email
    const user = await User.findOne({ email: email.toLowerCase() });
    
    // Don't reveal if user exists or not (security)
    if (!user) {
      return res.status(200).json({
        success: true,
        message: 'If your email exists in our system, you will receive an OTP'
      });
    }

    // Check if user is active
    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Account is deactivated. Contact support.'
      });
    }

    // Delete any existing OTPs for this email
    await Otp.deleteMany({ 
      email: email.toLowerCase(), 
      purpose: 'password_reset',
      isUsed: false 
    });

    // Generate new OTP
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Save OTP to database
    await Otp.create({
      email: email.toLowerCase(),
      otp,
      purpose: 'password_reset',
      expiresAt
    });

    // Send OTP via email
    await sendPasswordResetEmail({
      email: email.toLowerCase(),
      name: user.name,
      otp: otp
    });

    res.status(200).json({
      success: true,
      message: 'If your email exists in our system, you will receive an OTP'
    });

  } catch (error) {
    console.error('❌ Request password reset error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process request'
    });
  }
};

// @desc    Verify OTP
// @route   POST /api/auth/verify-otp
// @access  Public
exports.verifyOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Email and OTP are required'
      });
    }

    // Find valid OTP
    const otpRecord = await Otp.findOne({
      email: email.toLowerCase(),
      otp,
      purpose: 'password_reset',
      isUsed: false,
      expiresAt: { $gt: new Date() }
    });

    if (!otpRecord) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired OTP'
      });
    }

    // Increment attempts
    otpRecord.attempts += 1;
    await otpRecord.save();

    // Mark OTP as used
    otpRecord.isUsed = true;
    
    // Generate a temporary token for password reset (valid for 15 minutes)
    const resetToken = crypto.randomBytes(32).toString('hex');
    otpRecord.resetToken = resetToken;
    await otpRecord.save();

    res.status(200).json({
      success: true,
      message: 'OTP verified successfully',
      data: {
        resetToken,
        email: email.toLowerCase()
      }
    });

  } catch (error) {
    console.error('❌ Verify OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify OTP'
    });
  }
};

// @desc    Reset password
// @route   POST /api/auth/reset-password
// @access  Public (with valid reset token)
exports.resetPassword = async (req, res) => {
  try {
    const { email, resetToken, newPassword } = req.body;

    if (!email || !resetToken || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Email, reset token, and new password are required'
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters'
      });
    }

    // Find valid reset token
    const otpRecord = await Otp.findOne({
      email: email.toLowerCase(),
      resetToken,
      purpose: 'password_reset',
      isUsed: true,
      expiresAt: { $gt: new Date(Date.now() - 15 * 60 * 1000) } // Within last 15 minutes
    });

    if (!otpRecord) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired reset token'
      });
    }

    // Find user
    const user = await User.findOne({ email: email.toLowerCase() });
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Update password
    user.password = newPassword;
    await user.save();

    // Delete all OTPs for this email
    await Otp.deleteMany({ email: email.toLowerCase() });

    // Send confirmation email
    await sendPasswordResetConfirmation({
      email: user.email,
      name: user.name
    });

    res.status(200).json({
      success: true,
      message: 'Password reset successfully. You can now login with your new password.'
    });

  } catch (error) {
    console.error('❌ Reset password error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reset password'
    });
  }
};

// @desc    Resend OTP
// @route   POST /api/auth/resend-otp
// @access  Public
exports.resendOTP = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    // Find user
    const user = await User.findOne({ email: email.toLowerCase() });
    
    if (!user) {
      return res.status(200).json({
        success: true,
        message: 'If your email exists, you will receive a new OTP'
      });
    }

    // Delete existing OTPs
    await Otp.deleteMany({ 
      email: email.toLowerCase(), 
      purpose: 'password_reset',
      isUsed: false 
    });

    // Generate new OTP
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    // Save new OTP
    await Otp.create({
      email: email.toLowerCase(),
      otp,
      purpose: 'password_reset',
      expiresAt
    });

    // Send email
    await sendPasswordResetEmail({
      email: email.toLowerCase(),
      name: user.name,
      otp: otp
    });

    res.status(200).json({
      success: true,
      message: 'New OTP sent successfully'
    });

  } catch (error) {
    console.error('❌ Resend OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to resend OTP'
    });
  }
};