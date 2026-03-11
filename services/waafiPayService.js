const axios = require('axios');

/**
 * Format the user's phone number to ensure it starts with '252'
 */
const formatPhone = (phone) => {
  // Remove any non-digit characters
  let cleanPhone = phone.replace(/\D/g, '');
  
  // If it doesn't start with 252, add it
  if (!cleanPhone.startsWith('252')) {
    // Remove leading zero if present
    cleanPhone = cleanPhone.replace(/^0+/, '');
    cleanPhone = `252${cleanPhone}`;
  }
  
  return cleanPhone;
};

/**
 * Build the payload required by WaafiPay API
 */
const buildPayload = ({ phone, amount, invoiceId, description, paymentMethod }) => {
  const formattedAmount = parseFloat(amount).toFixed(2);
  
  return {
    schemaVersion: "1.0",
    requestId: Date.now().toString(),
    timestamp: new Date().toISOString(),
    channelName: "WEB",
    serviceName: "API_PURCHASE",
    serviceParams: {
      merchantUid: process.env.MERCHANT_UID,
      apiUserId: process.env.API_USER_ID,
      apiKey: process.env.API_KEY,
      paymentMethod: "MWALLET_ACCOUNT",
      payerInfo: {
        accountNo: formatPhone(phone),
      },
      transactionInfo: {
        referenceId: `ref-${Date.now()}`,
        invoiceId,
        amount: parseFloat(formattedAmount),
        currency: "USD",
        description: description || "Loan Payment",
      },
    },
  };
};

/**
 * Make a one-time payment request to WaafiPay
 */
const processWaafiPayPayment = async (paymentData) => {
  const payload = buildPayload(paymentData);

  console.log("🔄 Sending payment payload to WaafiPay:", JSON.stringify(payload, null, 2));

  try {
    const response = await axios.post(
      process.env.PAYMENT_API_URL || 'https://api.waafipay.com/asm',
      payload,
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 60000, // 60 seconds timeout
      }
    );

    console.log("✅ WaafiPay API response:", JSON.stringify(response.data, null, 2));
    return response.data;

  } catch (error) {
    console.error("❌ WaafiPay API error:", {
      message: error.message,
      response: error.response?.data,
      stack: error.stack,
    });
    throw error;
  }
};

/**
 * Check if payment was successful based on response
 */
const isPaymentSuccessful = (response) => {
  const code = String(response?.responseCode || '');
  const statusCode = String(response?.statusCode || '');
  const transactionStatus = response?.transactionInfo?.status?.toUpperCase() || '';
  const responseMsg = String(response?.responseMsg || response?.responseMessage || '').toUpperCase();

  return (
    code === '0' ||
    statusCode === '2001' ||
    transactionStatus === 'SUCCESS' ||
    responseMsg.includes('SUCCESS') ||
    responseMsg === 'RCS_SUCCESS'
  );
};

module.exports = {
  processWaafiPayPayment,
  isPaymentSuccessful,
  formatPhone
};