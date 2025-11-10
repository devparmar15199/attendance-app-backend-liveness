import express from 'express';
import { 
    validateQRCode,
    getSessionStatus,
    getActiveSessions, 
} from '../controllers/qrController.js';
import { protect } from '../../middleware/authMiddleware.js';

const router = express.Router();

/**
 * @route   POST /api/qr/validate
 * @desc    Validate a QR code token and get session details
 * @access  Private (Student)
 */
router.post('/validate', protect, validateQRCode);

// --- NEW STUDENT FEATURES ---

/**
 * @route   GET /api/qr/session/status/:classId
 * @desc    Check if an attendance session is currently active for a specific class
 * @access  Private (Student)
 */
router.get('/session/status/:classId', protect, getSessionStatus);

/**
 * @route   GET /api/qr/session/active
 * @desc    Get all currently active attendance sessions for the student's enrolled classes
 * @access  Private (Student)
 */
router.get('/session/active', protect, getActiveSessions);

export default router;