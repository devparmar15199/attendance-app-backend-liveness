import express from 'express';
import { 
    getProfile, 
    updateProfile, 
    changePassword,
    updateFaceImage,
} from '../controllers/userController.js';
import { protect } from '../../middleware/authMiddleware.js';
import { uploadFaceImage } from '../../AWS/s3Service.js';
import { handleMulterError } from '../../middleware/uploadMiddleware.js';

const router = express.Router();

// Protected routes
router.get('/profile', protect, getProfile);
router.put('/profile', protect, updateProfile);
router.put('/change-password', protect, changePassword);

// NEW STUDENT ENDPOINTS
/**
 * @route   PUT /api/users/profile/face
 * @desc    Update the student's registered face image
 * @access  Private (Student)
 */
router.put('/profile/face', protect, uploadFaceImage, handleMulterError, updateFaceImage);

export default router;