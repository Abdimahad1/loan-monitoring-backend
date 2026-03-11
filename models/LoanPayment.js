const mongoose = require('mongoose');

const LoanPaymentSchema = new mongoose.Schema(
{
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },

  loanId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Loan',
    required: true,
    index: true
  },

  loanId_display: {
    type: String,
    required: true
  },

  amount: {
    type: Number,
    required: true,
    min: 0.01
  },

  paymentMethod: {
    type: String,
    enum: ['EVC Plus', 'E-Dahab'],
    required: true
  },

  phoneNumber: {
    type: String,
    required: true,
    validate: {
      validator: function (v) {
        return /^252(6|68)\d{7,8}$/.test(v);
      },
      message: props => `${props.value} is not a valid Somali phone number`
    }
  },

  transactionId: {
    type: String,
    unique: true,
    sparse: true
  },

  invoiceId: {
    type: String,
    required: true,
    unique: true
  },

  referenceId: {
    type: String
  },

  status: {
    type: String,
    enum: ['pending', 'success', 'failed'],
    default: 'pending',
    index: true
  },

  waafiResponse: {
    type: mongoose.Schema.Types.Mixed
  },

  metadata: {
    type: Map,
    of: String,
    default: () => new Map()
  },

  processedAt: {
    type: Date
  }

},
{
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
}
);


// Compound indexes
LoanPaymentSchema.index({ userId: 1, createdAt: -1 });
LoanPaymentSchema.index({ loanId: 1, status: 1 });
LoanPaymentSchema.index({ status: 1, createdAt: -1 });


// Pre-save middleware
LoanPaymentSchema.pre('save', function () {

  // Generate transactionId if missing
  if (!this.transactionId) {
    this.transactionId = `TXN-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  }

  // Ensure metadata exists as Map
  if (!this.metadata) {
    this.metadata = new Map();
  }

});


// Pre-validate middleware
LoanPaymentSchema.pre('validate', function () {

  if (!this.metadata) {
    this.metadata = new Map();
  }

});


module.exports = mongoose.model('LoanPayment', LoanPaymentSchema);