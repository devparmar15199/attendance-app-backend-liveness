import { ScheduleInstance } from '../../models/recurringScheduleModel.js';
import { ClassEnrollment } from '../../models/classEnrollmentModel.js';
import { Class } from '../../models/classModel.js';
import { User } from '../../models/userModel.js';

// --- Date Helper Functions (Based on server location: IST/India) ---

/**
 * @description Gets the start and end Date objects for "today" in the
 * institution's timezone (IST, UTC+5:30).
 * Assumes "today" is November 10, 2025.
 * @returns {{start: Date, end: Date}}
 */
const getTodayDateRange = () => {
    // We use the provided context: Today is Nov 10, 2025.
    // We explicitly set the timezone to IST (+05:30) for accuracy.
    const start = new Date('2025-11-10T00:00:00.000+05:30');
    const end = new Date('2025-11-10T23:59:59.999+05:30');
    return { start, end };
};

/**
 * @description Gets the start and end Date objects for the "current academic week"
 * (Mon-Fri) in the institution's timezone (IST, UTC+5:30).
 * Assumes "today" is Monday, Nov 10, 2025.
 * @returns {{start: Date, end: Date}}
 */
const getWeekDateRange = () => {
    // Today is Monday, Nov 10, 2025.
    const start = new Date('2025-11-10T00:00:00.000+05:30'); // Monday
    const end = new Date('2025-11-14T23:59:59.999+05:30'); // Friday
    return { start, end };
};

/**
 * @description Reusable helper to get a student's schedule for a given date range.
 * @param {string} studentId - The ID of the logged-in student.
 * @param {Date} startDate - The start of the date range (UTC).
 * @param {Date} endDate - The end of the date range (UTC).
 * @returns {Promise<Array>} A promise that resolves to an array of schedule instances.
 */
const getStudentScheduleForDateRange = async (studentId, startDate, endDate) => {
    // 1. Find all classes the student is enrolled in
    const enrollments = await ClassEnrollment.find({ studentId }).select('classId').lean();
    const enrolledClassIds = enrollments.map(e => e.classId);

    if (enrolledClassIds.length === 0) {
        return []; // Student isn't enrolled in any classes
    }

    // 2. Find all schedule instances for those classes within the date range
    const schedule = await ScheduleInstance.find({
        classId: { $in: enrolledClassIds },
        scheduledDate: { $gte: startDate, $lte: endDate },
        status: { $ne: 'cancelled' } // Don't show cancelled classes
    })
    .populate('classId', 'subjectName subjectCode roomNumber') // Get class info
    .populate('teacherId', 'fullName email') // Get teacher info
    .sort({ scheduledDate: 1, startTime: 1 }) // Sort by date, then by time
    .lean(); // Use .lean() for fast, read-only operations

    return schedule;
};

// --- Exported Controller Functions ---

/**
 * @desc    Get the student's schedule for today
 * @route   GET /api/schedule/today
 * @access  Private (Student)
 */
export const getTodaySchedule = async (req, res) => {
    try {
        const studentId = req.user.id;
        const { start, end } = getTodayDateRange();

        const schedule = await getStudentScheduleForDateRange(studentId, start, end);

        res.status(200).json({
            message: "Today's schedule fetched successfully.",
            date: start.toISOString().split('T')[0], // e.g., "2025-11-10"
            count: schedule.length,
            schedule: schedule
        });
    } catch (error) {
        console.error("Error in getTodaySchedule:", error);
        res.status(500).json({ message: "Failed to fetch today's schedule." });
    }
};

/**
 * @desc    Get the student's schedule for the current week (Mon-Fri)
 * @route   GET /api/schedule/week
 * @access  Private (Student)
 */
export const getWeekSchedule = async (req, res) => {
    try {
        const studentId = req.user.id;
        const { start, end } = getWeekDateRange();

        const schedule = await getStudentScheduleForDateRange(studentId, start, end);

        res.status(200).json({
            message: "This week's schedule fetched successfully.",
            startDate: start.toISOString().split('T')[0],
            endDate: end.toISOString().split('T')[0],
            count: schedule.length,
            schedule: schedule
        });
    } catch (error) {
        console.error("Error in getWeekSchedule:", error);
        res.status(500).json({ message: "Failed to fetch this week's schedule." });
    }
};

/**
 * @desc    Get the student's schedule for a specific date
 * @route   GET /api/schedule/date/:date
 * @access  Private (Student)
 */
export const getScheduleByDate = async (req, res) => {
    try {
        const studentId = req.user.id;
        const { date } = req.params; // Expects format "YYYY-MM-DD"

        if (!date) {
            return res.status(400).json({ message: "Date parameter is required." });
        }

        // Create date range for the specified day in IST
        const startDate = new Date(`${date}T00:00:00.000+05:30`);
        const endDate = new Date(`${date}T23:59:59.999+05:30`);

        if (isNaN(startDate.getTime())) {
            return res.status(400).json({ message: "Invalid date format. Please use YYYY-MM-DD." });
        }

        const schedule = await getStudentScheduleForDateRange(studentId, startDate, endDate);

        res.status(200).json({
            message: `Schedule for ${date} fetched successfully.`,
            date: date,
            count: schedule.length,
            schedule: schedule
        });
    } catch (error) {
        console.error("Error in getScheduleByDate:", error);
        res.status(500).json({ message: "Failed to fetch schedule for the specified date." });
    }
};

/**
 * @desc    Get the full details for a single class/schedule instance
 * @route   GET /api/schedule/:instanceId
 * @access  Private (Student)
 */
export const getScheduleInstanceDetails = async (req, res) => {
    try {
        const studentId = req.user.id;
        const { instanceId } = req.params;

        if (!instanceId.match(/^[0-9a-fA-F]{24}$/)) {
            return res.status(400).json({ message: "Invalid schedule ID format." });
        }

        const scheduleInstance = await ScheduleInstance.findById(instanceId)
            .populate('classId') // Populate full class details
            .populate('teacherId', 'fullName email') // Populate teacher details
            .populate('overrideId'); // Populate if it was overridden

        if (!scheduleInstance) {
            return res.status(404).json({ message: "Schedule instance not found." });
        }

        // --- Security Check ---
        // Verify the student is actually enrolled in the class for this instance
        const enrollment = await ClassEnrollment.findOne({
            studentId: studentId,
            classId: scheduleInstance.classId._id
        });

        if (!enrollment) {
            return res.status(403).json({ message: "You are not authorized to view this schedule instance." });
        }

        res.status(200).json({
            message: "Schedule instance details fetched successfully.",
            details: scheduleInstance
        });

    } catch (error) {
        console.error("Error in getScheduleInstanceDetails:", error);
        res.status(500).json({ message: "Failed to fetch schedule instance details." });
    }
};