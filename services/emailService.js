const nodemailer = require('nodemailer');

// Create transporter
let transporter;

try {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT) || 465,
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    },
    debug: true,
    logger: true
  });

  // Verify connection
  transporter.verify(function(error, success) {
    if (error) {
      console.error('❌ SMTP Connection failed:', error);
    } else {
      console.log('✅ SMTP Server is ready to send emails');
    }
  });
} catch (error) {
  console.error('❌ Failed to create SMTP transporter:', error);
}

/**
 * Send welcome email to new user (borrower or guarantor)
 */
async function sendWelcomeEmail({ 
  email, 
  name, 
  role, 
  tempPassword, // Still received but not shown in email
  loginUrl = 'http://localhost:5173/login'
}) {
  if (!transporter) {
    console.error('❌ SMTP transporter not initialized');
    throw new Error('Email service not configured properly');
  }

  try {
    console.log(`📧 Sending welcome email to: ${email}`);
    
    const roleDisplay = role === 'borrower' ? 'Borrower' : 'Guarantor';
    
    const mailOptions = {
      from: process.env.DEFAULT_FROM_EMAIL || 'jeykhan897@gmail.com',
      to: email,
      subject: `Welcome to Loan Monitoring App - Your ${roleDisplay} Account`,
      html: `
        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
          <!-- Header with gradient -->
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 2rem; color: white; border-radius: 12px 12px 0 0;">
            <h1 style="margin: 0; font-size: 1.8rem; font-weight: 600;">Welcome to Loan Monitoring App!</h1>
            <p style="margin: 0.5rem 0 0; opacity: 0.95; font-size: 1.1rem;">Your ${roleDisplay} Account Has Been Created</p>
          </div>
          
          <!-- Main content -->
          <div style="padding: 2rem; background: white; border-radius: 0 0 12px 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.08);">
            <!-- Welcome message with icon -->
            <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: 2rem; background: #f8f9fa; padding: 1.5rem; border-radius: 10px;">
              <div style="font-size: 3rem; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); width: 70px; height: 70px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white;">
                🎉
              </div>
              <div>
                <h2 style="margin: 0; font-size: 1.4rem; color: #2d3748;">Hello ${name}!</h2>
                <p style="margin: 0.25rem 0 0; color: #718096;">Your account has been created successfully in our system.</p>
              </div>
            </div>
            
            <!-- Account Information Card -->
            <div style="background: #f8f9fa; border-radius: 12px; padding: 1.5rem; margin-bottom: 2rem; border: 1px solid #e2e8f0;">
              <h3 style="margin-top: 0; margin-bottom: 1rem; color: #2d3748; font-size: 1.2rem; display: flex; align-items: center; gap: 0.5rem;">
                <span style="background: #667eea; color: white; width: 24px; height: 24px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 14px;">✓</span>
                Account Details
              </h3>
              <div style="display: grid; gap: 1rem;">
                <div style="display: flex; align-items: center; padding: 0.75rem; background: white; border-radius: 8px;">
                  <div style="width: 80px; font-size: 0.9rem; color: #718096;">Email</div>
                  <div style="flex: 1; font-weight: 600; color: #2d3748; word-break: break-all;">${email}</div>
                </div>
                <div style="display: flex; align-items: center; padding: 0.75rem; background: white; border-radius: 8px;">
                  <div style="width: 80px; font-size: 0.9rem; color: #718096;">Role</div>
                  <div style="flex: 1;">
                    <span style="background: #667eea; color: white; padding: 0.35rem 1rem; border-radius: 20px; font-size: 0.85rem; font-weight: 500;">
                      ${roleDisplay}
                    </span>
                  </div>
                </div>
              </div>
            </div>
            
            <!-- Getting Started Card -->
            <div style="background: #ebf8ff; border-radius: 12px; padding: 1.5rem; margin-bottom: 2rem; border: 1px solid #90cdf4;">
              <h3 style="margin-top: 0; margin-bottom: 1rem; color: #2c5282; font-size: 1.2rem;">🚀 Getting Started</h3>
              <p style="color: #2d3748; margin-bottom: 1rem;">Your account has been created. To access your dashboard:</p>
              <ol style="margin: 0; padding-left: 1.2rem; color: #4a5568; line-height: 1.8;">
                <li>Click the login button below</li>
                <li>Enter your email: <strong>${email}</strong></li>
                <li>Click on <strong>"Forgot Password?"</strong> link</li>
                <li>Follow the instructions to set your password</li>
              </ol>
            </div>
            
            <!-- Important Note -->
            <div style="background: #fff5f5; border-radius: 10px; padding: 1rem; margin-bottom: 2rem; border: 1px solid #feb2b2;">
              <p style="margin: 0; color: #c53030; font-size: 0.95rem; display: flex; align-items: center; gap: 0.5rem;">
                <span style="font-size: 1.2rem;">🔐</span>
                <strong>Security Note:</strong> For your protection, we don't send passwords via email. 
                Please use the "Forgot Password" feature to set your own secure password.
              </p>
            </div>
            
            <!-- CTA Button -->
            <div style="text-align: center; margin: 2rem 0;">
              <a href="${loginUrl}" 
                 style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 1rem 2.5rem; text-decoration: none; border-radius: 50px; font-weight: 600; font-size: 1.1rem; box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);">
                Access Your Dashboard →
              </a>
            </div>
            
            <!-- Support Footer -->
            <div style="border-top: 1px solid #e2e8f0; padding-top: 1.5rem; text-align: center;">
              <p style="margin: 0 0 0.5rem; color: #718096; font-size: 0.9rem;">
                Need help? Our support team is here for you.
              </p>
              <p style="margin: 0; color: #718096; font-size: 0.9rem;">
                <strong>Support Email:</strong> 
                <a href="mailto:${process.env.SUPPORT_EMAIL || 'jeykhan897@gmail.com'}" style="color: #667eea; text-decoration: none;">
                  ${process.env.SUPPORT_EMAIL || 'jeykhan897@gmail.com'}
                </a>
              </p>
            </div>
          </div>
          
          <!-- Footer -->
          <div style="text-align: center; margin-top: 1.5rem; font-size: 0.8rem; color: #a0aec0;">
            <p>© ${new Date().getFullYear()} Loan Monitoring App. All rights reserved.</p>
            <p style="margin-top: 0.25rem;">This is an automated message, please do not reply to this email.</p>
          </div>
        </div>
      `
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('✅ Welcome email sent successfully:', info.messageId);
    return info;
  } catch (err) {
    console.error('❌ Error sending welcome email:', err);
    throw err;
  }
}

/**
 * Send password reset OTP email
 */
async function sendPasswordResetEmail({ email, name, otp }) {
  if (!transporter) {
    console.error('❌ SMTP transporter not initialized');
    throw new Error('Email service not configured properly');
  }

  try {
    console.log(`📧 Sending password reset OTP to: ${email}`);
    
    const mailOptions = {
      from: process.env.DEFAULT_FROM_EMAIL || 'jeykhan897@gmail.com',
      to: email,
      subject: 'Password Reset OTP - Loan Monitoring App',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
          <div style="background: linear-gradient(135deg, #059669, #10b981); padding: 2rem; color: white; border-radius: 8px 8px 0 0;">
            <h1 style="margin: 0; font-size: 1.5rem;">Password Reset Request</h1>
            <p style="margin: 0.5rem 0 0; opacity: 0.9;">Loan Monitoring App</p>
          </div>
          
          <div style="padding: 2rem; background: white; border-radius: 0 0 8px 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
            <p>Hello ${name},</p>
            
            <p>We received a request to reset your password. Use the following OTP code to proceed:</p>
            
            <div style="text-align: center; margin: 30px 0;">
              <div style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #059669; background: #f0fdf4; padding: 15px; border-radius: 10px; display: inline-block; border: 2px dashed #059669;">
                ${otp}
              </div>
            </div>
            
            <p>This code will expire in <strong>10 minutes</strong>.</p>
            
            <p>If you didn't request this, please ignore this email or contact support if you have concerns.</p>
            
            <div style="background: #f8f9fa; border-radius: 8px; padding: 1rem; margin: 1.5rem 0;">
              <p style="margin: 0; color: #666; font-size: 0.9rem;">
                <strong>⚠️ Security Tip:</strong> Never share this OTP with anyone. Our staff will never ask for your OTP.
              </p>
            </div>
            
            <div style="border-top: 1px solid #e5e7eb; padding-top: 1.5rem; text-align: center;">
              <p style="margin: 0 0 0.5rem; color: #6b7280; font-size: 0.9rem;">
                <strong>Support Email:</strong> ${process.env.SUPPORT_EMAIL || 'jeykhan897@gmail.com'}
              </p>
            </div>
          </div>
          
          <div style="text-align: center; margin-top: 2rem; font-size: 0.8rem; color: #999;">
            <p>© ${new Date().getFullYear()} Loan Monitoring App. All rights reserved.</p>
          </div>
        </div>
      `
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('✅ Password reset email sent:', info.messageId);
    return info;
  } catch (error) {
    console.error('❌ Failed to send password reset email:', error);
    throw error;
  }
}

/**
 * Send password reset confirmation email
 */
async function sendPasswordResetConfirmation({ email, name }) {
  if (!transporter) {
    console.error('❌ SMTP transporter not initialized');
    throw new Error('Email service not configured properly');
  }

  try {
    console.log(`📧 Sending password reset confirmation to: ${email}`);
    
    const mailOptions = {
      from: process.env.DEFAULT_FROM_EMAIL || 'jeykhan897@gmail.com',
      to: email,
      subject: 'Password Changed Successfully - Loan Monitoring App',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
          <div style="background: linear-gradient(135deg, #059669, #10b981); padding: 2rem; color: white; border-radius: 8px 8px 0 0;">
            <h1 style="margin: 0; font-size: 1.5rem;">Password Changed Successfully</h1>
          </div>
          
          <div style="padding: 2rem; background: white; border-radius: 0 0 8px 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
            <div style="text-align: center; margin-bottom: 2rem;">
              <div style="font-size: 4rem;">✅</div>
            </div>
            
            <p>Hello ${name},</p>
            
            <p>Your password has been changed successfully.</p>
            
            <p>If you made this change, no further action is needed.</p>
            
            <p>If you didn't make this change, please contact our support team immediately.</p>
            
            <div style="text-align: center; margin: 2rem 0;">
              <a href="${process.env.FRONTEND_URL}/login" 
                 style="display: inline-block; background: #059669; color: white; padding: 1rem 2rem; text-decoration: none; border-radius: 8px; font-weight: bold;">
                Login to Your Account
              </a>
            </div>
            
            <div style="border-top: 1px solid #e5e7eb; padding-top: 1.5rem; text-align: center;">
              <p style="margin: 0; color: #6b7280; font-size: 0.9rem;">
                <strong>Support Email:</strong> ${process.env.SUPPORT_EMAIL || 'jeykhan897@gmail.com'}
              </p>
            </div>
          </div>
        </div>
      `
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('✅ Password reset confirmation email sent:', info.messageId);
    return info;
  } catch (error) {
    console.error('❌ Failed to send confirmation email:', error);
    throw error;
  }
}

module.exports = {
  sendWelcomeEmail,
  sendPasswordResetEmail,
  sendPasswordResetConfirmation,
  transporter // Also export the transporter itself if needed elsewhere
};