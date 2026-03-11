const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Create upload directories if they don't exist
const createDir = (dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

createDir('uploads/ids');
createDir('uploads/business');
createDir('uploads/collateral');
createDir('uploads/guarantor');
createDir('uploads/misc');

// Configure storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let uploadPath = 'uploads/';
    
    // Determine folder based on fieldname
    if (file.fieldname.includes('idFront') || file.fieldname.includes('idBack') || file.fieldname.includes('idImage')) {
      uploadPath += 'ids/';
    } else if (file.fieldname.includes('business') || file.fieldname.includes('license')) {
      uploadPath += 'business/';
    } else if (file.fieldname.includes('collateral')) {
      uploadPath += 'collateral/';
    } else if (file.fieldname.includes('guarantor') || file.fieldname.includes('incomeProof')) {
      uploadPath += 'guarantor/';
    } else {
      uploadPath += 'misc/';
    }
    
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + '-' + uniqueSuffix + ext);
  }
});

// File filter
const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|pdf|doc|docx/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);
  
  if (mimetype && extname) {
    return cb(null, true);
  } else {
    cb(new Error('Only images and documents are allowed'));
  }
};

// Create multer upload instance
const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: fileFilter
});

// Helper to get file URL (FIXED - removes duplicate /uploads/)
const getFileUrl = (req, filePath) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  // filePath example: "uploads/ids/file-123.jpg"
  return `${baseUrl}/${filePath.replace(/\\/g, '/')}`;
};

module.exports = { upload, getFileUrl };