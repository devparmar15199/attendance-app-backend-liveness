import express from 'express';
import {
    syncAttendance,
    getMyAttendanceRecords,
    getMyAttendanceRecordsByClass,
    getMyAttendanceSummary,
    getMyClassAttendanceSummary,
    getLivenessChallenges,
    submitAttendanceWithFaceVerification,
} from '../controllers/attendanceController.js';

import { protect } from '../../middleware/authMiddleware.js';

const router = express.Router();

/**
 * @route   GET /api/student/attendance/liveness/challenges
 * @desc    Get random liveness challenges for enhanced face verification
 * @access  Private (Student)
 */
router.get('/liveness/challenges', protect, getLivenessChallenges);

// --- POST Routes (Submitting Data) ---

/**
 * @route   POST /api/student/attendance/
 * @desc    Submit a new attendance record (main endpoint for QR/Face scan)
 * @access  Private (Student)
 * @deprecated not used anymore
 */
// router.post('/', protect, submitAttendance);

/**
 * @route   POST /api/student/attendance/verify
 * @desc    Submit attendance with enhanced liveness verification (multiple face images)
 * @access  Private (Student)
 */
router.post('/verify', protect, submitAttendanceWithFaceVerification);

/**
 * @route   POST /api/student/attendance/sync
 * @desc    Sync offline attendance records from the client
 * @access  Private (Student)
 */
router.post('/sync', protect, syncAttendance);

// --- GET Routes (Fetching Data) ---

/**
 * @route   GET /api/student/attendance/records
 * @desc    Get all attendance records for the logged-in student (paginated)
 * @access  Private (Student)
 */
router.get('/records', protect, getMyAttendanceRecords);

/**
 * @route   GET /api/student/attendance/records/class/:classId
 * @desc    Get all attendance records for a specific class
 * @access  Private (Student)
 */
router.get('/records/class/:classId', protect, getMyAttendanceRecordsByClass);

/**
 * @route   GET /api/student/attendance/summary
 * @desc    Get attendance summary (e.g., 85% total) for all enrolled classes
 * @access  Private (Student)
 */
router.get('/summary', protect, getMyAttendanceSummary);

/**
 * @route   GET /api/student/attendance/summary/class/:classId
 * @desc    Get detailed summary (e.g., 90%, 3 missed) for one class
 * @access  Private (Student)
 */
router.get('/summary/class/:classId', protect, getMyClassAttendanceSummary);

/**
 * @route   GET /api/student/attendance/missed
 * @desc    Get a list of all classes the student has missed
 * @access  Private (Student)
 */
// router.get('/missed', protect, getMyMissedClasses);

export default router;