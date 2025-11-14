import multer from 'multer';

/**
 * @const {object} storage
 * @description Configures multer to store uploaded files in memory as Buffers.
 * This is efficient for when files need to be processed or proxied
 * to cloud storage (like S3) without saving them to disk first.
 */
const storage = multer.memoryStorage();

/**
 * @function fileFilter
 * @description A multer filter function to ensure only image files are accepted.
 * @param {object} req - The Express request object.
 * @param {object} file - The file object provided by multer.
 * @param {function} cb - The callback function to accept or reject the file.
 */
const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true); // Accept file
  } else {
    cb(new Error('Only image files are allowed'), false); // Reject file
  }
};

/**
 * @const {object} upload
 * @description The main configured multer instance.
 * It uses memory storage, the image file filter, and sets limits
 * for file size (10MB) and file count (1).
 */
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    files: 1 // Only one file at a time
  }
});

/**
 * @const {function} uploadFaceImage
 * @description A specific multer middleware instance configured to accept
 * a single file from a field named 'faceImage'.
 * This is used in routes that handle face registration or verification.
 */
const uploadFaceImage = upload.fields([
  { name: 'faceImage', maxCount: 1 }
]);

/**
 * Custom error handling middleware for multer.
 * This catches errors thrown by multer (like file size limits)
 * and the custom file filter, responding with a clean JSON error message.
 *
 * @param {object} error - The error object.
 * @param {object} req - Express request object.
 * @param {object} res - Express response object.
 * @param {function} next - Express next middleware function.
 */
const handleMulterError = (error, req, res, next) => {
  // Handle specific Multer-generated errors
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        message: 'File too large. Maximum size is 10MB.',
        error: 'FILE_TOO_LARGE'
      });
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        message: 'Too many files. Only one file allowed.',
        error: 'TOO_MANY_FILES'
      });
    }
    if (error.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({
        message: 'Unexpected file field.',
        error: 'UNEXPECTED_FILE'
      });
    }
  }

  // Handle our custom file filter error
  if (error.message === 'Only image files are allowed') {
    return res.status(400).json({
      message: error.message,
      error: 'INVALID_FILE_TYPE'
    });
  }

  // Pass on any other errors
  next(error);
};

export {
  uploadFaceImage,
  handleMulterError
};