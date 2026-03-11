const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

// Define document schema first before using it
const documentSchema = new mongoose.Schema({
  name: String,
  url: String,
  type: String,
  size: Number,
  uploadedAt: { type: Date, default: Date.now }
}, { _id: false, strict: false });

const userSchema = new mongoose.Schema(
{
  name: {
    type: String,
    required: [true, "Name is required"],
    trim: true,
    minlength: 2,
    maxlength: 50
  },

  email: {
    type: String,
    required: [true, "Email is required"],
    unique: true, // This creates the index automatically
    lowercase: true,
    trim: true,
    match: [/^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,})+$/, "Invalid email"]
  },

  phone: {
    type: String,
    required: [true, "Phone is required"],
    unique: true, // This creates the index automatically
    match: [/^\+?[1-9]\d{1,14}$/, "Invalid phone number"]
  },

  password: {
    type: String,
    required: [true, "Password is required"],
    minlength: 6,
    select: false
  },

  role: {
    type: String,
    enum: ['super_admin', 'admin', 'loan_officer', 'borrower', 'guarantor'],
    default: 'borrower',
    required: true
  },

  roleLevel: {
    type: Number,
    default: function () {
      const levels = {
        super_admin: 100,
        admin: 80,
        loan_officer: 60,
        borrower: 40,
        guarantor: 20
      };
      return levels[this.role] || 0;
    }
  },

  isActive: {
    type: Boolean,
    default: true
  },

  isVerified: {
    type: Boolean,
    default: false
  },

  profile: {
    dateOfBirth: Date,
    address: String,
    city: String,
    country: { type: String, default: 'Somalia' },
    occupation: String,
    income: Number,
    idNumber: { 
      type: String,
      sparse: true,
      unique: true, // This creates the index automatically
      trim: true
    },
    idType: {
      type: String,
      enum: ['national_id', 'passport', 'drivers_license']
    },
    idFrontImage: documentSchema,
    idBackImage: documentSchema,
    businessName: String,
    businessType: String,
    businessRegistration: String,
    businessLicense: documentSchema
  },

  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  },

  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  },

  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  },

  loanStats: {
    totalLoans: { type: Number, default: 0 },
    activeLoans: { type: Number, default: 0 },
    completedLoans: { type: Number, default: 0 },
    defaultedLoans: { type: Number, default: 0 },
    totalBorrowed: { type: Number, default: 0 },
    totalRepaid: { type: Number, default: 0 }
  },

  lastLogin: Date,
  lastLoginIP: String,
  loginAttempts: { type: Number, default: 0 },
  lockUntil: Date,
  passwordChangedAt: Date,
  refreshToken: String,

  deletedAt: Date,
  deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  reasonForDeletion: String

},
{ timestamps: true }
);

// REMOVED: Duplicate index definitions
// userSchema.index({ email: 1 }, { unique: true });
// userSchema.index({ phone: 1 }, { unique: true });
// userSchema.index({ 'profile.idNumber': 1 }, { 
//   unique: true, 
//   sparse: true,
//   partialFilterExpression: { 'profile.idNumber': { $exists: true, $ne: null } }
// });

/* ================= PRE-SAVE MIDDLEWARE ================= */

userSchema.pre("save", async function () {

  // Ensure only one super_admin
  if (this.role === "super_admin" && this.isNew) {
    const existing = await mongoose.model("User").findOne({
      role: "super_admin",
      _id: { $ne: this._id }
    });

    if (existing) {
      throw new Error("Super Admin already exists.");
    }
  }

  // Hash password only if modified
  if (this.isModified("password")) {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    this.passwordChangedAt = Date.now() - 1000;
  }

  // If this is a new user or idNumber is modified, check for duplicates
  if (this.isModified('profile.idNumber') && this.profile?.idNumber) {
    const existingUser = await mongoose.model("User").findOne({
      'profile.idNumber': this.profile.idNumber,
      _id: { $ne: this._id }
    });
    
    if (existingUser) {
      throw new Error(`National ID ${this.profile.idNumber} is already registered to another user`);
    }
  }
});

/* ================= INSTANCE METHODS ================= */

userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.isLocked = function () {
  return !!(this.lockUntil && this.lockUntil > Date.now());
};

userSchema.methods.incLoginAttempts = async function () {

  // If lock expired, reset
  if (this.lockUntil && this.lockUntil < Date.now()) {
    this.loginAttempts = 1;
    this.lockUntil = undefined;
  } else {
    this.loginAttempts += 1;
  }

  // Lock after 5 attempts
  if (this.loginAttempts >= 5 && !this.isLocked()) {
    this.lockUntil = Date.now() + (1 * 60 * 1000); // 1 minute lock
  }

  await this.save();
};

userSchema.methods.resetLoginAttempts = async function () {
  this.loginAttempts = 0;
  this.lockUntil = undefined;
  await this.save();
};

userSchema.methods.canManage = function (targetUser) {

  if (this.role === "super_admin") {
    return this._id.toString() !== targetUser._id.toString();
  }

  if (this.role === "admin") {
    return ["loan_officer", "borrower", "guarantor"].includes(targetUser.role);
  }

  return false;
};

/* ================= MODEL EXPORT ================= */

const User = mongoose.model("User", userSchema);
module.exports = User;