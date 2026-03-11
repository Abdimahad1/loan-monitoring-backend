const mongoose = require("mongoose");
const { randomUUID } = require("crypto");

/* ================= PAYMENT SCHEMA ================= */

const paymentSchema = new mongoose.Schema({
  paymentId: { 
    type: String,
    default: () => `PAY-${randomUUID()}`
  },
  amount: { 
    type: Number, 
    required: true,
    min: 0.01
  },
  date: { 
    type: Date, 
    default: Date.now 
  },
  method: {
    type: String,
    enum: ['cash', 'bank_transfer', 'mobile_money', 'check'],
    required: true
  },
  reference: {
    type: String,
    default: ''
  },
  notes: {
    type: String,
    default: ''
  },
  recordedBy: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User',
    required: true 
  }
}, { 
  timestamps: true,
  _id: true 
});

/* ================= SCHEDULE SCHEMA ================= */

const scheduleSchema = new mongoose.Schema({
  installmentNo: Number,
  dueDate: Date,
  amount: Number,
  principal: Number,
  interest: { type: Number, default: 0 },
  status: { type: String, enum: ['pending', 'paid', 'overdue'], default: 'pending' },
  paidAt: Date
});

/* ================= NOTE SCHEMA ================= */

const noteSchema = new mongoose.Schema({
  text: String,
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now }
});

/* ================= DOCUMENT SCHEMA (Reusable) ================= */

const documentSchema = new mongoose.Schema({
  name: { type: String, required: true },
  url: { type: String, required: true },
  type: { type: String, required: true },
  size: { type: Number, required: true },
  uploadedAt: { type: Date, default: Date.now }
}, { _id: false });

/* ================= COLLATERAL SCHEMA ================= */

const collateralSchema = new mongoose.Schema({
  hasCollateral: { type: Boolean, default: false },
  type: { 
    type: String, 
    enum: ['property', 'vehicle', 'equipment', 'other'],
    required: function() { return this.hasCollateral; }
  },
  value: { 
    type: Number,
    required: function() { return this.hasCollateral; }
  },
  description: String,
  ownershipProof: String,
  ownershipDocs: [documentSchema],
  verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  verifiedAt: Date
}, { _id: false });

/* ================= GUARANTOR SCHEMA ================= */

const guarantorSchema = new mongoose.Schema({
  hasGuarantor: { type: Boolean, default: false },
  id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  name: { 
    type: String,
    required: function() { return this.hasGuarantor && !this.id; }
  },
  relationship: { 
    type: String,
    required: function() { return this.hasGuarantor; }
  },
  phone: { 
    type: String,
    required: function() { return this.hasGuarantor; }
  },
  email: String,
  income: { 
    type: Number,
    required: function() { return this.hasGuarantor; }
  },
  nationalId: { 
    type: String,
    required: function() { return this.hasGuarantor && !this.id; }
  },
  idImage: documentSchema,
  incomeProof: documentSchema,
  agreementSigned: { type: Boolean, default: false },
  agreementDate: Date
}, { _id: false });

/* ================= MAIN LOAN SCHEMA ================= */

const loanSchema = new mongoose.Schema({
  loanId: { type: String, required: true, unique: true },

  borrower: {
    id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: String,
    email: String,
    phone: String,
    nationalId: String,
    address: String,
    employmentType: String,
    monthlyIncome: Number,
    activeLoans: { type: Number, default: 0 },
    creditScore: Number
  },

  amount: { type: Number, required: true },
  interestRate: { type: Number, default: 0 },
  term: { type: Number, required: true },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },

  paymentFrequency: {
    type: String,
    enum: ['weekly', 'biweekly', 'monthly', 'quarterly'],
    default: 'monthly'
  },

  purpose: {
    type: String,
    enum: ['business', 'personal', 'education', 'emergency', 'agriculture', 'other'],
    required: true
  },

  description: String,
  gracePeriod: { type: Number, default: 0 },
  processingFee: { type: Number, default: 0 },
  lateFee: { type: Number, default: 0 },

  financialInfo: {
    monthlyIncome: Number,
    monthlyExpenses: Number,
    existingDebt: Number,
    debtToIncomeRatio: Number,
    disposableIncome: Number,
    loanToValue: Number
  },

  risk: {
    level: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical'],
      default: 'medium'
    },
    score: { type: Number, default: 0 },
    factors: [{
      name: String,
      impact: String,
      description: String
    }],
    recommendation: {
      type: String,
      enum: ['approve', 'approve_with_conditions', 'review', 'decline']
    },
    autoCalculated: { type: Boolean, default: true },
    calculatedAt: Date
  },

  approvalRecommendation: String,
  loanOfficerNotes: String,

  collateral: collateralSchema,
  guarantor: guarantorSchema,

  status: {
    type: String,
    enum: ['draft', 'pending', 'approved', 'rejected', 'active', 'completed', 'overdue', 'defaulted'],
    default: 'pending'
  },

  paidAmount: { type: Number, default: 0 },
  remainingAmount: { type: Number, default: 0 },
  disbursedAmount: { type: Number, default: 0 },

  schedule: [scheduleSchema],
  payments: [paymentSchema],
  notes: [noteSchema],

  rejectionReason: String,

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  approvedAt: Date,
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  isDeleted: { type: Boolean, default: false },
  deletedAt: Date,
  deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }

}, { timestamps: true });

/* ================= UNIQUE INDEX FOR PAYMENT ID ================= */
loanSchema.index(
  { "payments.paymentId": 1 },
  {
    unique: true,
    partialFilterExpression: {
      "payments.paymentId": { $exists: true, $type: "string" }
    }
  }
);

/* ================= RISK METHOD ================= */

loanSchema.methods.calculateRisk = function(borrower = null) {
  const factors = [];
  let score = 0;

  const borrowerData = borrower || this.borrower;
  const monthlyIncome = this.financialInfo?.monthlyIncome || borrowerData?.monthlyIncome || 0;
  const monthlyExpenses = this.financialInfo?.monthlyExpenses || 0;
  const existingDebt = this.financialInfo?.existingDebt || 0;
  const loanAmount = this.amount || 0;

  let monthlyPayment;

  if (this.interestRate > 0) {
    const monthlyRate = this.interestRate / 100 / 12;
    monthlyPayment =
      (loanAmount * monthlyRate * Math.pow(1 + monthlyRate, this.term)) /
      (Math.pow(1 + monthlyRate, this.term) - 1);
  } else {
    monthlyPayment = loanAmount / this.term;
  }

  const totalMonthlyObligations = monthlyExpenses + existingDebt + monthlyPayment;
  const disposableIncome = monthlyIncome - totalMonthlyObligations;

  if (!this.financialInfo) this.financialInfo = {};
  this.financialInfo.disposableIncome = Math.max(0, disposableIncome);

  const dti = monthlyIncome > 0 ? (totalMonthlyObligations / monthlyIncome) * 100 : 100;
  this.financialInfo.debtToIncomeRatio = dti;

  // DTI Factor (30% weight)
  if (dti <= 30) {
    score += 30;
    factors.push({ name: 'debt_to_income', impact: 'positive', description: 'Low DTI ratio' });
  } else if (dti <= 40) {
    score += 25;
    factors.push({ name: 'debt_to_income', impact: 'positive', description: 'Moderate DTI ratio' });
  } else if (dti <= 50) {
    score += 15;
    factors.push({ name: 'debt_to_income', impact: 'negative', description: 'High DTI ratio' });
  } else {
    score += 5;
    factors.push({ name: 'debt_to_income', impact: 'negative', description: 'Very high DTI ratio' });
  }

  // Collateral Factor (25% weight)
  if (this.collateral?.hasCollateral) {
    const collateralValue = this.collateral.value || 0;
    if (collateralValue >= loanAmount * 1.5) {
      score += 25;
      factors.push({ name: 'collateral', impact: 'positive', description: 'Excellent collateral coverage' });
    } else if (collateralValue >= loanAmount) {
      score += 20;
      factors.push({ name: 'collateral', impact: 'positive', description: 'Good collateral coverage' });
    } else if (collateralValue > 0) {
      score += 15;
      factors.push({ name: 'collateral', impact: 'positive', description: 'Partial collateral coverage' });
    } else {
      score += 10;
      factors.push({ name: 'collateral', impact: 'neutral', description: 'Collateral value not specified' });
    }
  } else {
    score += 0;
    factors.push({ name: 'collateral', impact: 'negative', description: 'No collateral' });
  }

  // Guarantor Factor (25% weight)
  if (this.guarantor?.hasGuarantor) {
    if (this.guarantor.income && this.guarantor.income > monthlyPayment * 2) {
      score += 25;
      factors.push({ name: 'guarantor', impact: 'positive', description: 'Strong guarantor' });
    } else if (this.guarantor.income) {
      score += 20;
      factors.push({ name: 'guarantor', impact: 'positive', description: 'Guarantor provided' });
    } else {
      score += 15;
      factors.push({ name: 'guarantor', impact: 'neutral', description: 'Guarantor information incomplete' });
    }
  } else {
    score += 0;
    factors.push({ name: 'guarantor', impact: 'neutral', description: 'No guarantor' });
  }

  // Credit Score Factor (20% weight)
  const creditScore = borrowerData?.creditScore || 0;
  if (creditScore >= 750) {
    score += 20;
    factors.push({ name: 'credit_score', impact: 'positive', description: 'Excellent credit' });
  } else if (creditScore >= 650) {
    score += 15;
    factors.push({ name: 'credit_score', impact: 'positive', description: 'Good credit' });
  } else if (creditScore >= 550) {
    score += 10;
    factors.push({ name: 'credit_score', impact: 'neutral', description: 'Fair credit' });
  } else if (creditScore > 0) {
    score += 5;
    factors.push({ name: 'credit_score', impact: 'negative', description: 'Poor credit' });
  } else {
    score += 8;
    factors.push({ name: 'credit_score', impact: 'neutral', description: 'No credit history' });
  }

  // Determine risk level
  let riskLevel = 'medium';
  if (score >= 70) {
    riskLevel = 'low';
  } else if (score >= 50) {
    riskLevel = 'medium';
  } else if (score >= 30) {
    riskLevel = 'high';
  } else {
    riskLevel = 'critical';
  }

  // Auto recommendation
  let recommendation = 'review';
  if (riskLevel === 'low') {
    recommendation = 'approve';
  } else if (riskLevel === 'medium') {
    recommendation = 'approve_with_conditions';
  } else if (riskLevel === 'critical') {
    recommendation = 'decline';
  }

  this.risk = {
    level: riskLevel,
    score: Math.round(score),
    factors: factors.slice(0, 5),
    recommendation,
    autoCalculated: true,
    calculatedAt: new Date()
  };

  if (!this.approvalRecommendation) {
    this.approvalRecommendation = recommendation;
  }

  return this.risk;
};

/* ================= STATUS METHOD ================= */

loanSchema.methods.updateStatus = function() {
  const now = new Date();

  if (this.status === 'completed') return;

  if (this.paidAmount >= this.amount) {
    this.status = 'completed';
    return;
  }

  if (this.schedule && this.schedule.length > 0) {
    const hasOverdue = this.schedule.some(s =>
      s.status === 'pending' && new Date(s.dueDate) < now
    );

    if (hasOverdue && this.status === 'active') {
      this.status = 'overdue';
    }
  }
};

/* ================= PRE SAVE HOOK ================= */

loanSchema.pre('save', async function () {
  // Calculate risk if relevant fields changed
  if (
    this.isModified('financialInfo') ||
    this.isModified('amount') ||
    this.isModified('interestRate') ||
    this.isModified('term') ||
    this.isModified('collateral') ||
    this.isModified('guarantor')
  ) {
    this.calculateRisk();
  }

  // Update remaining amount safely
  const paid = this.paidAmount || 0;
  const amount = this.amount || 0;
  this.remainingAmount = amount - paid;
});

const Loan = mongoose.model("Loan", loanSchema);

module.exports = Loan;