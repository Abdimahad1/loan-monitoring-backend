// controllers/guarantorController.js
const mongoose = require("mongoose");
const Loan = require("../models/Loan");
const User = require("../models/User");
const LoanPayment = require("../models/LoanPayment"); // ADDED: Import LoanPayment model

/**
 * @desc    Get dashboard stats for guarantor
 * @route   GET /api/guarantor/stats
 * @access  Private (Guarantor only)
 */
exports.getGuarantorStats = async (req, res) => {
  try {
    const guarantorId = req.user.id;

    // Find all loans where this user is the guarantor
    const loans = await Loan.find({
      'guarantor.id': guarantorId,
      isDeleted: false
    });

    // Get all payments for these loans to calculate actual paid amounts
    const loanIds = loans.map(loan => loan._id);
    const payments = await LoanPayment.find({
      loanId: { $in: loanIds },
      status: 'success'
    });

    // Calculate actual paid amount from payments
    const actualPaidAmount = payments.reduce((sum, p) => sum + p.amount, 0);

    // Calculate stats
    const stats = {
      totalGuaranteed: loans.length,
      activeLoans: loans.filter(l => l.status === 'active').length,
      overdueLoans: loans.filter(l => l.status === 'overdue').length,
      completedLoans: loans.filter(l => l.status === 'completed').length,
      totalAmount: loans.reduce((sum, loan) => sum + loan.amount, 0),
      atRiskAmount: loans
        .filter(l => l.status === 'overdue')
        .reduce((sum, loan) => sum + loan.remainingAmount, 0),
      paidAmount: actualPaidAmount, // Use actual paid amount from payments
    };

    res.status(200).json({
      success: true,
      data: stats
    });

  } catch (error) {
    console.error("Error fetching guarantor stats:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch guarantor statistics"
    });
  }
};

/**
 * @desc    Get all loans where user is guarantor
 * @route   GET /api/guarantor/loans
 * @access  Private (Guarantor only)
 */
exports.getGuarantorLoans = async (req, res) => {
  try {
    const guarantorId = req.user.id;
    const {
      status,
      page = 1,
      limit = 10,
      search
    } = req.query;

    const query = {
      'guarantor.id': guarantorId,
      isDeleted: false
    };

    // Apply status filter
    if (status && status !== 'all') {
      query.status = status;
    }

    // Apply search filter
    if (search) {
      query.$or = [
        { loanId: { $regex: search, $options: 'i' } },
        { 'borrower.name': { $regex: search, $options: 'i' } },
      ];
    }

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const loans = await Loan.find(query)
      .populate('borrower.id', 'name email phone profile')
      .populate('createdBy', 'name email')
      .sort('-createdAt')
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Loan.countDocuments(query);

    // Get all payments for these loans
    const loanIds = loans.map(loan => loan._id);
    const allPayments = await LoanPayment.find({
      loanId: { $in: loanIds },
      status: 'success'
    });

    // Create a map of loanId -> total paid amount
    const paidAmountMap = {};
    allPayments.forEach(payment => {
      const loanIdStr = payment.loanId.toString();
      paidAmountMap[loanIdStr] = (paidAmountMap[loanIdStr] || 0) + payment.amount;
    });

    // Process loans for guarantor view with actual paid amounts
    const processedLoans = loans.map(loan => {
      const actualPaidAmount = paidAmountMap[loan._id.toString()] || 0;
      const remainingAmount = loan.amount - actualPaidAmount;
      
      // Count paid installments from schedule
      const paidInstallments = loan.schedule?.filter(s => s.status === 'paid').length || 0;
      const totalInstallments = loan.schedule?.length || 0;

      return {
        _id: loan._id,
        loanId: loan.loanId,
        amount: loan.amount,
        paidAmount: actualPaidAmount, // Use actual paid amount
        remainingAmount: remainingAmount,
        status: loan.status,
        progress: loan.amount > 0 ? actualPaidAmount / loan.amount : 0,
        startDate: loan.startDate,
        endDate: loan.endDate,
        term: loan.term,
        interestRate: loan.interestRate,
        purpose: loan.purpose,
        description: loan.description,
        risk: loan.risk,
        schedule: loan.schedule,
        paidInstallments: paidInstallments,
        totalInstallments: totalInstallments,
        borrower: {
          id: loan.borrower.id,
          name: loan.borrower.name,
          email: loan.borrower.email,
          phone: loan.borrower.phone,
          initials: loan.borrower.name
            ? loan.borrower.name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2)
            : 'UN',
        },
        nextPayment: loan.schedule?.find(s => s.status === 'pending'),
        nextPaymentDate: loan.schedule?.find(s => s.status === 'pending')?.dueDate,
        nextPaymentAmount: loan.schedule?.find(s => s.status === 'pending')?.amount,
      };
    });

    res.status(200).json({
      success: true,
      data: processedLoans,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });

  } catch (error) {
    console.error("Error fetching guarantor loans:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch guaranteed loans"
    });
  }
};

/**
 * @desc    Get single loan details for guarantor
 * @route   GET /api/guarantor/loans/:id
 * @access  Private (Guarantor only)
 */
exports.getGuarantorLoanById = async (req, res) => {
  try {
    const guarantorId = req.user.id;
    const loanId = req.params.id;

    const loan = await Loan.findOne({
      _id: loanId,
      'guarantor.id': guarantorId,
      isDeleted: false
    })
    .populate('borrower.id', 'name email phone profile')
    .populate('createdBy', 'name email');

    if (!loan) {
      return res.status(404).json({
        success: false,
        message: "Loan not found or you are not the guarantor for this loan"
      });
    }

    // Get actual payments from LoanPayment collection
    const payments = await LoanPayment.find({ 
      loanId: loan._id,
      status: 'success'
    }).sort({ createdAt: -1 });

    const actualPaidAmount = payments.reduce((sum, p) => sum + p.amount, 0);
    const remainingAmount = loan.amount - actualPaidAmount;

    // Count paid installments from schedule
    const paidInstallments = loan.schedule?.filter(s => s.status === 'paid').length || 0;
    const totalInstallments = loan.schedule?.length || 0;

    // Process loan for guarantor view
    const processedLoan = {
      _id: loan._id,
      loanId: loan.loanId,
      amount: loan.amount,
      paidAmount: actualPaidAmount, // Use actual paid amount from payments
      remainingAmount: remainingAmount,
      status: loan.status,
      progress: loan.amount > 0 ? actualPaidAmount / loan.amount : 0,
      interestRate: loan.interestRate,
      term: loan.term,
      startDate: loan.startDate,
      endDate: loan.endDate,
      purpose: loan.purpose,
      description: loan.description,
      risk: loan.risk,
      schedule: loan.schedule,
      // Don't include loan.payments as it's empty
      borrower: {
        id: loan.borrower.id,
        name: loan.borrower.name,
        email: loan.borrower.email,
        phone: loan.borrower.phone,
        address: loan.borrower.address,
        occupation: loan.borrower.employmentType,
        initials: loan.borrower.name
          ? loan.borrower.name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2)
          : 'UN',
      },
      nextPayment: loan.schedule?.find(s => s.status === 'pending'),
      nextPaymentDate: loan.schedule?.find(s => s.status === 'pending')?.dueDate,
      nextPaymentAmount: loan.schedule?.find(s => s.status === 'pending')?.amount,
      totalInstallments: totalInstallments,
      paidInstallments: paidInstallments,
    };

    res.status(200).json({
      success: true,
      data: processedLoan
    });

  } catch (error) {
    console.error("Error fetching guarantor loan details:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch loan details"
    });
  }
};

/**
 * @desc    Get loan schedule for a specific loan
 * @route   GET /api/guarantor/loans/:id/schedule
 * @access  Private (Guarantor only)
 */
exports.getLoanSchedule = async (req, res) => {
  try {
    const guarantorId = req.user.id;
    const loanId = req.params.id;

    const loan = await Loan.findOne({
      _id: loanId,
      'guarantor.id': guarantorId,
      isDeleted: false
    }).select('schedule loanId amount');

    if (!loan) {
      return res.status(404).json({
        success: false,
        message: "Loan not found"
      });
    }

    // Get payments to verify which installments are actually paid
    const payments = await LoanPayment.find({ 
      loanId: loan._id,
      status: 'success'
    });

    // Calculate total paid amount from payments
    const totalPaidAmount = payments.reduce((sum, p) => sum + p.amount, 0);
    
    // Calculate how many installments should be marked as paid
    const installmentAmount = loan.amount / (loan.schedule?.length || 1);
    const paidInstallmentsCount = installmentAmount > 0 
      ? Math.round(totalPaidAmount / installmentAmount)
      : 0;

    // Process schedule with installment numbers and proper status
    const schedule = loan.schedule.map((inst, index) => {
      // Determine if this installment should be paid based on paid count
      const shouldBePaid = index < paidInstallmentsCount;
      
      return {
        installmentNo: index + 1,
        dueDate: inst.dueDate,
        amount: inst.amount,
        principal: inst.principal,
        interest: inst.interest,
        status: shouldBePaid ? 'paid' : (inst.status || 'pending'),
        paidAt: shouldBePaid ? (inst.paidAt || new Date()) : null,
      };
    });

    res.status(200).json({
      success: true,
      data: {
        loanId: loan.loanId,
        schedule
      }
    });

  } catch (error) {
    console.error("Error fetching loan schedule:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch loan schedule"
    });
  }
};

/**
 * @desc    Get payment history for a loan (from LoanPayment collection)
 * @route   GET /api/guarantor/loans/:id/payments
 * @access  Private (Guarantor only)
 */
exports.getLoanPayments = async (req, res) => {
  try {
    const guarantorId = req.user.id;
    const loanId = req.params.id;

    // First verify the user is guarantor for this loan
    const loan = await Loan.findOne({
      _id: loanId,
      'guarantor.id': guarantorId,
      isDeleted: false
    }).select('loanId borrower');

    if (!loan) {
      return res.status(404).json({
        success: false,
        message: "Loan not found or you are not the guarantor"
      });
    }

    // Get all payments from LoanPayment collection for this loan
    const payments = await LoanPayment.find({ 
      loanId: loanId // This matches the MongoDB ObjectId
    })
    .sort({ createdAt: -1 }) // Newest first
    .lean();

    console.log(`💰 Found ${payments.length} payments for loan ${loan.loanId}`);

    // Format payments for frontend with all details
    const formattedPayments = payments.map(payment => ({
      _id: payment._id,
      amount: payment.amount,
      date: payment.createdAt,
      method: payment.paymentMethod,
      status: payment.status,
      transactionId: payment.transactionId,
      invoiceId: payment.invoiceId,
      phoneNumber: payment.phoneNumber,
      referenceId: payment.referenceId,
      loanId_display: payment.loanId_display,
      metadata: payment.metadata || {},
      installmentNo: payment.metadata?.installmentNumber || 
                     payment.metadata?.installmentNo || 
                     null
    }));

    res.status(200).json({
      success: true,
      data: {
        loanId: loan.loanId,
        payments: formattedPayments
      }
    });

  } catch (error) {
    console.error("❌ Error fetching loan payments:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch loan payments"
    });
  }
};

/**
 * @desc    Get all notifications for guarantor
 * @route   GET /api/guarantor/notifications
 * @access  Private (Guarantor only)
 */
exports.getGuarantorNotifications = async (req, res) => {
  try {
    const guarantorId = req.user.id;
    const { limit = 20, page = 1 } = req.query;

    // Find loans where user is guarantor
    const loans = await Loan.find({
      'guarantor.id': guarantorId,
      isDeleted: false
    }).select('loanId status schedule payments borrower');

    const notifications = [];

    // Generate notifications based on loan status
    loans.forEach(loan => {
      // Check for overdue payments
      if (loan.status === 'overdue') {
        notifications.push({
          id: `overdue-${loan._id}`,
          type: 'warning',
          title: 'Overdue Payment Alert',
          message: `The loan ${loan.loanId} is overdue. Please contact the borrower.`,
          loanId: loan.loanId,
          loanIdObj: loan._id,
          borrowerName: loan.borrower.name,
          timestamp: new Date(),
          isRead: false,
          action: 'View Loan'
        });
      }

      // Check for missed payments in schedule
      if (loan.schedule) {
        const now = new Date();
        const missedPayments = loan.schedule.filter(s => 
          s.status === 'pending' && new Date(s.dueDate) < now
        );

        missedPayments.forEach(payment => {
          notifications.push({
            id: `missed-${loan._id}-${payment.installmentNo}`,
            type: 'warning',
            title: 'Missed Payment',
            message: `Installment #${payment.installmentNo} for loan ${loan.loanId} was due on ${new Date(payment.dueDate).toLocaleDateString()}`,
            loanId: loan.loanId,
            loanIdObj: loan._id,
            borrowerName: loan.borrower.name,
            timestamp: payment.dueDate,
            isRead: false,
            action: 'View Schedule'
          });
        });
      }

      // Successful payments (from LoanPayment collection would be better here)
      if (loan.payments && loan.payments.length > 0) {
        loan.payments.slice(-3).forEach(payment => {
          notifications.push({
            id: `payment-${loan._id}-${payment._id}`,
            type: 'success',
            title: 'Payment Received',
            message: `A payment of $${payment.amount} was received for loan ${loan.loanId}`,
            loanId: loan.loanId,
            loanIdObj: loan._id,
            borrowerName: loan.borrower.name,
            timestamp: payment.date,
            isRead: false,
            action: 'View Payment'
          });
        });
      }

      // Loan milestones
      if (loan.paidAmount >= loan.amount) {
        notifications.push({
          id: `completed-${loan._id}`,
          type: 'success',
          title: 'Loan Completed',
          message: `Congratulations! Loan ${loan.loanId} has been fully repaid.`,
          loanId: loan.loanId,
          loanIdObj: loan._id,
          borrowerName: loan.borrower.name,
          timestamp: new Date(),
          isRead: false,
          action: 'View Loan'
        });
      }
    });

    // Sort by timestamp (newest first)
    notifications.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Paginate
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const paginatedNotifications = notifications.slice(skip, skip + parseInt(limit));

    res.status(200).json({
      success: true,
      data: paginatedNotifications,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: notifications.length,
        pages: Math.ceil(notifications.length / parseInt(limit))
      }
    });

  } catch (error) {
    console.error("Error fetching guarantor notifications:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch notifications"
    });
  }
};

/**
 * @desc    Mark notification as read
 * @route   PUT /api/guarantor/notifications/:id/read
 * @access  Private (Guarantor only)
 */
exports.markNotificationAsRead = async (req, res) => {
  // Since notifications are generated on-the-fly, we don't store them in DB
  // You can implement this in frontend or create a notifications collection
  res.status(200).json({
    success: true,
    message: "Notification marked as read"
  });
};