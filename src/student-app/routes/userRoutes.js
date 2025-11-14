import express from 'express';
import { 
    getProfile, 
    updateProfile, 
    changePassword,
    updateFaceImage,
} from '../controllers/userController.js';
import { protect } from '../../middleware/authMiddleware.js';
import {uploadFaceImage, handleMulterError } from '../../middleware/uploadMiddleware.js';

const router = express.Router();

// Protected routes
router.get('/profile', protect, getProfile);
router.put('/profile', protect, updateProfile);
router.put('/change-password', protect, changePassword);

router.put('/profile/face', protect, uploadFaceImage, handleMulterError, updateFaceImage);

export default router;