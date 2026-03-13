// jobs/notificationJobs.js
const cron = require('node-cron');
const Loan = require('../models/Loan');
const { notifyPaymentReminder, notifyPaymentOverdue } = require('../controllers/notificationController');

// Run every day at 8 AM
cron.schedule('0 8 * * *', async () => {
  console.log('🔔 Running daily notification checks...');
  
  try {
    const today = new Date();
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
    
    // Find all active loans
    const loans = await Loan.find({
      status: { $in: ['active', 'overdue'] },
      isDeleted: false
    }).populate('borrower.id', 'name email')
      .populate('guarantor.id', 'name email');

    for (const loan of loans) {
      for (const installment of loan.schedule) {
        if (installment.status === 'pending') {
          const dueDate = new Date(installment.dueDate);
          const daysUntilDue = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));
          const daysOverdue = Math.ceil((today - dueDate) / (1000 * 60 * 60 * 24));
          
          // Payment reminders (3, 2, 1 days before due)
          if (daysUntilDue > 0 && daysUntilDue <= 3) {
            await notifyPaymentReminder(loan, {
              ...installment.toObject(),
              daysUntilDue
            });
          }
          
          // Overdue notifications
          if (daysOverdue > 0) {
            await notifyPaymentOverdue(loan, {
              ...installment.toObject(),
              daysOverdue
            });
          }
        }
      }
    }
    
    console.log('✅ Daily notification checks completed');
  } catch (error) {
    console.error('❌ Error in notification jobs:', error);
  }
});