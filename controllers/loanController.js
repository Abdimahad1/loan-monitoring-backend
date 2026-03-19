const mongoose = require("mongoose");
const Loan = require("../models/Loan");
const User = require("../models/User");
const LoanPayment = require("../models/LoanPayment"); // <-- ADD THIS LINE
const bcrypt = require("bcryptjs");
const { sendWelcomeEmail } = require('../services/emailService');

// Import notification functions
const { 
  notifyLoanCreated,
  notifyLoanApproved 
} = require("./notificationController");

// Helper function to generate loan ID
const generateLoanId = async () => {
  const year = new Date().getFullYear();
  const count = await Loan.countDocuments();
  return `LN-${year}-${(count + 1).toString().padStart(4, '0')}`;
};

// Helper function to generate random password
const generateTempPassword = () => {
  return Math.random().toString(36).slice(-8) + '1A!';
};

// Helper function to check if user exists
const checkUserExists = async (email, phone, nationalId, excludeUserId = null) => {
  const query = {
    $or: []
  };
  
  if (email) query.$or.push({ email: email.toLowerCase() });
  if (phone) query.$or.push({ phone });
  if (nationalId) query.$or.push({ 'profile.idNumber': nationalId });
  
  if (query.$or.length === 0) return null;
  
  if (excludeUserId) {
    query._id = { $ne: excludeUserId };
  }
  
  return await User.findOne(query).select('email phone profile.idNumber');
};

// @desc    Create new loan (with auto risk calculation)
// @route   POST /api/loans
// @access  Private (Admin, Loan Officer)
exports.createLoan = async (req, res) => {
  // Start a session for transaction
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      // Borrower mode flags
      borrowerMode,
      borrowerId,
      newBorrower,
      
      // Loan Details
      amount,
      interestRate = 0,
      term,
      startDate,
      paymentFrequency,
      purpose,
      description,
      gracePeriod,
      processingFee,
      lateFee,
      
      // Risk & Financial
      monthlyIncome,
      monthlyExpenses,
      existingDebt,
      loanOfficerNotes,
      
      // Collateral
      collateral,
      
      // Guarantor mode
      guarantorMode,
      guarantor
    } = req.body;

    console.log('📋 Creating loan with data:', {
      borrowerMode,
      amount,
      term,
      hasCollateral: collateral?.hasCollateral,
      guarantorMode,
      hasGuarantor: guarantorMode !== 'none'
    });

    let borrower;
    let borrowerInfo;
    let borrowerPassword = null;
    let guarantorPassword = null;
    let newBorrowerData = null;
    let newGuarantorData = null;

    // ========== STEP 1: CHECK FOR EXISTING USERS FIRST ==========
    // Check if borrower already exists (for new borrower mode)
    if (borrowerMode === 'new') {
      console.log('🔍 Checking if new borrower already exists:', newBorrower?.email);
      const existingUser = await checkUserExists(
        newBorrower?.email,
        newBorrower?.phone,
        newBorrower?.nationalId
      );
      
      if (existingUser) {
        console.log('❌ Borrower already exists:', existingUser.email);
        await session.abortTransaction();
        session.endSession();
        
        let message = 'User already exists with ';
        if (existingUser.email === newBorrower?.email?.toLowerCase()) message += 'this email';
        else if (existingUser.phone === newBorrower?.phone) message += 'this phone number';
        else if (existingUser.profile?.idNumber === newBorrower?.nationalId) message += 'this National ID';
        
        return res.status(409).json({
          success: false,
          message
        });
      }
      console.log('✅ New borrower email is available');
    }

    // Check if guarantor already exists (for new guarantor mode)
    let guarantorUser = null;
    if (guarantorMode === 'new' && guarantor) {
      console.log('🔍 Checking if new guarantor already exists:', guarantor.email);
      const existingGuarantor = await checkUserExists(
        guarantor.email,
        guarantor.phone,
        guarantor.nationalId
      );
      
      if (existingGuarantor) {
        console.log('❌ Guarantor already exists:', existingGuarantor.email);
        await session.abortTransaction();
        session.endSession();
        
        let message = 'Guarantor already exists with ';
        if (existingGuarantor.email === guarantor.email?.toLowerCase()) message += 'this email';
        else if (existingGuarantor.phone === guarantor.phone) message += 'this phone number';
        else if (existingGuarantor.profile?.idNumber === guarantor.nationalId) message += 'this National ID';
        
        return res.status(409).json({
          success: false,
          message
        });
      }
      console.log('✅ New guarantor email is available');
    }

    // ========== STEP 2: HANDLE BORROWER ==========
    if (borrowerMode === 'existing') {
      console.log('👤 Using existing borrower with ID:', borrowerId);
      borrower = await User.findById(borrowerId).session(session);
      if (!borrower) {
        console.log('❌ Borrower not found with ID:', borrowerId);
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({
          success: false,
          message: "Borrower not found"
        });
      }
      console.log('✅ Existing borrower found:', borrower.name, borrower.email);

      // Check if a national ID was provided for this existing borrower
      if (req.body.borrowerNationalId) {
        console.log('📝 Updating existing borrower national ID to:', req.body.borrowerNationalId);
        // Check if this national ID is already used by another user
        const existingUserWithId = await User.findOne({
          'profile.idNumber': req.body.borrowerNationalId,
          _id: { $ne: borrower._id }
        }).session(session);

        if (existingUserWithId) {
          console.log('❌ National ID already registered to another user');
          await session.abortTransaction();
          session.endSession();
          return res.status(409).json({
            success: false,
            message: "National ID is already registered to another user"
          });
        }

        // Update the borrower's profile with the new national ID
        borrower.profile.idNumber = req.body.borrowerNationalId;
        borrower.profile.idType = req.body.borrowerIdType || 'national_id';
        await borrower.save({ session });
        console.log('✅ Borrower national ID updated successfully');
      }

      borrowerInfo = {
        id: borrower._id,
        name: borrower.name,
        email: borrower.email,
        phone: borrower.phone,
        nationalId: borrower.profile?.idNumber || req.body.borrowerNationalId || null,
        address: borrower.profile?.city ? `${borrower.profile.city}, ${borrower.profile.country || 'Somalia'}` : null,
        employmentType: borrower.profile?.occupation,
        monthlyIncome: monthlyIncome ? parseFloat(monthlyIncome) : (borrower.profile?.income || 0),
        activeLoans: borrower.loanStats?.activeLoans || 0,
        creditScore: borrower.profile?.creditScore
      };
    } else if (borrowerMode === 'new') {
      console.log('👤 Creating new borrower...');
      // Create new borrower (but don't send email yet)
      borrowerPassword = generateTempPassword();
      console.log('🔑 Generated raw borrower password:', borrowerPassword);
      console.log('📧 Borrower email:', newBorrower?.email);

      const salt = await bcrypt.genSalt(12);
      const hashedPassword = await bcrypt.hash(borrowerPassword, salt);
      console.log('🔒 Password hashed successfully');

      const newUser = new User({
        name: newBorrower?.name,
        email: newBorrower?.email?.toLowerCase(),
        phone: newBorrower?.phone,
        password: hashedPassword,
        role: 'borrower',
        profile: {
          idType: newBorrower?.idType,
          idNumber: newBorrower?.nationalId,
          address: newBorrower?.address,
          city: newBorrower?.city,
          country: newBorrower?.country || 'Somalia',
          occupation: newBorrower?.occupation,
          income: monthlyIncome ? parseFloat(monthlyIncome) : 0,
          businessName: newBorrower?.businessName,
          businessType: newBorrower?.businessType,
          businessRegistration: newBorrower?.businessRegistration,
          idFrontImage: newBorrower?.idFrontImage,
          idBackImage: newBorrower?.idBackImage,
          businessLicense: newBorrower?.businessLicense
        },
        createdBy: req.user.id,
        isVerified: false
      });

      await newUser.save({ session });
      borrower = newUser;
      console.log('✅ New borrower created with ID:', borrower._id);
      
      newBorrowerData = {
        id: borrower._id,
        name: borrower.name,
        email: borrower.email,
        password: borrowerPassword // Store temporarily for email
      };
      console.log('📧 Borrower data saved for email:', { 
        email: borrower.email, 
        passwordLength: borrowerPassword.length,
        passwordPreview: borrowerPassword.substring(0, 3) + '...' 
      });

      borrowerInfo = {
        id: borrower._id,
        name: borrower.name,
        email: borrower.email,
        phone: borrower.phone,
        nationalId: borrower.profile?.idNumber,
        address: borrower.profile?.city ? `${borrower.profile.city}, ${borrower.profile.country}` : null,
        employmentType: borrower.profile?.occupation,
        monthlyIncome: monthlyIncome ? parseFloat(monthlyIncome) : (borrower.profile?.income || 0),
        activeLoans: 0,
        creditScore: null
      };
    } else {
      console.log('❌ Invalid borrower mode:', borrowerMode);
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Invalid borrower mode"
      });
    }

    // ========== STEP 3: HANDLE GUARANTOR ==========
    let guarantorData = { hasGuarantor: false };
    
    if (guarantorMode !== 'none' && guarantor) {
      console.log('👤 Handling guarantor, mode:', guarantorMode);
      
      // Validate required fields for new guarantor
      if (guarantorMode === 'new') {
        const requiredFields = ['name', 'phone', 'nationalId', 'relationship', 'income'];
        const missingFields = requiredFields.filter(field => !guarantor[field]);
        
        if (missingFields.length > 0) {
          console.log('❌ Missing required guarantor fields:', missingFields);
          await session.abortTransaction();
          session.endSession();
          return res.status(400).json({
            success: false,
            message: `Missing required guarantor fields: ${missingFields.join(', ')}`
          });
        }

        console.log('📝 Creating new guarantor...');
        // Create new guarantor user (but don't send email yet)
        guarantorPassword = generateTempPassword();
        console.log('🔑 Generated raw guarantor password:', guarantorPassword);

        const salt = await bcrypt.genSalt(12);
        const hashedPassword = await bcrypt.hash(guarantorPassword, salt);

        const newGuarantor = new User({
          name: guarantor.name,
          email: guarantor.email?.toLowerCase(),
          phone: guarantor.phone,
          password: hashedPassword,
          role: 'guarantor',
          profile: {
            idNumber: guarantor.nationalId,
            income: guarantor.income ? parseFloat(guarantor.income) : 0,
            occupation: guarantor.relationship,
          },
          createdBy: req.user.id,
          isVerified: false
        });

        await newGuarantor.save({ session });
        guarantorUser = newGuarantor;
        console.log('✅ New guarantor created with ID:', guarantorUser._id);
        
        newGuarantorData = {
          id: guarantorUser._id,
          name: guarantorUser.name,
          email: guarantorUser.email,
          password: guarantorPassword // Store temporarily for email
        };

        guarantorData = {
          hasGuarantor: true,
          id: guarantorUser._id,
          name: guarantor.name,
          relationship: guarantor.relationship,
          phone: guarantor.phone,
          email: guarantor.email,
          income: parseFloat(guarantor.income),
          nationalId: guarantor.nationalId,
          idImage: guarantor.idImage ? {
            name: guarantor.idImage.name,
            url: guarantor.idImage.url,
            type: guarantor.idImage.type,
            size: guarantor.idImage.size,
            uploadedAt: guarantor.idImage.uploadedAt ? new Date(guarantor.idImage.uploadedAt) : new Date()
          } : null,
          incomeProof: guarantor.incomeProof ? {
            name: guarantor.incomeProof.name,
            url: guarantor.incomeProof.url,
            type: guarantor.incomeProof.type,
            size: guarantor.incomeProof.size,
            uploadedAt: guarantor.incomeProof.uploadedAt ? new Date(guarantor.incomeProof.uploadedAt) : new Date()
          } : null,
          agreementSigned: guarantor.agreementSigned || false,
          agreementDate: guarantor.agreementSigned ? new Date() : null
        };
      } else if (guarantorMode === 'existing' && guarantor.id) {
        console.log('📝 Using existing guarantor with ID:', guarantor.id);
        guarantorUser = await User.findById(guarantor.id).session(session);
        if (!guarantorUser) {
          console.log('❌ Guarantor not found with ID:', guarantor.id);
          await session.abortTransaction();
          session.endSession();
          return res.status(404).json({
            success: false,
            message: "Guarantor user not found"
          });
        }
        console.log('✅ Existing guarantor found:', guarantorUser.name, guarantorUser.email);

        guarantorData = {
          hasGuarantor: true,
          id: guarantorUser._id,
          name: guarantorUser.name,
          relationship: guarantor.relationship || '',
          phone: guarantorUser.phone,
          email: guarantorUser.email,
          income: guarantor.income ? parseFloat(guarantor.income) : (guarantorUser.profile?.income || 0),
          nationalId: guarantorUser.profile?.idNumber || '',
          idImage: guarantor.idImage || null,
          incomeProof: guarantor.incomeProof || null,
          agreementSigned: guarantor.agreementSigned || false,
          agreementDate: guarantor.agreementSigned ? new Date() : null
        };
      }
    }

    // ========== STEP 4: VALIDATE LOAN FIELDS ==========
    if (!startDate) {
      console.log('❌ Missing start date');
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Start date is required"
      });
    }

    if (!amount || parseFloat(amount) < 100) {
      console.log('❌ Invalid amount:', amount);
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Loan amount must be at least 100"
      });
    }

    // Calculate end date
    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + parseInt(term || 1));

    // Generate payment schedule
    const schedule = generatePaymentSchedule(
      parseFloat(amount || 0), 
      parseFloat(interestRate || 0), 
      parseInt(term || 1), 
      startDate, 
      paymentFrequency || 'monthly'
    );

    // Get monthly installment
    const monthlyInstallment = schedule.length > 0 ? schedule[0].amount : 0;

    // Calculate DTI
    const totalMonthlyDebt = (parseFloat(existingDebt) || 0) + monthlyInstallment;
    const dti = monthlyIncome > 0 ? (totalMonthlyDebt / parseFloat(monthlyIncome)) * 100 : 0;

    // Prepare collateral data with documents
    let collateralData = { hasCollateral: false };
    if (collateral && collateral.hasCollateral) {
      let ownershipDocs = [];
      if (Array.isArray(collateral.ownershipDocs)) {
        ownershipDocs = collateral.ownershipDocs.map(doc => ({
          name: doc.name || 'Document',
          url: doc.url || '',
          type: doc.type || 'unknown',
          size: doc.size || 0,
          uploadedAt: doc.uploadedAt ? new Date(doc.uploadedAt) : new Date()
        }));
      }

      collateralData = {
        hasCollateral: true,
        type: collateral.type || '',
        value: collateral.value ? parseFloat(collateral.value) : undefined,
        description: collateral.description || '',
        ownershipProof: collateral.ownershipProof || '',
        ownershipDocs: ownershipDocs
      };
    }

    // ========== STEP 5: CREATE LOAN ==========
    const loanId = await generateLoanId();
    console.log('📝 Creating loan with ID:', loanId);

    const loanData = {
      loanId,
      borrower: borrowerInfo,
      amount: parseFloat(amount || 0),
      interestRate: parseFloat(interestRate || 0),
      term: parseInt(term || 1),
      startDate: new Date(startDate),
      endDate,
      paymentFrequency: paymentFrequency || 'monthly',
      purpose: purpose || 'other',
      description: description || '',
      gracePeriod: parseInt(gracePeriod) || 0,
      processingFee: parseFloat(processingFee) || 0,
      lateFee: parseFloat(lateFee) || 0,
      financialInfo: {
        monthlyIncome: parseFloat(monthlyIncome) || 0,
        monthlyExpenses: parseFloat(monthlyExpenses) || 0,
        existingDebt: parseFloat(existingDebt) || 0,
        debtToIncomeRatio: dti
      },
      loanOfficerNotes: loanOfficerNotes || '',
      collateral: collateralData,
      guarantor: guarantorData,
      createdBy: req.user.id,
      schedule
    };

    const loan = new Loan(loanData);
    loan.calculateRisk(borrower);
    await loan.save({ session });
    console.log('✅ Loan saved successfully');

    // ========== STEP 6: COMMIT TRANSACTION FIRST ==========
    await session.commitTransaction();
    session.endSession();
    console.log('✅ Transaction committed');

    // ========== STEP 7: SEND NOTIFICATIONS ==========
    const notificationResults = [];

    // Send loan creation notifications
    try {
      console.log('📨 Triggering loan creation notifications...');
      
      // Get fresh loan data with populated fields for notifications
      const populatedLoan = await Loan.findById(loan._id)
        .populate('borrower.id', 'name email')
        .populate('guarantor.id', 'name email');
      
      await notifyLoanCreated(populatedLoan);
      console.log('✅ Loan creation notifications sent');
      notificationResults.push({ type: 'loan_created', success: true });
    } catch (notifError) {
      console.error('❌ Failed to send loan creation notifications:', notifError);
      notificationResults.push({ type: 'loan_created', success: false, error: notifError.message });
    }

    // Send welcome emails for new users (existing code)
    const emailPromises = [];
    const emailResults = [];

    // Send borrower email if new borrower was created
    if (newBorrowerData && newBorrowerData.email) {
      console.log('📧 Preparing to send welcome email to borrower:', {
        email: newBorrowerData.email,
        password: newBorrowerData.password,
        passwordLength: newBorrowerData.password.length
      });
      
      emailPromises.push(
        sendWelcomeEmail({
          email: newBorrowerData.email,
          name: newBorrowerData.name,
          role: 'borrower',
          tempPassword: newBorrowerData.password,
          loginUrl: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/login`
        }).then(result => {
          console.log(`✅ Welcome email sent to borrower: ${newBorrowerData.email}`);
          emailResults.push({ type: 'borrower', success: true, email: newBorrowerData.email });
        }).catch(error => {
          console.error(`❌ Failed to send welcome email to borrower: ${newBorrowerData.email}`, error);
          emailResults.push({ type: 'borrower', success: false, email: newBorrowerData.email, error: error.message });
        })
      );
    }

    // Send guarantor email if new guarantor was created
    if (newGuarantorData && newGuarantorData.email) {
      console.log('📧 Preparing to send welcome email to guarantor:', {
        email: newGuarantorData.email,
        password: newGuarantorData.password,
        passwordLength: newGuarantorData.password.length
      });
      
      emailPromises.push(
        sendWelcomeEmail({
          email: newGuarantorData.email,
          name: newGuarantorData.name,
          role: 'guarantor',
          tempPassword: newGuarantorData.password,
          loginUrl: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/login`
        }).then(result => {
          console.log(`✅ Welcome email sent to guarantor: ${newGuarantorData.email}`);
          emailResults.push({ type: 'guarantor', success: true, email: newGuarantorData.email });
        }).catch(error => {
          console.error(`❌ Failed to send welcome email to guarantor: ${newGuarantorData.email}`, error);
          emailResults.push({ type: 'guarantor', success: false, email: newGuarantorData.email, error: error.message });
        })
      );
    }

    // Wait for all emails to be sent (but don't fail the request if emails fail)
    if (emailPromises.length > 0) {
      await Promise.allSettled(emailPromises);
      console.log('📧 Email sending complete. Results:', emailResults);
    }

    // Prepare response message
    let message = "Loan created successfully";
    if (borrowerMode === 'new') {
      message = "New borrower registered and loan created successfully";
    }
    if (guarantorMode === 'new') {
      message += " and new guarantor registered";
    }

    // Add email status to response
    const responseData = {
      loan,
      risk: loan.risk,
      emailStatus: emailResults,
      notificationStatus: notificationResults
    };

    if (newBorrowerData) {
      responseData.newBorrower = {
        id: borrower._id,
        name: borrower.name,
        email: borrower.email,
        emailSent: emailResults.some(r => r.type === 'borrower' && r.success)
      };
    }

    if (newGuarantorData) {
      responseData.newGuarantor = {
        id: guarantorUser._id,
        name: guarantorUser.name,
        email: guarantorUser.email,
        emailSent: emailResults.some(r => r.type === 'guarantor' && r.success)
      };
    }

    // Check if any emails failed
    const failedEmails = emailResults.filter(r => !r.success);
    if (failedEmails.length > 0) {
      message += '. Warning: Some welcome emails failed to send.';
      console.log('⚠️ Email failures:', failedEmails);
    }

    console.log('✅ Loan creation completed successfully');
    res.status(201).json({
      success: true,
      message,
      data: responseData
    });
  } catch (error) {
    // Abort transaction on error
    await session.abortTransaction();
    session.endSession();
    
    console.error("❌ Error creating loan:", error);
    
    // Handle duplicate key errors
    if (error.code === 11000) {
      let message = "Duplicate value error";
      if (error.keyPattern?.email) message = "Email already exists";
      else if (error.keyPattern?.phone) message = "Phone number already exists";
      else if (error.keyPattern?.['profile.idNumber']) message = "National ID already exists";
      else if (error.keyPattern?.['payments.paymentId']) message = "Duplicate payment ID";
      
      return res.status(409).json({
        success: false,
        message
      });
    }
    
    // Handle validation errors
    if (error.name === 'ValidationError') {
      const errors = {};
      for (let field in error.errors) {
        errors[field] = error.errors[field].message;
      }
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors
      });
    }
    
    res.status(500).json({
      success: false,
      message: error.message || "Failed to create loan"
    });
  }
};

// @desc    Update loan
// @route   PUT /api/loans/:id
// @access  Private (Admin, Loan Officer)
exports.updateLoan = async (req, res) => {
  try {
    const loan = await Loan.findOne({ 
      _id: req.params.id, 
      isDeleted: false 
    });

    if (!loan) {
      return res.status(404).json({
        success: false,
        message: "Loan not found"
      });
    }

    // Only allow updates if loan is pending
    if (loan.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Cannot update loan with status: ${loan.status}`
      });
    }

    const updatableFields = [
      'amount', 'interestRate', 'term', 'purpose', 'description',
      'paymentFrequency', 'gracePeriod', 'processingFee', 'lateFee',
      'financialInfo', 'collateral', 'guarantor', 'loanOfficerNotes'
    ];

    updatableFields.forEach(field => {
      if (req.body[field] !== undefined) {
        if (field === 'financialInfo') {
          loan.financialInfo = {
            ...loan.financialInfo,
            ...req.body.financialInfo
          };
        } else if (field === 'collateral' || field === 'guarantor') {
          loan[field] = {
            ...loan[field],
            ...req.body[field]
          };
        } else {
          loan[field] = req.body[field];
        }
      }
    });

    // Recalculate schedule if amount, interest, or term changed
    if (req.body.amount || req.body.interestRate !== undefined || req.body.term) {
      loan.schedule = generatePaymentSchedule(
        loan.amount,
        loan.interestRate || 0,
        loan.term,
        loan.startDate,
        loan.paymentFrequency
      );
    }

    loan.updatedBy = req.user.id;
    
    await loan.save();

    res.status(200).json({
      success: true,
      message: "Loan updated successfully",
      data: loan
    });
  } catch (error) {
    console.error("Error updating loan:", error);
    
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Duplicate key error"
      });
    }
    
    res.status(500).json({
      success: false,
      message: error.message || "Failed to update loan"
    });
  }
};

// @desc    Get all loans with filters
// @route   GET /api/loans
// @access  Private
exports.getLoans = async (req, res) => {
  try {
    const {
      status,
      risk,
      borrower,
      fromDate,
      toDate,
      page = 1,
      limit = 10,
      search
    } = req.query;

    const query = { isDeleted: false };

    // Apply filters
    if (status) query.status = status;
    if (risk) query['risk.level'] = risk;
    if (borrower) query['borrower.id'] = borrower;

    if (fromDate || toDate) {
      query.createdAt = {};
      if (fromDate) query.createdAt.$gte = new Date(fromDate);
      if (toDate) query.createdAt.$lte = new Date(toDate);
    }

    if (search) {
      query.$or = [
        { loanId: { $regex: search, $options: 'i' } },
        { 'borrower.name': { $regex: search, $options: 'i' } },
        { 'borrower.email': { $regex: search, $options: 'i' } },
        { 'borrower.phone': { $regex: search, $options: 'i' } }
      ];
    }

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const loans = await Loan.find(query)
      .populate('borrower.id', 'name email phone profile loanStats')
      .populate('guarantor.id', 'name email phone')
      .populate('createdBy', 'name email')
      .populate('approvedBy', 'name email')
      .populate('collateral.verifiedBy', 'name email')
      .sort('-createdAt')
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Loan.countDocuments(query);

    // Calculate summary statistics
    const summary = await Loan.aggregate([
      { $match: { isDeleted: false } },
      { $group: {
        _id: null,
        totalAmount: { $sum: "$amount" },
        totalPaid: { $sum: "$paidAmount" },
        totalRemaining: { $sum: "$remainingAmount" },
        activeLoans: { $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] } },
        overdueLoans: { $sum: { $cond: [{ $eq: ["$status", "overdue"] }, 1, 0] } },
        completedLoans: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } },
        lowRisk: { $sum: { $cond: [{ $eq: ["$risk.level", "low"] }, 1, 0] } },
        mediumRisk: { $sum: { $cond: [{ $eq: ["$risk.level", "medium"] }, 1, 0] } },
        highRisk: { $sum: { $cond: [{ $eq: ["$risk.level", "high"] }, 1, 0] } },
        criticalRisk: { $sum: { $cond: [{ $eq: ["$risk.level", "critical"] }, 1, 0] } }
      }}
    ]);

    res.status(200).json({
      success: true,
      data: loans,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      },
      summary: summary[0] || {
        totalAmount: 0,
        totalPaid: 0,
        totalRemaining: 0,
        activeLoans: 0,
        overdueLoans: 0,
        completedLoans: 0,
        lowRisk: 0,
        mediumRisk: 0,
        highRisk: 0,
        criticalRisk: 0
      }
    });
  } catch (error) {
    console.error("Error fetching loans:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch loans"
    });
  }
};

// @desc    Get single loan by ID
// @route   GET /api/loans/:id
// @access  Private
exports.getLoanById = async (req, res) => {
  try {
    const loan = await Loan.findOne({ 
      _id: req.params.id, 
      isDeleted: false 
    })
    .populate('borrower.id', 'name email phone profile loanStats')
    .populate('guarantor.id', 'name email phone profile')
    .populate('createdBy', 'name email')
    .populate('approvedBy', 'name email')
    .populate('collateral.verifiedBy', 'name email')
    .populate('payments.recordedBy', 'name email');

    if (!loan) {
      return res.status(404).json({
        success: false,
        message: "Loan not found"
      });
    }

    res.status(200).json({
      success: true,
      data: loan
    });
  } catch (error) {
    console.error("Error fetching loan:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch loan"
    });
  }
};

// @desc    Approve loan (sets to active immediately)
// @route   PUT /api/loans/:id/approve
// @access  Private (Admin/Loan Officer)
exports.approveLoan = async (req, res) => {
  try {
    const loan = await Loan.findById(req.params.id);
    
    if (!loan) {
      return res.status(404).json({ 
        success: false, 
        message: "Loan not found" 
      });
    }
    
    // Check if loan is in pending status
    if (loan.status !== 'pending') {
      return res.status(400).json({ 
        success: false, 
        message: `Cannot approve loan in ${loan.status} status` 
      });
    }
    
    // Update loan - SET TO ACTIVE DIRECTLY
    loan.status = 'active';
    loan.approvedBy = req.user.id;
    loan.approvedAt = Date.now();
    loan.activeAt = Date.now();
    
    await loan.save();
    
    console.log(`✅ Loan ${loan.loanId} approved and activated by ${req.user.email}`);

    // ========== SEND APPROVAL NOTIFICATIONS ==========
    try {
      console.log('📨 Triggering loan approval notifications...');
      
      // Get fresh loan data with populated fields for notifications
      const populatedLoan = await Loan.findById(loan._id)
        .populate('borrower.id', 'name email')
        .populate('guarantor.id', 'name email');
      
      await notifyLoanApproved(populatedLoan);
      console.log('✅ Loan approval notifications sent');
    } catch (notifError) {
      console.error('❌ Failed to send loan approval notifications:', notifError);
      // Don't fail the request if notifications fail
    }
    
    res.status(200).json({
      success: true,
      message: "Loan approved and activated successfully",
      data: loan
    });
    
  } catch (error) {
    console.error("❌ Approve loan error:", error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// @desc    Disburse loan
// @route   PUT /api/loans/:id/disburse
// @access  Private (Admin, Loan Officer)
exports.disburseLoan = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const loan = await Loan.findOne({ 
      _id: req.params.id, 
      isDeleted: false 
    }).session(session);

    if (!loan) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "Loan not found"
      });
    }

    if (loan.status !== 'approved') {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: `Cannot disburse loan with status: ${loan.status}`
      });
    }

    // Update loan
    loan.disbursedAmount = loan.amount;
    loan.status = 'active';
    loan.updatedBy = req.user.id;

    await loan.save({ session });

    // Update borrower stats
    await User.findByIdAndUpdate(
      loan.borrower.id,
      {
        $inc: {
          'loanStats.totalLoans': 1,
          'loanStats.activeLoans': 1,
          'loanStats.totalBorrowed': loan.amount
        }
      },
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({
      success: true,
      message: "Loan disbursed successfully",
      data: loan
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("Error disbursing loan:", error);
    res.status(500).json({
      success: false,
      message: "Failed to disburse loan"
    });
  }
};

// @desc    Reject loan
// @route   PUT /api/loans/:id/reject
// @access  Private (Admin, Loan Officer)
exports.rejectLoan = async (req, res) => {
  try {
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({
        success: false,
        message: "Rejection reason is required"
      });
    }

    const loan = await Loan.findOne({ 
      _id: req.params.id, 
      isDeleted: false 
    });

    if (!loan) {
      return res.status(404).json({
        success: false,
        message: "Loan not found"
      });
    }

    if (loan.status !== 'pending' && loan.status !== 'approved') {
      return res.status(400).json({
        success: false,
        message: `Cannot reject loan with status: ${loan.status}`
      });
    }

    // Store original status for notification
    const originalStatus = loan.status;
    
    loan.status = 'rejected';
    loan.rejectionReason = reason;
    loan.updatedBy = req.user.id;

    await loan.save();

    console.log(`✅ Loan ${loan.loanId} rejected by ${req.user.email}`);

    // ========== SEND REJECTION NOTIFICATIONS ==========
    try {
      console.log('📨 Triggering loan rejection notifications...');
      
      // Import notification function (add at top of file with other imports)
      const { notifyLoanRejected } = require("./notificationController");
      
      // Get fresh loan data with populated fields for notifications
      const populatedLoan = await Loan.findById(loan._id)
        .populate('borrower.id', 'name email')
        .populate('guarantor.id', 'name email');
      
      await notifyLoanRejected(populatedLoan);
      console.log('✅ Loan rejection notifications sent');
    } catch (notifError) {
      console.error('❌ Failed to send loan rejection notifications:', notifError);
      // Don't fail the request if notifications fail
    }

    res.status(200).json({
      success: true,
      message: "Loan rejected successfully",
      data: loan
    });
  } catch (error) {
    console.error("Error rejecting loan:", error);
    res.status(500).json({
      success: false,
      message: "Failed to reject loan"
    });
  }
};

// @desc    Verify collateral
// @route   PUT /api/loans/:id/verify-collateral
// @access  Private (Admin, Loan Officer)
exports.verifyCollateral = async (req, res) => {
  try {
    const loan = await Loan.findOne({ 
      _id: req.params.id, 
      isDeleted: false 
    });

    if (!loan) {
      return res.status(404).json({
        success: false,
        message: "Loan not found"
      });
    }

    if (!loan.collateral.hasCollateral) {
      return res.status(400).json({
        success: false,
        message: "This loan has no collateral"
      });
    }

    loan.collateral.verifiedBy = req.user.id;
    loan.collateral.verifiedAt = new Date();
    loan.updatedBy = req.user.id;

    await loan.save();

    // Recalculate risk after collateral verification
    loan.calculateRisk();
    await loan.save();

    res.status(200).json({
      success: true,
      message: "Collateral verified successfully",
      data: loan
    });
  } catch (error) {
    console.error("Error verifying collateral:", error);
    res.status(500).json({
      success: false,
      message: "Failed to verify collateral"
    });
  }
};

// @desc    Record payment
// @route   POST /api/loans/:id/payments
// @access  Private
exports.recordPayment = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { amount, method, reference, notes } = req.body;

    if (!amount || amount <= 0) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Valid payment amount required"
      });
    }

    const loan = await Loan.findOne({ 
      _id: req.params.id, 
      isDeleted: false 
    }).session(session);

    if (!loan) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "Loan not found"
      });
    }

    if (loan.status !== 'active' && loan.status !== 'overdue') {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: `Cannot record payment for loan with status: ${loan.status}`
      });
    }

    // Create payment
    const payment = {
      paymentId: `PAY-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      amount: parseFloat(amount),
      date: new Date(),
      method,
      reference,
      notes,
      recordedBy: req.user.id
    };

    loan.payments.push(payment);
    loan.paidAmount += parseFloat(amount);
    loan.remainingAmount = loan.amount - loan.paidAmount;

    // Update schedule
    const sortedSchedule = [...loan.schedule].sort((a, b) => a.dueDate - b.dueDate);
    let remainingPayment = parseFloat(amount);

    for (let installment of sortedSchedule) {
      if (remainingPayment <= 0) break;
      
      if (installment.status === 'pending') {
        if (remainingPayment >= installment.amount) {
          installment.status = 'paid';
          installment.paidAt = new Date();
          remainingPayment -= installment.amount;
        } else {
          // Partial payment
          break;
        }
      }
    }

    // Update loan status
    loan.updateStatus();
    loan.updatedBy = req.user.id;

    await loan.save({ session });

    // Update borrower repayment stats if loan becomes completed
    if (loan.status === 'completed') {
      await User.findByIdAndUpdate(
        loan.borrower.id,
        {
          $inc: {
            'loanStats.completedLoans': 1,
            'loanStats.totalRepaid': loan.paidAmount
          },
          $set: {
            'loanStats.activeLoans': 0
          }
        },
        { session }
      );
    }

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({
      success: true,
      message: "Payment recorded successfully",
      data: {
        payment,
        remainingAmount: loan.remainingAmount,
        status: loan.status
      }
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("Error recording payment:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to record payment"
    });
  }
};

// @desc    Add note to loan
// @route   POST /api/loans/:id/notes
// @access  Private
exports.addNote = async (req, res) => {
  try {
    const { text } = req.body;

    if (!text) {
      return res.status(400).json({
        success: false,
        message: "Note text is required"
      });
    }

    const loan = await Loan.findOne({ 
      _id: req.params.id, 
      isDeleted: false 
    });

    if (!loan) {
      return res.status(404).json({
        success: false,
        message: "Loan not found"
      });
    }

    loan.notes.push({
      text,
      createdBy: req.user.id,
      createdAt: new Date()
    });

    await loan.save();

    res.status(200).json({
      success: true,
      message: "Note added successfully",
      data: loan.notes[loan.notes.length - 1]
    });
  } catch (error) {
    console.error("Error adding note:", error);
    res.status(500).json({
      success: false,
      message: "Failed to add note"
    });
  }
};

// @desc    Delete loan (soft delete)
// @route   DELETE /api/loans/:id
// @access  Private (Super Admin only)
exports.deleteLoan = async (req, res) => {
  try {
    const loan = await Loan.findById(req.params.id);

    if (!loan) {
      return res.status(404).json({
        success: false,
        message: "Loan not found"
      });
    }

    if (loan.isDeleted) {
      return res.status(400).json({
        success: false,
        message: "Loan already deleted"
      });
    }

    // Soft delete
    loan.isDeleted = true;
    loan.deletedAt = new Date();
    loan.deletedBy = req.user.id;
    await loan.save();

    res.status(200).json({
      success: true,
      message: "Loan deleted successfully"
    });
  } catch (error) {
    console.error("Error deleting loan:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete loan"
    });
  }
};

// @desc    Get loan statistics
// @route   GET /api/loans/stats/overview
// @access  Private
exports.getLoanStats = async (req, res) => {
  try {
    const matchQuery = { isDeleted: false };
    
    // Add role-based filtering
    if (req.user.role === 'borrower') {
      matchQuery['borrower.id'] = req.user.id;
    } else if (req.user.role === 'guarantor') {
      matchQuery['guarantor.id'] = req.user.id;
    }

    const stats = await Loan.aggregate([
      { $match: matchQuery },
      { $group: {
        _id: "$status",
        count: { $sum: 1 },
        totalAmount: { $sum: "$amount" },
        paidAmount: { $sum: "$paidAmount" },
        remainingAmount: { $sum: "$remainingAmount" }
      }}
    ]);

    const riskStats = await Loan.aggregate([
      { $match: matchQuery },
      { $group: {
        _id: "$risk.level",
        count: { $sum: 1 },
        avgScore: { $avg: "$risk.score" }
      }}
    ]);

    const monthlyTrend = await Loan.aggregate([
      { $match: matchQuery },
      { $group: {
        _id: { 
          year: { $year: "$createdAt" },
          month: { $month: "$createdAt" }
        },
        count: { $sum: 1 },
        amount: { $sum: "$amount" }
      }},
      { $sort: { "_id.year": -1, "_id.month": -1 } },
      { $limit: 12 }
    ]);

    res.status(200).json({
      success: true,
      data: {
        byStatus: stats,
        byRisk: riskStats,
        monthlyTrend
      }
    });
  } catch (error) {
    console.error("Error fetching loan stats:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch loan statistics"
    });
  }
};

// @desc    Check if National ID exists
// @route   POST /api/loans/check-national-id
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

    const existingUser = await User.findOne(query).select('name email phone');

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

// Helper function to generate payment schedule
function generatePaymentSchedule(amount, interestRate, term, startDate, frequency) {
  const schedule = [];
  
  // If interest rate is 0, it's interest-free
  if (interestRate === 0) {
    const paymentPerInstallment = amount / term;
    const start = new Date(startDate);
    
    for (let i = 1; i <= term; i++) {
      const dueDate = new Date(start);
      
      // Adjust based on frequency
      switch(frequency) {
        case 'weekly':
          dueDate.setDate(dueDate.getDate() + (i * 7));
          break;
        case 'biweekly':
          dueDate.setDate(dueDate.getDate() + (i * 14));
          break;
        case 'monthly':
        default:
          dueDate.setMonth(dueDate.getMonth() + i);
          break;
        case 'quarterly':
          dueDate.setMonth(dueDate.getMonth() + (i * 3));
          break;
      }
      
      schedule.push({
        installmentNo: i,
        dueDate,
        amount: Math.round(paymentPerInstallment * 100) / 100,
        principal: Math.round(paymentPerInstallment * 100) / 100,
        interest: 0,
        status: 'pending'
      });
    }
  } else {
    // Interest-bearing loan
    const monthlyInterestRate = interestRate / 100 / 12;
    const monthlyPayment = (amount * monthlyInterestRate * Math.pow(1 + monthlyInterestRate, term)) / 
                          (Math.pow(1 + monthlyInterestRate, term) - 1);
    
    let remainingBalance = amount;
    const start = new Date(startDate);

    for (let i = 1; i <= term; i++) {
      const interest = remainingBalance * monthlyInterestRate;
      const principal = monthlyPayment - interest;
      remainingBalance -= principal;

      const dueDate = new Date(start);
      
      switch(frequency) {
        case 'weekly':
          dueDate.setDate(dueDate.getDate() + (i * 7));
          break;
        case 'biweekly':
          dueDate.setDate(dueDate.getDate() + (i * 14));
          break;
        case 'monthly':
        default:
          dueDate.setMonth(dueDate.getMonth() + i);
          break;
        case 'quarterly':
          dueDate.setMonth(dueDate.getMonth() + (i * 3));
          break;
      }

      schedule.push({
        installmentNo: i,
        dueDate,
        amount: Math.round(monthlyPayment * 100) / 100,
        principal: Math.round(principal * 100) / 100,
        interest: Math.round(interest * 100) / 100,
        status: 'pending'
      });
    }
  }

  return schedule;
}


// @desc    Get all loans with accurate payment progress
// @route   GET /api/loans/with-progress
// @access  Private (Admin)
exports.getLoansWithProgress = async (req, res) => {
  try {
    const {
      status,
      risk,
      page = 1,
      limit = 10,
      search
    } = req.query;

    const query = { isDeleted: false };
    if (status && status !== 'all') query.status = status;
    if (risk && risk !== 'all') query['risk.level'] = risk;
    
    if (search) {
      query.$or = [
        { loanId: { $regex: search, $options: 'i' } },
        { 'borrower.name': { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const loans = await Loan.find(query)
      .populate('borrower.id', 'name email phone')
      .sort('-createdAt')
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Loan.countDocuments(query);

    // Get all successful payments for these loans
    const loanIds = loans.map(loan => loan._id);
    const payments = await LoanPayment.find({
      loanId: { $in: loanIds },
      status: 'success'
    });

    // Create a map of loanId -> total paid amount
    const paidAmountMap = {};
    payments.forEach(payment => {
      const loanIdStr = payment.loanId.toString();
      if (!paidAmountMap[loanIdStr]) {
        paidAmountMap[loanIdStr] = 0;
      }
      paidAmountMap[loanIdStr] += payment.amount;
    });

    // Add accurate progress data to each loan
    const loansWithProgress = loans.map(loan => {
      const loanObj = loan.toObject();
      const loanIdStr = loan._id.toString();
      
      // Get total paid amount from payments map
      const totalPaidAmount = paidAmountMap[loanIdStr] || 0;
      
      // Get schedule if it exists
      const schedule = loan.schedule || [];
      const totalInstallments = schedule.length || loan.term || 1;
      
      // Calculate installment amount
      const installmentAmount = loan.amount / totalInstallments;
      
// Calculate how many installments are paid based on total paid amount
let paidInstallments = 0;
if (installmentAmount > 0 && totalPaidAmount > 0) {
  // Add a small epsilon to handle floating point precision
  const epsilon = 0.01;
  paidInstallments = Math.floor((totalPaidAmount + epsilon) / installmentAmount);
  
  // Cap at total installments
  if (paidInstallments > totalInstallments) {
    paidInstallments = totalInstallments;
  }

}
      
      // Calculate progress based on installments
      const progress = totalInstallments > 0 
        ? (paidInstallments / totalInstallments) * 100 
        : 0;

      // Calculate remaining amount
      const remainingAmount = loan.amount - totalPaidAmount;

      console.log(`Loan ${loan.loanId}:`, {
        totalPaidAmount,
        installmentAmount,
        paidInstallments,
        totalInstallments,
        progress
      });

      return {
        ...loanObj,
        paidAmount: totalPaidAmount,
        remainingAmount: remainingAmount,
        progress: Number(progress.toFixed(2)),
        paidInstallments,
        totalInstallments,
        installmentAmount: Number(installmentAmount.toFixed(2))
      };
    });

    // Calculate summary stats
    const summary = {
      totalAmount: loansWithProgress.reduce((sum, l) => sum + l.amount, 0),
      totalPaid: loansWithProgress.reduce((sum, l) => sum + l.paidAmount, 0),
      totalRemaining: loansWithProgress.reduce((sum, l) => sum + l.remainingAmount, 0),
      activeLoans: loansWithProgress.filter(l => l.status === 'active').length,
      overdueLoans: loansWithProgress.filter(l => l.status === 'overdue').length,
      completedLoans: loansWithProgress.filter(l => l.status === 'completed').length,
      pendingLoans: loansWithProgress.filter(l => l.status === 'pending').length,
      lowRisk: loansWithProgress.filter(l => l.risk?.level === 'low').length,
      mediumRisk: loansWithProgress.filter(l => l.risk?.level === 'medium').length,
      highRisk: loansWithProgress.filter(l => l.risk?.level === 'high').length,
      criticalRisk: loansWithProgress.filter(l => l.risk?.level === 'critical').length
    };

    res.status(200).json({
      success: true,
      data: loansWithProgress,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      },
      summary
    });
  } catch (error) {
    console.error("Error fetching loans with progress:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch loans"
    });
  }
};