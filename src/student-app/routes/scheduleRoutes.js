// File: src/api/routes/scheduleRoutes.js
import express from 'express';
import { protect } from '../../middleware/authMiddleware.js';
import {
  getTodaySchedule,
  getWeekSchedule,
  getScheduleByDate,
  getScheduleInstanceDetails
} from '../controllers/scheduleController.js'; // You will need to create this controller

const router = express.Router();

/**
 * @route   GET /api/schedule/today
 * @desc    Get the student's schedule for today
 * @access  Private (Student)
 */
router.get('/today', protect, getTodaySchedule);

/**
 * @route   GET /api/schedule/week
 * @desc    Get the student's schedule for the current week (e.g., Mon-Fri)
 * @access  Private (Student)
 */
router.get('/week', protect, getWeekSchedule);

/**
 * @route   GET /api/schedule/date/:date
 * @desc    Get the student's schedule for a specific date (e.g., "2025-11-20")
 * @access  Private (Student)
 */
router.get('/date/:date', protect, getScheduleByDate);

/**
 * @route   GET /api/schedule/:instanceId
 * @desc    Get the full details for a single class/schedule instance
 * (e.g., teacher, room, time, notes)
 * @access  Private (Student)
 */
router.get('/:instanceId', protect, getScheduleInstanceDetails);

export default router;