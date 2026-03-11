// routes/uploadRoutes.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { protect } = require('../middleware/authMiddleware');

// Ensure upload directories exist
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
    
    // Determine folder based on file type
    const fileType = req.body.type || file.fieldname;
    
    if (fileType.includes('id') || file.fieldname.includes('id')) {
      uploadPath += 'ids/';
    } else if (fileType.includes('business') || file.fieldname.includes('business') || file.fieldname.includes('license')) {
      uploadPath += 'business/';
    } else if (fileType.includes('collateral') || file.fieldname.includes('collateral')) {
      uploadPath += 'collateral/';
    } else if (fileType.includes('guarantor') || file.fieldname.includes('guarantor') || file.fieldname.includes('incomeProof')) {
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
  }
  cb(new Error('Only images and documents are allowed'));
};

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: fileFilter
});

// Single file upload - FIXED URL (removes duplicate /uploads/)
router.post('/', protect, upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    // Fix: Create proper URL without duplicate /uploads/
    // req.file.path example: "uploads/ids/file-123456.jpg"
    const relativePath = req.file.path.replace(/\\/g, '/');
    const fileUrl = `${req.protocol}://${req.get('host')}/${relativePath}`;

    res.status(200).json({
      success: true,
      message: 'File uploaded successfully',
      fileUrl: fileUrl,
      fileName: req.file.filename,
      originalName: req.file.originalname,
      path: req.file.path,
      type: req.file.mimetype,
      size: req.file.size
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Upload failed'
    });
  }
});

// Multiple files upload
router.post('/multiple', protect, upload.array('files', 10), (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No files uploaded'
      });
    }

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const files = req.files.map(file => {
      const relativePath = file.path.replace(/\\/g, '/');
      return {
        name: file.originalname,
        url: `${baseUrl}/${relativePath}`,
        type: file.mimetype,
        size: file.size,
        fileName: file.filename,
        path: file.path
      };
    });

    res.status(200).json({
      success: true,
      message: 'Files uploaded successfully',
      files: files
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Upload failed'
    });
  }
});

// Delete file
router.delete('/', protect, (req, res) => {
  try {
    const { filePath } = req.body;
    
    if (!filePath) {
      return res.status(400).json({
        success: false,
        message: 'File path is required'
      });
    }

    // Extract relative path from URL if needed
    let relativePath = filePath;
    if (filePath.includes('://')) {
      // It's a URL, extract the path after the host
      const urlParts = new URL(filePath);
      relativePath = urlParts.pathname.substring(1); // Remove leading '/'
    }

    if (fs.existsSync(relativePath)) {
      fs.unlinkSync(relativePath);
      res.status(200).json({
        success: true,
        message: 'File deleted successfully'
      });
    } else {
      res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Delete failed'
    });
  }
});

module.exports = router;

