const mongoose = require('mongoose');
const LoanPayment = require('../models/LoanPayment');
const Loan = require('../models/Loan');
const User = require('../models/User');
const { processWaafiPayPayment, isPaymentSuccessful, formatPhone } = require('../services/waafiPayService');

// Import notification function
const { notifyPaymentReceived } = require("./notificationController");

/**
 * Process a loan payment with proper installment tracking
 */
exports.processLoanPayment = async (req, res) => {
  try {
    const {
      loanId,
      amount,
      paymentMethod,
      phoneNumber,
      invoiceId
    } = req.body;

    const userId = req.userId || req.user?._id;

    // ========== VALIDATION ==========
    if (!loanId || !amount || !paymentMethod || !phoneNumber || !invoiceId) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields'
      });
    }

    if (!['EVC Plus', 'E-Dahab'].includes(paymentMethod)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid payment method. Only EVC Plus and E-Dahab are supported.'
      });
    }

    if (paymentMethod === 'E-Dahab') {
      return res.status(400).json({
        success: false,
        message: 'E-Dahab payments are coming soon. Please use EVC Plus.'
      });
    }

    const formattedPhone = formatPhone(phoneNumber);
    const isValidPhone = /^252(6|68)\d{7,8}$/.test(formattedPhone);
    if (!isValidPhone) {
      return res.status(400).json({
        success: false,
        message: 'Invalid phone number format. Must be a valid Somali number starting with 2526 or 25268'
      });
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Amount must be greater than 0'
      });
    }

    // Check for duplicate invoice
    const duplicate = await LoanPayment.findOne({ invoiceId }).lean();
    if (duplicate) {
      return res.status(409).json({
        success: false,
        message: 'Duplicate payment detected',
        data: duplicate
      });
    }

    // ========== FIND LOAN ==========
    console.log(`🔍 Searching for loan: ${loanId} for user: ${userId}`);
    
    const loan = await Loan.findOne({ 
      _id: loanId, 
      'borrower.id': userId
    });

    if (!loan) {
      console.log(`❌ Loan not found: ID=${loanId}, UserID=${userId}`);
      
      const anyLoan = await Loan.findById(loanId).lean();
      if (anyLoan) {
        console.log('Loan exists but belongs to different user:', {
          loanId: anyLoan._id,
          loanBorrowerId: anyLoan.borrower?.id?.toString(),
          requestUserId: userId?.toString()
        });
      }
      
      return res.status(404).json({
        success: false,
        message: 'Loan not found or does not belong to you'
      });
    }

    console.log(`✅ Loan found: ${loan.loanId} belongs to user ${userId}`);

    // ========== LOAN STATUS CHECKS ==========
    if (loan.status !== 'active' && loan.status !== 'overdue') {
      return res.status(400).json({
        success: false,
        message: `Cannot pay for loan with status: ${loan.status}. Only active or overdue loans can be paid.`
      });
    }

    if (loan.paidAmount >= loan.amount) {
      return res.status(400).json({
        success: false,
        message: 'This loan is already fully paid'
      });
    }

    // ========== INSTALLMENT VALIDATION ==========
    const expectedInstallment = loan.installmentAmount || (loan.amount / loan.term);
    
    if (Math.abs(parsedAmount - expectedInstallment) > 0.01) {
      return res.status(400).json({
        success: false,
        message: `Payment amount must be exactly ${expectedInstallment.toFixed(2)} (your next installment)`
      });
    }

    // Find the next pending installment
    const pendingInstallments = loan.schedule?.filter(inst => inst.status === 'pending') || [];
    if (pendingInstallments.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No pending installments found for this loan'
      });
    }

    // Sort by due date to ensure we pay the oldest first
    pendingInstallments.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
    const installmentToPay = pendingInstallments[0];
    const installmentIndex = loan.schedule.findIndex(inst => inst._id.toString() === installmentToPay._id.toString());
    const installmentNumber = installmentToPay.installmentNo || (installmentIndex + 1);

    // ========== PROCESS WAAFI PAYMENT ==========
    console.log('🔁 Processing loan payment through WaafiPay...');
    
    const waafiResponse = await processWaafiPayPayment({
      phone: formattedPhone,
      amount: parsedAmount,
      invoiceId,
      description: `Loan Payment - ${loan.loanId} (Installment #${installmentNumber})`,
      paymentMethod
    });

    console.log('📨 WaafiPay response received');

    const paymentSuccessful = isPaymentSuccessful(waafiResponse);

    // ========== CREATE PAYMENT RECORD ==========
    const paymentData = {
      userId,
      loanId,
      loanId_display: loan.loanId,
      amount: parsedAmount,
      paymentMethod,
      phoneNumber: formattedPhone,
      invoiceId,
      referenceId: waafiResponse?.transactionInfo?.referenceId || 
                  waafiResponse?.params?.orderId || 
                  `ref-${Date.now()}`,
      transactionId: waafiResponse?.transactionInfo?.transactionId || 
                     `TXN-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      status: paymentSuccessful ? 'success' : 'failed',
      waafiResponse: waafiResponse || {},
      processedAt: new Date(),
      metadata: {
        loanId_display: loan.loanId,
        expectedInstallment: expectedInstallment.toString(),
        responseCode: waafiResponse?.responseCode || '',
        errorCode: waafiResponse?.errorCode || '',
        responseMsg: waafiResponse?.responseMsg || '',
        installmentNumber: installmentNumber.toString()
      }
    };

    console.log('📝 Creating payment record with data:', {
      invoiceId: paymentData.invoiceId,
      amount: paymentData.amount,
      status: paymentData.status,
      installmentNumber: installmentNumber
    });

    let payment;
    try {
      payment = await LoanPayment.create(paymentData);
      console.log('✅ Payment record created:', payment._id);
    } catch (dbError) {
      console.error('❌ Database error creating payment:', dbError);
      
      return res.status(500).json({
        success: false,
        message: 'Unable to save payment record. Please try again.',
        error: process.env.NODE_ENV === 'development' ? dbError.message : undefined
      });
    }

    // ========== UPDATE LOAN IF PAYMENT SUCCESSFUL ==========
    let paidInstallmentsCount = 0;
    let remainingInstallments = 0;

    if (paymentSuccessful) {
      try {
        // Update loan paid amount
        const currentPaid = loan.paidAmount || 0;
        const newPaidAmount = currentPaid + parsedAmount;
        
        // Mark the specific installment as paid
        loan.schedule[installmentIndex].status = 'paid';
        loan.schedule[installmentIndex].paidAt = new Date();
        loan.schedule[installmentIndex].paidAmount = parsedAmount;
        loan.schedule[installmentIndex].paymentId = payment._id;
        
        // Count paid and remaining installments
        paidInstallmentsCount = loan.schedule.filter(inst => inst.status === 'paid').length;
        remainingInstallments = loan.schedule.filter(inst => inst.status === 'pending').length;
        
        // Update the loan
        const updateData = {
          $inc: { paidAmount: parsedAmount },
          $set: { schedule: loan.schedule },
          $push: {
            payments: {
              paymentId: payment._id,
              amount: parsedAmount,
              date: new Date(),
              method: paymentMethod,
              status: 'success',
              transactionId: payment.transactionId,
              phoneNumber: formattedPhone,
              invoiceId: invoiceId,
              installmentNo: installmentNumber,
              installmentId: installmentToPay._id
            }
          }
        };

        await Loan.findByIdAndUpdate(loanId, updateData, { new: true });

        // Check if loan is now completed
        if (newPaidAmount >= loan.amount - 0.01) {
          await Loan.findByIdAndUpdate(loanId, { 
            status: 'completed',
            completedAt: new Date()
          });
          console.log(`🎉 Loan ${loan.loanId} has been fully paid and completed after ${paidInstallmentsCount} installments!`);
          
          // Update borrower stats for completed loan
          await User.findByIdAndUpdate(userId, {
            $inc: {
              'loanStats.completedLoans': 1,
              'loanStats.totalRepaid': parsedAmount,
              'loanStats.paidInstallments': 1
            }
          });
        } else {
          // Update borrower stats for partial payment
          await User.findByIdAndUpdate(userId, {
            $inc: {
              'loanStats.totalRepaid': parsedAmount,
              'loanStats.paidInstallments': 1
            }
          });
        }
        
        console.log(`✅ Installment #${installmentNumber} marked as paid. Progress: ${paidInstallmentsCount}/${loan.schedule.length} installments paid`);
        
      } catch (loanUpdateError) {
        console.error('❌ Error updating loan after payment:', loanUpdateError);
        // Don't fail the whole request if loan update fails - payment is already recorded
      }
    }

    // ========== CREATE USER-FRIENDLY MESSAGE ==========
    let userMessage = '';
    if (paymentSuccessful) {
      if (paidInstallmentsCount === loan.schedule.length) {
        userMessage = '🎉 Congratulations! Your loan has been fully paid! Thank you for your timely payments.';
      } else {
        userMessage = `✅ Payment successful! Installment #${installmentNumber} has been paid. Progress: ${paidInstallmentsCount}/${loan.schedule.length} installments completed.`;
      }
    } else {
      const responseMsg = waafiResponse?.responseMsg || '';
      const errorCode = waafiResponse?.errorCode || '';
      
      if (responseMsg.includes('Haraaga xisaabtaadu kuguma filna') || 
          responseMsg.includes('Haraagaagu') ||
          errorCode === 'E10205') {
        userMessage = '❌ Insufficient Balance\n\nYour EVC Plus account does not have enough money. Please:\n• Check your EVC Plus balance\n• Add funds to your account\n• Try again with sufficient balance';
      } else if (responseMsg.includes('Invalid account') || 
                 responseMsg.includes('Invalid phone') ||
                 responseMsg.includes('Account no')) {
        userMessage = '❌ Invalid Phone Number\n\nThe EVC Plus number you entered is not valid. Please:\n• Check the number format (should start with 2526)\n• Make sure the number is active\n• Try again with the correct number';
      } else if (responseMsg.includes('timeout') || 
                 responseMsg.includes('Timeout')) {
        userMessage = '⏱️ Payment Timeout\n\nThe payment request timed out. Please:\n• Check your internet connection\n• Try again in a few moments';
      } else if (responseMsg) {
        let cleanMsg = responseMsg.replace('Payment Failed (', '').replace(')', '');
        if (cleanMsg.includes('Haraaga')) {
          userMessage = '❌ Insufficient Balance\n\nYour EVC Plus account does not have enough money. Please add funds and try again.';
        } else {
          userMessage = `❌ Payment Failed\n\n${cleanMsg}`;
        }
      } else {
        userMessage = '❌ Payment Failed\n\nUnable to process your payment. Please try again later.';
      }
    }

    // ========== SEND NOTIFICATIONS FOR SUCCESSFUL PAYMENT ==========
    if (paymentSuccessful) {
      try {
        console.log('📨 Triggering payment received notifications...');
        
        // Get fresh loan data with populated fields for notifications
        const populatedLoan = await Loan.findById(loanId)
          .populate('borrower.id', 'name email')
          .populate('guarantor.id', 'name email');
        
        await notifyPaymentReceived(payment, populatedLoan);
        console.log('✅ Payment received notifications sent');
      } catch (notifError) {
        console.error('❌ Failed to send payment notifications:', notifError);
        // Don't fail the request if notifications fail
      }
    }

    // ========== CALCULATE REMAINING ==========
    const remainingAmount = loan.amount - (loan.paidAmount + (paymentSuccessful ? parsedAmount : 0));
    const totalInstallments = loan.schedule?.length || 0;

    // Small delay to ensure all DB operations complete
    await new Promise(resolve => setTimeout(resolve, 100));

    // ========== RETURN RESPONSE ==========
    return res.status(paymentSuccessful ? 200 : 400).json({
      success: paymentSuccessful,
      message: userMessage,
      data: {
        paymentId: payment._id,
        transactionId: payment.transactionId,
        invoiceId: payment.invoiceId,
        amount: payment.amount,
        status: payment.status,
        loanId: loan.loanId,
        loanDisplayId: loan.loanId,
        remainingAmount: remainingAmount > 0 ? remainingAmount : 0,
        paidInstallments: paidInstallmentsCount,
        totalInstallments: totalInstallments,
        remainingInstallments: remainingInstallments,
        installmentPaid: installmentNumber,
        paymentMethod: payment.paymentMethod,
        phoneNumber: payment.phoneNumber,
        createdAt: payment.createdAt,
        responseCode: waafiResponse?.responseCode,
        responseMsg: waafiResponse?.responseMsg
      }
    });

  } catch (err) {
    console.error('❌ Payment processing error:', err);
    
    console.error('Full error details:', {
      message: err.message,
      stack: err.stack,
      response: err.response?.data
    });

    return res.status(500).json({
      success: false,
      message: 'Payment processing failed. Please try again.',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

/**
 * Get user's payment history with installment details
 */
exports.getUserPaymentHistory = async (req, res) => {
  try {
    const userId = req.userId || req.user?._id;
    const { page = 1, limit = 20, status } = req.query;

    const query = { userId };
    
    if (status && status !== 'All' && status !== 'all') {
      const statusLower = status.toLowerCase();
      if (statusLower === 'success') {
        query.status = { $in: ['success', 'completed'] };
      } else if (['pending', 'failed'].includes(statusLower)) {
        query.status = statusLower;
      }
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const payments = await LoanPayment.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await LoanPayment.countDocuments(query);

    // Get loan details with installment info for each payment
    const paymentsWithDetails = await Promise.all(
      payments.map(async (payment) => {
        try {
          const loan = await Loan.findById(payment.loanId)
            .select('loanId amount status schedule')
            .lean();
          
          // Find which installment this payment corresponds to
          let installmentInfo = null;
          if (loan?.schedule) {
            const paidInstallment = loan.schedule.find(inst => 
              inst.paymentId?.toString() === payment._id.toString() ||
              (inst.status === 'paid' && 
               Math.abs(inst.amount - payment.amount) < 0.01 &&
               inst.paidAt && 
               new Date(inst.paidAt).toDateString() === new Date(payment.createdAt).toDateString())
            );
            
            if (paidInstallment) {
              installmentInfo = {
                number: paidInstallment.installmentNo,
                dueDate: paidInstallment.dueDate,
                paidAt: paidInstallment.paidAt
              };
            }
          }
          
          return {
            ...payment,
            loanDetails: loan || null,
            installmentInfo
          };
        } catch (error) {
          console.error('Error fetching loan details for payment:', error);
          return {
            ...payment,
            loanDetails: null,
            installmentInfo: null
          };
        }
      })
    );

    return res.json({
      success: true,
      payments: paymentsWithDetails,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });

  } catch (err) {
    console.error('❌ Error fetching payment history:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch payment history',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

/**
 * Get single payment details with installment info
 */
exports.getPaymentDetails = async (req, res) => {
  try {
    const { paymentId } = req.params;
    const userId = req.userId || req.user?._id;

    const payment = await LoanPayment.findOne({ 
      _id: paymentId, 
      userId 
    }).lean();

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    // Get loan details with schedule
    const loan = await Loan.findById(payment.loanId)
      .select('loanId amount status schedule borrower')
      .lean();

    // Find which installment this payment corresponds to
    let installmentInfo = null;
    if (loan?.schedule) {
      const paidInstallment = loan.schedule.find(inst => 
        inst.paymentId?.toString() === payment._id.toString() ||
        (inst.status === 'paid' && 
         Math.abs(inst.amount - payment.amount) < 0.01 &&
         inst.paidAt && 
         new Date(inst.paidAt).toDateString() === new Date(payment.createdAt).toDateString())
      );
      
      if (paidInstallment) {
        installmentInfo = {
          number: paidInstallment.installmentNo,
          dueDate: paidInstallment.dueDate,
          paidAt: paidInstallment.paidAt,
          principal: paidInstallment.principal,
          interest: paidInstallment.interest
        };
      }
    }

    return res.json({
      success: true,
      payment: {
        ...payment,
        loanDetails: loan || null,
        installmentInfo
      }
    });

  } catch (err) {
    console.error('❌ Error fetching payment details:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch payment details',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

/**
 * Get payment statistics for user
 */
exports.getPaymentStats = async (req, res) => {
  try {
    const userId = req.userId || req.user?._id;

    const stats = await LoanPayment.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(userId) } },
      {
        $group: {
          _id: null,
          totalPayments: { $sum: 1 },
          successfulCount: {
            $sum: { $cond: [{ $in: ['$status', ['success', 'completed']] }, 1, 0] }
          },
          pendingCount: {
            $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] }
          },
          failedCount: {
            $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] }
          },
          totalAmount: {
            $sum: { $cond: [{ $in: ['$status', ['success', 'completed']] }, '$amount', 0] }
          }
        }
      }
    ]);

    const result = stats[0] || {
      totalPayments: 0,
      successfulCount: 0,
      pendingCount: 0,
      failedCount: 0,
      totalAmount: 0
    };

    return res.json({
      success: true,
      stats: result
    });

  } catch (err) {
    console.error('❌ Error fetching payment stats:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch payment statistics',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

/**
 * Get loan payment summary with installment progress
 */
exports.getLoanPaymentSummary = async (req, res) => {
  try {
    const { loanId } = req.params;
    const userId = req.userId || req.user?._id;

    const loan = await Loan.findOne({ 
      _id: loanId, 
      'borrower.id': userId 
    }).lean();

    if (!loan) {
      return res.status(404).json({
        success: false,
        message: 'Loan not found'
      });
    }

    const schedule = loan.schedule || [];
    const paidInstallments = schedule.filter(inst => inst.status === 'paid').length;
    const totalInstallments = schedule.length;
    const pendingInstallments = totalInstallments - paidInstallments;
    
    const nextInstallment = schedule.find(inst => inst.status === 'pending');
    
    // Calculate total paid from installments (more accurate than loan.paidAmount)
    const totalPaidFromInstallments = schedule
      .filter(inst => inst.status === 'paid')
      .reduce((sum, inst) => sum + (inst.amount || 0), 0);

    return res.json({
      success: true,
      data: {
        loanId: loan.loanId,
        loanDisplayId: loan.loanId,
        amount: loan.amount,
        paidAmount: totalPaidFromInstallments, // Use installment sum for accuracy
        remainingAmount: loan.amount - totalPaidFromInstallments,
        totalInstallments,
        paidInstallments,
        pendingInstallments,
        progress: totalInstallments > 0 ? (paidInstallments / totalInstallments) * 100 : 0,
        nextInstallment: nextInstallment ? {
          number: nextInstallment.installmentNo,
          amount: nextInstallment.amount,
          dueDate: nextInstallment.dueDate,
          principal: nextInstallment.principal,
          interest: nextInstallment.interest
        } : null,
        lastPayment: schedule
          .filter(inst => inst.status === 'paid')
          .sort((a, b) => new Date(b.paidAt) - new Date(a.paidAt))[0] || null
      }
    });

  } catch (err) {
    console.error('❌ Error fetching loan payment summary:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch loan payment summary',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

/**
 * Get all payments summary for dashboard
 */
exports.getPaymentSummary = async (req, res) => {
  try {
    const userId = req.userId || req.user?._id;

    const summary = await LoanPayment.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(userId) } },
      {
        $facet: {
          totalStats: [
            {
              $group: {
                _id: null,
                totalAmount: { $sum: '$amount' },
                totalCount: { $sum: 1 },
                successfulAmount: {
                  $sum: { $cond: [{ $in: ['$status', ['success', 'completed']] }, '$amount', 0] }
                },
                successfulCount: {
                  $sum: { $cond: [{ $in: ['$status', ['success', 'completed']] }, 1, 0] }
                }
              }
            }
          ],
          monthlyStats: [
            {
              $group: {
                _id: {
                  year: { $year: '$createdAt' },
                  month: { $month: '$createdAt' }
                },
                amount: { $sum: '$amount' },
                count: { $sum: 1 }
              }
            },
            { $sort: { '_id.year': -1, '_id.month': -1 } },
            { $limit: 6 }
          ],
          byMethod: [
            {
              $group: {
                _id: '$paymentMethod',
                count: { $sum: 1 },
                amount: { $sum: '$amount' }
              }
            }
          ]
        }
      }
    ]);

    const result = {
      total: summary[0]?.totalStats[0] || {
        totalAmount: 0,
        totalCount: 0,
        successfulAmount: 0,
        successfulCount: 0
      },
      recentMonths: summary[0]?.monthlyStats || [],
      byMethod: summary[0]?.byMethod || []
    };

    return res.json({
      success: true,
      summary: result
    });

  } catch (err) {
    console.error('❌ Error fetching payment summary:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch payment summary',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

/**
 * Debug endpoint to check loan ownership and installments
 */
exports.debugLoanOwnership = async (req, res) => {
  try {
    const { loanId } = req.params;
    const userId = req.userId || req.user?._id;

    const loan = await Loan.findById(loanId).lean();
    
    if (!loan) {
      return res.status(404).json({
        success: false,
        message: 'Loan not found'
      });
    }

    const schedule = loan.schedule || [];
    const paidInstallments = schedule.filter(inst => inst.status === 'paid').length;
    const pendingInstallments = schedule.filter(inst => inst.status === 'pending').length;

    return res.json({
      success: true,
      debug: {
        loanId: loan._id,
        loanNumber: loan.loanId,
        borrowerId: loan.borrower?.id?.toString(),
        requestUserId: userId?.toString(),
        belongsToUser: loan.borrower?.id?.toString() === userId?.toString(),
        status: loan.status,
        amount: loan.amount,
        paidAmount: loan.paidAmount,
        remainingAmount: loan.amount - (loan.paidAmount || 0),
        expectedInstallment: loan.installmentAmount || (loan.amount / (loan.term || 1)),
        totalInstallments: schedule.length,
        paidInstallments,
        pendingInstallments,
        nextPendingInstallment: schedule.find(inst => inst.status === 'pending') || null,
        lastPaidInstallment: schedule
          .filter(inst => inst.status === 'paid')
          .sort((a, b) => new Date(b.paidAt) - new Date(a.paidAt))[0] || null
      }
    });

  } catch (err) {
    console.error('❌ Debug error:', err.message);
    res.status(500).json({
      success: false,
      message: 'Debug failed',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// In paymentController.js - Add these functions

/**
 * @desc    Get ALL payments (for admin)
 * @route   GET /api/payments/admin/all
 * @access  Private (Admin only)
 */
exports.getAllPayments = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 20, 
      status, 
      fromDate, 
      toDate,
      search,
      loanId,
      userId
    } = req.query;

    const query = {};
    
    // Apply filters
    if (status) query.status = status;
    if (loanId) query.loanId = loanId;
    if (userId) query.userId = userId;
    
    if (fromDate || toDate) {
      query.createdAt = {};
      if (fromDate) query.createdAt.$gte = new Date(fromDate);
      if (toDate) query.createdAt.$lte = new Date(toDate);
    }

    // Search by invoiceId, transactionId, phoneNumber
    if (search) {
      query.$or = [
        { invoiceId: { $regex: search, $options: 'i' } },
        { transactionId: { $regex: search, $options: 'i' } },
        { phoneNumber: { $regex: search, $options: 'i' } },
        { loanId_display: { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const payments = await LoanPayment.find(query)
      .populate('userId', 'name email phone')
      .populate('loanId', 'loanId amount status schedule')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await LoanPayment.countDocuments(query);

    // Get summary stats for filters
    const stats = await LoanPayment.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          totalAmount: { $sum: '$amount' },
          successfulAmount: {
            $sum: { $cond: [{ $eq: ['$status', 'success'] }, '$amount', 0] }
          },
          successCount: {
            $sum: { $cond: [{ $eq: ['$status', 'success'] }, 1, 0] }
          },
          failedCount: {
            $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] }
          },
          pendingCount: {
            $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] }
          }
        }
      }
    ]);

    return res.json({
      success: true,
      data: payments,
      stats: stats[0] || {
        totalAmount: 0,
        successfulAmount: 0,
        successCount: 0,
        failedCount: 0,
        pendingCount: 0
      },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });

  } catch (err) {
    console.error('Error fetching all payments:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch payments'
    });
  }
};

/**
 * @desc    Get overdue summary for admin dashboard
 * @route   GET /api/payments/admin/overdue-summary
 * @access  Private (Admin only)
 */
exports.getOverdueSummary = async (req, res) => {
  try {
    const now = new Date();
    
    // Find all active/overdue loans with pending installments past due
    const loans = await Loan.find({
      status: { $in: ['active', 'overdue'] },
      isDeleted: false
    })
    .select('loanId borrower amount paidAmount schedule status')
    .populate('borrower.id', 'name email phone')
    .lean();

    const overdueSummary = {
      totalOverdue: 0,
      totalOverdueAmount: 0,
      byAge: {
        '1-30': { count: 0, amount: 0 },
        '31-60': { count: 0, amount: 0 },
        '61+': { count: 0, amount: 0 }
      },
      atRisk: {
        high: { count: 0, amount: 0 },
        medium: { count: 0, amount: 0 },
        low: { count: 0, amount: 0 }
      },
      loans: []
    };

    loans.forEach(loan => {
      const pendingInstallments = (loan.schedule || []).filter(inst => 
        inst.status === 'pending' && new Date(inst.dueDate) < now
      );

      if (pendingInstallments.length > 0) {
        const totalOverdueForLoan = pendingInstallments.reduce((sum, inst) => sum + inst.amount, 0);
        const oldestDueDate = new Date(Math.min(...pendingInstallments.map(i => new Date(i.dueDate))));
        const daysOverdue = Math.floor((now - oldestDueDate) / (1000 * 60 * 60 * 24));

        // Categorize by age
        if (daysOverdue <= 30) {
          overdueSummary.byAge['1-30'].count++;
          overdueSummary.byAge['1-30'].amount += totalOverdueForLoan;
        } else if (daysOverdue <= 60) {
          overdueSummary.byAge['31-60'].count++;
          overdueSummary.byAge['31-60'].amount += totalOverdueForLoan;
        } else {
          overdueSummary.byAge['61+'].count++;
          overdueSummary.byAge['61+'].amount += totalOverdueForLoan;
        }

        // Categorize by risk (you can use loan.risk.level if available)
        const riskLevel = loan.risk?.level || 'medium';
        if (riskLevel === 'high' || riskLevel === 'critical') {
          overdueSummary.atRisk.high.count++;
          overdueSummary.atRisk.high.amount += totalOverdueForLoan;
        } else if (riskLevel === 'medium') {
          overdueSummary.atRisk.medium.count++;
          overdueSummary.atRisk.medium.amount += totalOverdueForLoan;
        } else {
          overdueSummary.atRisk.low.count++;
          overdueSummary.atRisk.low.amount += totalOverdueForLoan;
        }

        overdueSummary.totalOverdue++;
        overdueSummary.totalOverdueAmount += totalOverdueForLoan;

        overdueSummary.loans.push({
          loanId: loan.loanId,
          borrower: loan.borrower,
          amount: loan.amount,
          paidAmount: loan.paidAmount,
          overdueAmount: totalOverdueForLoan,
          daysOverdue,
          pendingInstallments: pendingInstallments.length,
          status: loan.status,
          risk: loan.risk?.level
        });
      }
    });

    // Sort by most overdue
    overdueSummary.loans.sort((a, b) => b.daysOverdue - a.daysOverdue);

    res.json({
      success: true,
      data: overdueSummary
    });

  } catch (err) {
    console.error('Error fetching overdue summary:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch overdue summary'
    });
  }
};

/**
 * @desc    Get upcoming payments (next 7/30 days)
 * @route   GET /api/payments/admin/upcoming
 * @access  Private (Admin only)
 */
exports.getUpcomingPayments = async (req, res) => {
  try {
    const { days = 7 } = req.query;
    const now = new Date();
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + parseInt(days));

    const loans = await Loan.find({
      status: { $in: ['active', 'overdue'] },
      isDeleted: false
    })
    .select('loanId borrower amount schedule status')
    .populate('borrower.id', 'name email phone')
    .lean();

    const upcoming = [];

    loans.forEach(loan => {
      const pendingInstallments = (loan.schedule || [])
        .filter(inst => 
          inst.status === 'pending' && 
          new Date(inst.dueDate) >= now &&
          new Date(inst.dueDate) <= futureDate
        )
        .map(inst => ({
          installmentNo: inst.installmentNo,
          dueDate: inst.dueDate,
          amount: inst.amount,
          daysLeft: Math.floor((new Date(inst.dueDate) - now) / (1000 * 60 * 60 * 24))
        }));

      if (pendingInstallments.length > 0) {
        upcoming.push({
          loanId: loan.loanId,
          borrower: loan.borrower,
          totalAmount: loan.amount,
          nextInstallment: pendingInstallments[0], // oldest first
          allUpcoming: pendingInstallments,
          count: pendingInstallments.length
        });
      }
    });

    // Sort by due date (closest first)
    upcoming.sort((a, b) => 
      new Date(a.nextInstallment.dueDate) - new Date(b.nextInstallment.dueDate)
    );

    res.json({
      success: true,
      data: upcoming,
      total: upcoming.length,
      totalAmount: upcoming.reduce((sum, item) => sum + item.nextInstallment.amount, 0)
    });

  } catch (err) {
    console.error('Error fetching upcoming payments:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch upcoming payments'
    });
  }
};

/**
 * @desc    Get repayment statistics for dashboard
 * @route   GET /api/payments/admin/dashboard-stats
 * @access  Private (Admin only)
 */
exports.getRepaymentDashboardStats = async (req, res) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());

    // Get payment stats
    const [totalStats, monthStats, weekStats, overdueStats] = await Promise.all([
      // Overall stats
      LoanPayment.aggregate([
        {
          $group: {
            _id: null,
            totalCollected: { $sum: '$amount' },
            totalCount: { $sum: 1 },
            successCount: {
              $sum: { $cond: [{ $eq: ['$status', 'success'] }, 1, 0] }
            },
            successAmount: {
              $sum: { $cond: [{ $eq: ['$status', 'success'] }, '$amount', 0] }
            }
          }
        }
      ]),

      // This month
      LoanPayment.aggregate([
        { $match: { createdAt: { $gte: startOfMonth } } },
        {
          $group: {
            _id: null,
            amount: { $sum: '$amount' },
            count: { $sum: 1 }
          }
        }
      ]),

      // This week
      LoanPayment.aggregate([
        { $match: { createdAt: { $gte: startOfWeek } } },
        {
          $group: {
            _id: null,
            amount: { $sum: '$amount' },
            count: { $sum: 1 }
          }
        }
      ]),

      // Overdue loans count and amount
      Loan.aggregate([
        { $match: { status: 'overdue', isDeleted: false } },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            amount: { $sum: '$amount' },
            paidAmount: { $sum: '$paidAmount' }
          }
        }
      ])
    ]);

    // Calculate collection rate
    const totalCollected = totalStats[0]?.totalCollected || 0;
    const totalSuccessAmount = totalStats[0]?.successAmount || 0;
    const collectionRate = totalCollected > 0 
      ? (totalSuccessAmount / totalCollected) * 100 
      : 0;

    res.json({
      success: true,
      data: {
        totalCollected: totalStats[0]?.totalCollected || 0,
        totalPayments: totalStats[0]?.totalCount || 0,
        successfulPayments: totalStats[0]?.successCount || 0,
        collectionRate,
        thisMonth: {
          amount: monthStats[0]?.amount || 0,
          count: monthStats[0]?.count || 0
        },
        thisWeek: {
          amount: weekStats[0]?.amount || 0,
          count: weekStats[0]?.count || 0
        },
        overdue: {
          count: overdueStats[0]?.count || 0,
          amount: (overdueStats[0]?.amount || 0) - (overdueStats[0]?.paidAmount || 0)
        }
      }
    });

  } catch (err) {
    console.error('Error fetching dashboard stats:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard statistics'
    });
  }
};