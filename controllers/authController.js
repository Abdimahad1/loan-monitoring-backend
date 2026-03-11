const User = require("../models/User");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

// Generate JWT with more secure options
const generateToken = (user) => {
  return jwt.sign(
    {
      id: user._id,
      email: user.email,
      role: user.role,
      roleLevel: user.roleLevel
    },
    process.env.JWT_SECRET,
    { 
      expiresIn: process.env.JWT_EXPIRE || '7d',
      issuer: 'loan-api',
      audience: 'loan-app'
    }
  );
};

// Generate refresh token
const generateRefreshToken = (user) => {
  return jwt.sign(
    { id: user._id },
    process.env.REFRESH_TOKEN_SECRET,
    { expiresIn: '30d' }
  );
};

// @desc    Register (with full role-based restrictions)
// @route   POST /api/auth/register
exports.register = async (req, res) => {
  try {
    const { name, email, phone, password, role, profile } = req.body;

    // 🔒 Check if user exists (case-insensitive)
    const existingUser = await User.findOne({ 
      $or: [
        { email: email.toLowerCase() },
        { phone }
      ] 
    });
    
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "User with this email or phone already exists"
      });
    }

    // 🔒 Role-based creation rules
    const creatorRole = req.user?.role;
    
    // Who can create what?
    const allowedCreations = {
      'super_admin': ['admin', 'borrower', 'guarantor'],
      'admin': ['borrower', 'guarantor'],
      'borrower': [],
      'guarantor': []
    };

    // 🔒 Check if creator has permission (if authenticated)
    if (req.user) {
      if (!allowedCreations[creatorRole]?.includes(role)) {
        return res.status(403).json({
          success: false,
          message: `You don't have permission to create ${role} users`
        });
      }
    }

    // 🔒 Additional validation for different roles
    if (role === 'admin' && creatorRole !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: "Only Super Admin can create admins"
      });
    }

    // Create user
    const user = await User.create({
      name,
      email: email.toLowerCase(),
      phone,
      password,
      role: role || 'borrower',
      profile: profile || {},
      createdBy: req.user?.id,
      isVerified: req.user ? true : false // Admin created = verified
    });

    // Remove sensitive data
    user.password = undefined;
    user.loginAttempts = undefined;
    user.lockUntil = undefined;

    // Log creation (for audit)
    console.log(`✅ User created: ${user.email} (${user.role}) by ${req.user?.email || 'system'}`);

    res.status(201).json({
      success: true,
      message: "User created successfully",
      data: user
    });

  } catch (error) {
    console.error("❌ Register error:", error);
    
    // Handle duplicate key errors
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return res.status(409).json({
        success: false,
        message: `${field} already exists`
      });
    }
    
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Login with enhanced security (SINGLE VERSION)
// @route   POST /api/auth/login
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Please provide email and password"
      });
    }

    // Find user with password field and populate relations
    const user = await User.findOne({ email: email.toLowerCase() })
      .select('+password')
      .populate('createdBy', 'name email role')
      .populate('assignedTo', 'name email role');

    // Generic error message (security through obscurity)
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials"
      });
    }

    // 🔒 Check if account is locked
    if (user.isLocked()) {
      const minutesLeft = Math.ceil((user.lockUntil - Date.now()) / 60000);
      return res.status(423).json({
        success: false,
        message: `Account locked. Try again in ${minutesLeft} minutes`
      });
    }

    // Check if active
    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: "Account deactivated. Contact support."
      });
    }

    // Check password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      // Increment login attempts (don't use await here to avoid blocking)
      user.loginAttempts += 1;
      if (user.loginAttempts >= 5) {
        user.lockUntil = Date.now() + 60 * 1000; // 1 minute
      }
      await user.save();
      
      return res.status(401).json({
        success: false,
        message: "Invalid credentials"
      });
    }

    // Reset login attempts
    user.loginAttempts = 0;
    user.lockUntil = undefined;
    await user.save();

    // Update last login
    user.lastLogin = Date.now();
    user.lastLoginIP = ip;
    await user.save();

    // Generate tokens
    const token = generateToken(user);
    const refreshToken = generateRefreshToken(user);

    // Prepare user data for response
    const userData = {
      id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      roleLevel: user.roleLevel,
      isActive: user.isActive,
      isVerified: user.isVerified,
      profile: user.profile,
      loanStats: user.loanStats,
      lastLogin: user.lastLogin,
      createdAt: user.createdAt,
      createdBy: user.createdBy,
      assignedTo: user.assignedTo
    };

    // Return with role-based redirect
    const redirectMap = {
      'super_admin': '/dashboard',
      'admin': '/dashboard',
      'borrower': '/borrower-dashboard',
      'guarantor': '/guarantor-dashboard'
    };

    res.status(200).json({
      success: true,
      message: "Login successful",
      data: {
        user: userData,
        token,
        refreshToken,
        role: user.role,
        redirect: redirectMap[user.role]
      }
    });

  } catch (error) {
    console.error("❌ Login error:", error);
    res.status(500).json({
      success: false,
      message: "Login failed. Please try again."
    });
  }
};

// @desc    Refresh token
// @route   POST /api/auth/refresh-token
exports.refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    
    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        message: "No refresh token provided"
      });
    }
    
    const decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);
    const user = await User.findById(decoded.id);
    
    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        message: "Invalid refresh token"
      });
    }
    
    const newToken = generateToken(user);
    
    res.status(200).json({
      success: true,
      token: newToken
    });
    
  } catch (error) {
    res.status(401).json({
      success: false,
      message: "Invalid refresh token"
    });
  }
};

// @desc    Get current user
// @route   GET /api/auth/me
exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .populate('createdBy', 'name email role')
      .populate('assignedTo', 'name email role');
      
    res.status(200).json({
      success: true,
      data: user
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Update profile
// @route   PUT /api/auth/profile
exports.updateProfile = async (req, res) => {
  try {
    // Fields that can be updated
    const allowedFields = ['name', 'phone', 'profile'];
    const updates = {};
    
    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    });
    
    const user = await User.findByIdAndUpdate(
      req.user.id,
      updates,
      { new: true, runValidators: true }
    ).select('-password');

    res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      data: user
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Change password
// @route   PUT /api/auth/change-password
exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    
    // Get user with password
    const user = await User.findById(req.user.id).select('+password');
    
    // Check current password
    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Current password is incorrect"
      });
    }
    
    // Update password
    user.password = newPassword;
    await user.save();
    
    // Generate new token
    const token = generateToken(user);
    
    res.status(200).json({
      success: true,
      message: "Password changed successfully",
      token
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get users with role filtering and pagination
// @route   GET /api/auth/users
exports.getUsers = async (req, res) => {
  try {
    const { role, page = 1, limit = 10, search } = req.query;
    const query = {};
    
    // 🔒 Role-based filtering
    if (req.user.role === 'admin') {
      // Admin can only see lower roles
      query.role = { $in: ['borrower', 'guarantor'] };
    } else if (req.user.role === 'super_admin') {
      // Super admin can see all except maybe hide deleted?
      query.isActive = true;
    }
    
    // Additional role filter if provided
    if (role) {
      if (req.user.role === 'admin' && !['borrower', 'guarantor'].includes(role)) {
        return res.status(403).json({
          success: false,
          message: "Cannot view users with that role"
        });
      }
      query.role = role;
    }
    
    // Search functionality
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } }
      ];
    }
    
    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const users = await User.find(query)
      .select('-password -loginAttempts -lockUntil')
      .populate('createdBy', 'name email')
      .populate('assignedTo', 'name email')
      .sort('-createdAt')
      .skip(skip)
      .limit(parseInt(limit));
      
    const total = await User.countDocuments(query);

    res.status(200).json({
      success: true,
      count: users.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      data: users
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Delete user (soft delete - Super Admin only)
// @route   DELETE /api/auth/users/:id
exports.deleteUser = async (req, res) => {
  try {
    // Only Super Admin can delete
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: "Only Super Admin can delete users"
      });
    }
    
    const user = await User.findById(req.params.id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }
    
    // Prevent self-deletion
    if (user._id.toString() === req.user.id) {
      return res.status(400).json({
        success: false,
        message: "Cannot delete yourself"
      });
    }
    
    // Soft delete
    user.isActive = false;
    user.deletedAt = Date.now();
    user.deletedBy = req.user.id;
    user.reasonForDeletion = req.body.reason || "No reason provided";
    await user.save();
    
    res.status(200).json({
      success: true,
      message: "User deleted successfully"
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};