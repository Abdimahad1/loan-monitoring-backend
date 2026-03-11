const User = require("../models/User");
const bcrypt = require("bcryptjs");

// @desc    Get all users with filters and pagination
// @route   GET /api/users
// @access  Private (Admin+)
exports.getUsers = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      search = "", 
      role, 
      status,
      sortBy = "createdAt",
      sortOrder = "desc"
    } = req.query;

    const query = { deletedAt: null }; // Exclude soft-deleted users

    // Role-based filtering
    if (req.user.role === "admin") {
      // Admin can only see lower roles
      query.role = { $in: ["borrower", "guarantor"] };
    }

    // Search functionality
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { phone: { $regex: search, $options: "i" } }
      ];
    }

    // Role filter
    if (role && role !== "all") {
      query.role = role;
    }

    // Status filter
    if (status && status !== "all") {
      query.isActive = status === "active";
    }

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === "desc" ? -1 : 1;

    const users = await User.find(query)
      .select("-password -loginAttempts -lockUntil -refreshToken")
      .populate("createdBy", "name email role")
      .populate("updatedBy", "name email role")
      .populate("assignedTo", "name email role")
      .sort(sortOptions)
      .skip(skip)
      .limit(parseInt(limit));

    const total = await User.countDocuments(query);

    // Get statistics
    const stats = {
      total: await User.countDocuments({ deletedAt: null }),
      active: await User.countDocuments({ isActive: true, deletedAt: null }),
      borrowers: await User.countDocuments({ role: "borrower", deletedAt: null }),
      guarantors: await User.countDocuments({ role: "guarantor", deletedAt: null }),
      admins: await User.countDocuments({ role: "admin", deletedAt: null }),
    };

    res.status(200).json({
      success: true,
      data: users,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      },
      stats
    });

  } catch (error) {
    console.error("Get users error:", error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get single user by ID
// @route   GET /api/users/:id
// @access  Private (Admin+)
exports.getUserById = async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select("-password -loginAttempts -lockUntil -refreshToken")
      .populate("createdBy", "name email role")
      .populate("updatedBy", "name email role")
      .populate("assignedTo", "name email role")
      .populate("deletedBy", "name email role");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    // Check if user has permission to view this user
    if (!req.user.canManage(user) && req.user.role !== "super_admin") {
      return res.status(403).json({
        success: false,
        message: "You don't have permission to view this user"
      });
    }

    res.status(200).json({
      success: true,
      data: user
    });

  } catch (error) {
    console.error("Get user error:", error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Create new user
// @route   POST /api/users
// @access  Private (Admin+)
exports.createUser = async (req, res) => {
  try {
    const { name, email, phone, password, role, profile, assignedTo } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [{ email: email.toLowerCase() }, { phone }]
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "User with this email or phone already exists"
      });
    }

    // Role-based creation rules
    const allowedCreations = {
      super_admin: ["admin",  "borrower", "guarantor"],
      admin: ["borrower", "guarantor"]
    };

    // Check if creator has permission
    if (!allowedCreations[req.user.role]?.includes(role)) {
      return res.status(403).json({
        success: false,
        message: `You don't have permission to create ${role} users`
      });
    }

    // Additional validation for admin creation
    if (role === "admin" && req.user.role !== "super_admin") {
      return res.status(403).json({
        success: false,
        message: "Only Super Admin can create admins"
      });
    }

    // GENERATE TEMPORARY PASSWORD if not provided
    const tempPassword = password || generateTempPassword();
    
    // Create user with the password (will be hashed by pre-save hook)
    const user = await User.create({
      name,
      email: email.toLowerCase(),
      phone,
      password: tempPassword, // This will be hashed automatically
      role,
      profile: profile || {},
      createdBy: req.user.id,
      isVerified: true, // Admin created = verified
      assignedTo
    });

    // Remove sensitive data from response
    user.password = undefined;

    // SEND WELCOME EMAIL with temporary password
    try {
      await sendWelcomeEmail({
        email: user.email,
        name: user.name,
        role: user.role,
        tempPassword: tempPassword, // Send the plain text password
        loginUrl: `${process.env.FRONTEND_URL}/login`
      });
      console.log(`✅ Welcome email sent to ${user.email}`);
    } catch (emailError) {
      console.error('❌ Failed to send welcome email:', emailError);
      // Don't fail the user creation if email fails
      // Just log it and continue
    }

    res.status(201).json({
      success: true,
      message: "User created successfully",
      data: user
    });

  } catch (error) {
    console.error("Create user error:", error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Helper function to generate temporary password
function generateTempPassword() {
  const length = 8;
  const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
  let password = '';
  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * charset.length);
    password += charset[randomIndex];
  }
  return password;
}

// @desc    Update user
// @route   PUT /api/users/:id
// @access  Private (Admin+)
exports.updateUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    // Check permission
    if (!req.user.canManage(user) && req.user.role !== "super_admin") {
      return res.status(403).json({
        success: false,
        message: "You don't have permission to update this user"
      });
    }

    // Fields that can be updated
    const allowedUpdates = [
      "name", "phone", "profile", "isActive", "assignedTo"
    ];

    // Only super_admin can update role
    if (req.user.role === "super_admin" && req.body.role) {
      allowedUpdates.push("role");
    }

    const updates = {};
    allowedUpdates.forEach(field => {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    });

    // Add updater info
    updates.updatedBy = req.user.id;

    const updatedUser = await User.findByIdAndUpdate(
      req.params.id,
      updates,
      { new: true, runValidators: true }
    ).select("-password");

    res.status(200).json({
      success: true,
      message: "User updated successfully",
      data: updatedUser
    });

  } catch (error) {
    console.error("Update user error:", error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Delete user (soft delete)
// @route   DELETE /api/users/:id
// @access  Private (Super Admin only)
exports.deleteUser = async (req, res) => {
  try {
    if (req.user.role !== "super_admin") {
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

    // Get reason from query params or body
    const reason = req.query.reason || req.body?.reason || "No reason provided";

    // Soft delete
    user.isActive = false;
    user.deletedAt = Date.now();
    user.deletedBy = req.user.id;
    user.reasonForDeletion = reason;
    await user.save();

    res.status(200).json({
      success: true,
      message: "User deleted successfully"
    });

  } catch (error) {
    console.error("Delete user error:", error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Restore deleted user
// @route   PUT /api/users/:id/restore
// @access  Private (Super Admin only)
exports.restoreUser = async (req, res) => {
  try {
    if (req.user.role !== "super_admin") {
      return res.status(403).json({
        success: false,
        message: "Only Super Admin can restore users"
      });
    }

    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    user.isActive = true;
    user.deletedAt = undefined;
    user.deletedBy = undefined;
    user.reasonForDeletion = undefined;
    await user.save();

    res.status(200).json({
      success: true,
      message: "User restored successfully"
    });

  } catch (error) {
    console.error("Restore user error:", error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Bulk create users
// @route   POST /api/users/bulk
// @access  Private (Super Admin only)
exports.bulkCreateUsers = async (req, res) => {
  try {
    if (req.user.role !== "super_admin") {
      return res.status(403).json({
        success: false,
        message: "Only Super Admin can bulk create users"
      });
    }

    const { users } = req.body;

    if (!Array.isArray(users) || users.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Please provide an array of users"
      });
    }

    const results = {
      success: [],
      failed: []
    };

    for (const userData of users) {
      try {
        // Check if user exists
        const existing = await User.findOne({
          $or: [
            { email: userData.email.toLowerCase() },
            { phone: userData.phone }
          ]
        });

        if (existing) {
          results.failed.push({
            ...userData,
            reason: "Email or phone already exists"
          });
          continue;
        }

        // Create user
        const user = await User.create({
          ...userData,
          email: userData.email.toLowerCase(),
          createdBy: req.user.id,
          isVerified: true
        });

        user.password = undefined;
        results.success.push(user);
      } catch (error) {
        results.failed.push({
          ...userData,
          reason: error.message
        });
      }
    }

    res.status(201).json({
      success: true,
      message: `Created ${results.success.length} users, ${results.failed.length} failed`,
      data: results
    });

  } catch (error) {
    console.error("Bulk create error:", error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};
// @desc    Check if National ID exists
// @route   POST /api/users/check-national-id
// @access  Private
exports.checkNationalId = async (req, res) => {
  try {
    const { nationalId, excludeUserId } = req.body;
    
    if (!nationalId) {
      return res.status(400).json({ 
        success: false, 
        message: 'National ID is required' 
      });
    }

    const query = { 'profile.idNumber': nationalId };
    
    if (excludeUserId) {
      query._id = { $ne: excludeUserId };
    }

    const existingUser = await User.findOne(query).select('name email phone role');

    res.json({
      success: true,
      exists: !!existingUser,
      user: existingUser,
      message: existingUser ? 'National ID already exists' : 'National ID is available'
    });
  } catch (error) {
    console.error('Error checking national ID:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error checking national ID' 
    });
  }
};