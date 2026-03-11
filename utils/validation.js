// Helper to validate loan creation
exports.validateLoanData = (data) => {
  const errors = [];

  if (!data.borrowerId) {
    errors.push("Borrower ID is required");
  }

  if (!data.amount || data.amount < 100) {
    errors.push("Loan amount must be at least 100");
  }

  if (data.interestRate === undefined || data.interestRate < 0 || data.interestRate > 100) {
    errors.push("Interest rate must be between 0 and 100");
  }

  if (!data.term || data.term < 1) {
    errors.push("Loan term must be at least 1 month");
  }

  const validPurposes = ['business', 'personal', 'education', 'emergency', 'agriculture', 'other'];
  if (data.purpose && !validPurposes.includes(data.purpose)) {
    errors.push("Invalid loan purpose");
  }

  return errors;
};

// Generate unique loan ID
exports.generateLoanId = async () => {
  const year = new Date().getFullYear();
  const random = Math.floor(1000 + Math.random() * 9000);
  return `LN-${year}-${random}`;
};