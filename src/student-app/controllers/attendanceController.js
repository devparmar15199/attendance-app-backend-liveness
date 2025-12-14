import { Attendance } from '../../models/attendanceModel.js';
import { QRCodeSession } from '../../models/qrCodeSessionModel.js';
import { ClassEnrollment } from '../../models/classEnrollmentModel.js';
import { User } from '../../models/userModel.js';
import { ScheduleInstance } from '../../models/recurringScheduleModel.js';
import { Class } from '../../models/classModel.js';
import { 
  createLivenessSession,
  verifyLivenessAndCompare,
  getLivenessSessionResults
} from '../../AWS/faceLivenessService.js';
import {
  verifyLivenessWithChallenges,
  compareFaceWithProfile,
  validateLivenessChallenge
} from '../../AWS/faceComparisonService.js';

/**
 * @desc    Start a face liveness session (Step 1)
 * @route   GET /api/student/attendance/liveness/init
 * @access  Private (Student)
 */
export const startAttendanceSession = async (req, res) => {
  try {
    const userId = req.user.id;

    // Create AWS Liveness session
    const sessionId = await createLivenessSession(userId);

    console.log(`✅ [Liveness] Session created for user ${userId}: ${sessionId}`);
    
    res.status(200).json({ 
      success: true,
      sessionId,
      message: 'Liveness session created. Proceed with face scan.'
    });
  } catch (error) {
    console.error('❌ [Liveness] Failed to create session:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to start face verification session.',
      error: error.message 
    });
  }
};

/**
 * @desc    Submit attendance after frontend completes liveness check (Step 2)
 * @route   POST /api/student/attendance
 * @access  Private (Student)
 * 
 * Expected Body:
 * {
 *   "sessionId": "abc123-liveness-session-id",  // From AWS Liveness
 *   "classId": "64f1a2b3c4d5e6f7g8h9i0j1",
 *   "studentCoordinates": { "latitude": 18.123, "longitude": 73.456 }
 * }
 */
export const submitAttendance = async (req, res) => {
  console.log('🔄 [Attendance] Starting attendance submission');
  try {
    const { 
      sessionId, 
      classId, 
      studentCoordinates
    } = req.body;
    
    const studentId = req.user.id;

    // --- 1. Input Validation ---
    if (!sessionId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Liveness session ID is required.' 
      });
    }
    if (!classId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Class ID is required.' 
      });
    }
    if (!studentCoordinates?.latitude || !studentCoordinates?.longitude) {
      return res.status(400).json({ 
        success: false, 
        message: 'Student coordinates are required.' 
      });
    }

    // --- 2. Verify QR Session is Active ---
    console.log('🔍 [Attendance] Verifying QR session for class:', classId);
    
    const qrSession = await QRCodeSession.findOne({
      classId,
      isActive: true,
      sessionExpiresAt: { $gt: new Date() }
    });

    if (!qrSession) {
      console.log('❌ [Attendance] No active QR session found');
      return res.status(400).json({ 
        success: false, 
        message: 'No active attendance session. QR code may have expired.' 
      });
    }
    console.log('✅ [Attendance] QR session verified:', qrSession.sessionId);
    
    // --- 3. Check for Duplicate Attendance ---
    const existingAttendance = await Attendance.findOne({ 
      studentId, 
      sessionId: qrSession._id 
    });
    
    if (existingAttendance) {
      console.log('⚠️ [Attendance] Duplicate attempt detected');
      return res.status(409).json({ 
        success: false, 
        message: 'Attendance already marked for this session.' 
      });
    }
    console.log('✅ [Attendance] No duplicate found');

    // --- 4. Get Student Profile with Face Image ---
    const student = await User.findById(studentId);
    
    if (!student) {
      return res.status(404).json({ 
        success: false, 
        message: 'Student not found.' 
      });
    }
    
    if (!student.faceImageS3Key) {
      return res.status(400).json({ 
        success: false, 
        message: 'No profile photo registered. Please upload your face photo first.' 
      });
    }
    console.log(`👤 [Attendance] Student found: ${student.fullName}`);
    
    // --- 5. 🔐 VERIFY LIVENESS & FACE MATCH ---
    console.log(`🤖 [Attendance] Verifying liveness session: ${sessionId}`);
    console.log(`🖼️ [Attendance] Comparing with stored image: ${student.faceImageS3Key}`);
    
    const verificationResult = await verifyLivenessAndCompare(
      sessionId, 
      student.faceImageS3Key
    );

    // Handle verification failure
    if (!verificationResult.success) {
      console.log(`❌ [Attendance] Verification failed: ${verificationResult.reason}`);
      
      // Return appropriate error based on failure reason
      const errorMessages = {
        'LIVENESS_NOT_COMPLETED': 'Please complete the face scan properly.',
        'LOW_CONFIDENCE': 'Liveness check failed. Ensure good lighting and try again.',
        'NO_REFERENCE_IMAGE': 'Face scan did not capture properly. Please retry.',
        'FACE_NOT_MATCHED': 'Face does not match your registered profile.',
        'INVALID_SESSION': 'Session expired. Please scan QR code again.',
        'PROFILE_IMAGE_NOT_FOUND': 'Profile image not found. Please re-upload your photo.'
      };

      return res.status(400).json({ 
        success: false,
        reason: verificationResult.reason,
        message: errorMessages[verificationResult.reason] || verificationResult.message
      });
    }

    console.log(`✅ [Attendance] Identity Verified!`);
    console.log(`   Liveness Confidence: ${verificationResult.livenessConfidence}%`);
    console.log(`   Face Similarity: ${verificationResult.similarity}%`);

    // --- 6. Save Attendance Record ---
    console.log('💾 [Attendance] Saving attendance record');
    
    const attendanceRecord = new Attendance({
      studentId,
      classId,
      sessionId: qrSession._id,
      scheduleId: qrSession.scheduleId,
      studentCoordinates,
      status: 'present',
      livenessPassed: true,
      livenessConfidence: verificationResult.livenessConfidence,
      faceSimilarity: verificationResult.similarity,
      timestamp: new Date(),
      manualEntry: false,
    });

    await attendanceRecord.save();
    console.log('✅ [Attendance] Attendance saved successfully');

    // --- 7. Return Success Response ---
    res.status(201).json({
      success: true,
      message: 'Attendance marked successfully!',
      data: {
        attendanceId: attendanceRecord._id,
        classId,
        timestamp: attendanceRecord.timestamp,
        livenessConfidence: verificationResult.livenessConfidence,
        faceSimilarity: verificationResult.similarity
      }
    });

  } catch (error) {
    console.error('❌ [Attendance] Error submitting attendance:', error);
    
    res.status(500).json({ 
      success: false,
      message: 'An unexpected error occurred. Please try again.',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};


/**
 * @desc    Sync multiple offline attendance records
 * @route   POST /api/student/attendance/sync
 * @access  Private (Student)
 */
export const syncAttendance = async (req, res) => {
  try {
    const { attendances } = req.body;
    const studentId = req.user.id;

    if (!Array.isArray(attendances) || attendances.length === 0) {
      return res.status(400).json({ message: 'No attendance records to sync.' });
    }

    const syncResults = [];
    for (const record of attendances) {
      const { sessionId, classId, scheduleId, studentCoordinates, livenessPassed, faceEmbedding, timestamp } = record;
      
      const existing = await Attendance.findOne({ studentId, sessionId });

      if (existing) {
        syncResults.push({ sessionId, status: 'skipped', message: 'Already exists.' });
        continue;
      }

      const newRecord = new Attendance({
        studentId,
        sessionId,
        classId,
        scheduleId,
        studentCoordinates,
        livenessPassed,
        faceEmbedding,
        timestamp: new Date(timestamp),
        synced: true,
        notes: " Synced from offline data",
      });

      await newRecord.save();
      syncResults.push({ sessionId, status: 'success' });
    }

    res.status(200).json({
      message: 'Sync completed.',
      results: syncResults,
    });

  } catch (error) {
    console.error('Sync error:', error);
    res.status(500).json({ message: error.message });
  }
};

// --- (NEW) Get Student's Attendance Records (Paginated) ---

/**
 * @desc    Get all attendance records for the logged-in student, paginated.
 * @route   GET /api/attendance/records
 * @access  Private (Student)
 */
export const getMyAttendanceRecords = async (req, res) => {
  try {
    const studentId = req.user.id;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const skip = (page - 1) * limit;

    const records = await Attendance.find({ studentId })
      .populate('classId', 'subjectName subjectCode')
      .sort({ timestamp: -1 })
      .limit(limit)
      .skip(skip)
      .lean(); // Use .lean() for faster read-only queries

    const totalRecords = await Attendance.countDocuments({ studentId });
    const totalPages = Math.ceil(totalRecords / limit);

    res.status(200).json({
      message: "Records fetched successfully",
      data: records,
      pagination: {
        totalRecords,
        totalPages,
        currentPage: page,
        limit
      }
    });
  } catch (error) {
    console.error('Error fetching attendance records:', error);
    res.status(500).json({ message: 'Failed to fetch attendance records.' });
  }
};

// --- (NEW) Get Student's Records by Class (Paginated) ---

/**
 * @desc    Get all attendance records for a specific class, paginated.
 * @route   GET /api/attendance/records/class/:classId
 * @access  Private (Student)
 */
export const getMyAttendanceRecordsByClass = async (req, res) => {
  try {
    const studentId = req.user.id;
    const { classId } = req.params;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const skip = (page - 1) * limit;

    const records = await Attendance.find({ studentId, classId })
      .populate('classId', 'subjectName subjectCode')
      .sort({ timestamp: -1 })
      .limit(limit)
      .skip(skip)
      .lean();

    const totalRecords = await Attendance.countDocuments({ studentId, classId });
    const totalPages = Math.ceil(totalRecords / limit);

    res.status(200).json({
      message: "Class records fetched successfully",
      data: records,
      pagination: {
        totalRecords,
        totalPages,
        currentPage: page,
        limit
      }
    });
  } catch (error) {
    console.error('Error fetching class attendance records:', error);
    res.status(500).json({ message: 'Failed to fetch class attendance records.' });
  }
};

// --- (NEW) Get Overall Attendance Summary ---

/**
 * @desc    Get an attendance summary (total/attended/percentage) for all enrolled classes.
 * @route   GET /api/attendance/summary
 * @access  Private (Student)
 */
export const getMyAttendanceSummary = async (req, res) => {
  try {
    const studentId = req.user.id;

    // 1. Find all classes student is enrolled in
    const enrollments = await ClassEnrollment.find({ studentId }).select('classId');
    if (enrollments.length === 0) {
      return res.status(200).json({ message: "Student is not enrolled in any classes." });
    }
    const classIds = enrollments.map(e => e.classId);

    // 2. Find total held sessions (Denominator)
    // A "held" session is one that is in the past and was not 'cancelled'
    // const totalHeldSessions = await Attendance.countDocuments({
    //   classId: { $in: classIds },
    //   timestamp: { $lte: new Date() },
    //   // scheduledDate: { $lte: new Date() }, // In the past or today
    //   // status: { $ne: 'cancelled' }
    // });

    const heldSessionIds = await Attendance.distinct('sessionId', {
      classId: { $in: classIds },
    })
    const totalHeldSessions = heldSessionIds.length;

    // 3. Find total attended sessions (Numerator)
    const totalAttendedSessions = await Attendance.countDocuments({
      studentId,
      classId: { $in: classIds }
    });

    // 4. Calculate percentage
    const percentage = (totalHeldSessions === 0)
      ? 100 // If no sessions held, attendance is 100%
      : (totalAttendedSessions / totalHeldSessions) * 100;

    res.status(200).json({
      message: "Overall summary fetched successfully",
      summary: {
        totalHeldSessions,
        totalAttendedSessions,
        totalMissedSessions: totalHeldSessions - totalAttendedSessions,
        percentage: parseFloat(percentage.toFixed(2))
      }
    });

  } catch (error) {
    console.error('Error fetching attendance summary:', error);
    res.status(500).json({ message: 'Failed to fetch attendance summary.' });
  }
};

// --- (NEW) Get Single Class Attendance Summary ---

/**
 * @desc    Get a detailed attendance summary for a single class.
 * @route   GET /api/attendance/summary/class/:classId
 * @access  Private (Student)
 */
export const getMyClassAttendanceSummary = async (req, res) => {
  try {
    const studentId = req.user.id;
    const { classId } = req.params;

    // 1. Find total held sessions for this class (Denominator)
    // const totalHeldSessions = await Attendance.countDocuments({
    //   classId: classId,
    //   timestamp: { $lte: new Date() },
    //   // scheduledDate: { $lte: new Date() },
    //   // status: { $ne: 'cancelled' }
    // });
    const heldSessionIds = await Attendance.distinct('sessionId', {
      classId: classId,
    });
    const totalHeldSessions = heldSessionIds.length;

    // 2. Find total attended sessions for this class (Numerator)
    const totalAttendedSessions = await Attendance.countDocuments({
      studentId,
      classId: classId
    });

    // 3. Calculate percentage
    const percentage = (totalHeldSessions === 0)
      ? 100
      : (totalAttendedSessions / totalHeldSessions) * 100;

    res.status(200).json({
      message: "Class summary fetched successfully",
      summary: {
        classId,
        totalHeldSessions,
        totalAttendedSessions,
        totalMissedSessions: totalHeldSessions - totalAttendedSessions,
        percentage: parseFloat(percentage.toFixed(2))
      }
    });

  } catch (error) {
    console.error('Error fetching class summary:', error);
    res.status(500).json({ message: 'Failed to fetch class summary.' });
  }
};

// --- (NEW) Get Missed Classes ---

/**
 * @desc    Get a list of all class sessions the student has missed.
 * @route   GET /api/attendance/missed
 * @access  Private (Student)
 */
export const getMyMissedClasses = async (req, res) => {
  try {
    const studentId = req.user.id;

    // 1. Get all classes student is enrolled in
    const enrollments = await ClassEnrollment.find({ studentId }).select('classId');
    if (enrollments.length === 0) {
      return res.status(200).json({ message: "Student is not enrolled in any classes.", data: [] });
    }
    const classIds = enrollments.map(e => e.classId);

    // 2. Get all sessions that were held (past, not cancelled)
    const heldSessions = await ScheduleInstance.find({
      classId: { $in: classIds },
      scheduledDate: { $lte: new Date() },
      status: { $ne: 'cancelled' }
    })
      .populate('classId', 'subjectName subjectCode')
      .select('scheduledDate classId attendanceSessionId')
      .lean();

    // 3. Get all attendance records for this student
    // We get the `sessionId` which links to `ScheduleInstance.attendanceSessionId`
    const attendedRecords = await Attendance.find({ studentId })
      .select('sessionId')
      .lean();

    // Create a Set for fast lookup
    const attendedSessionIds = new Set(
      attendedRecords.map(rec => rec.sessionId.toString())
    );

    // 4. Filter held sessions to find the missed ones
    const missedClasses = heldSessions.filter(session => {
      // If the session had no QR code generated, it's not "missed" by the student.
      // Or, if you want to show it, you'd remove this check.
      // For this logic, we'll assume a "missed" class is one where a session
      // *was* created, but the student didn't attend.
      if (!session.attendanceSessionId) {
        return false;
      }
      
      // Return true (it's "missed") if the session's ID is NOT in the attended set
      return !attendedSessionIds.has(session.attendanceSessionId.toString());
    });

    res.status(200).json({
      message: "Missed classes fetched successfully",
      count: missedClasses.length,
      data: missedClasses
    });

  } catch (error) {
    console.error('Error fetching missed classes:', error);
    res.status(500).json({ message: 'Failed to fetch missed classes.' });
  }
};


// Get attendance records for a class (for teachers/admins)
export const getAttendanceByClass = async (req, res) => {
  try {
    const { classId } = req.params;
    const { startDate, endDate, status } = req.query;

    const query = { classId };

    if (startDate || endDate) {
      query.timestamp = {};
      if (startDate) query.timestamp.$gte = new Date(startDate);
      if (endDate) query.timestamp.$lte = new Date(endDate);
    }
    if (status && status !== 'all') {
      query.status = status;
    }

    const records = await Attendance.find(query)
      .populate({
        path: 'studentId',
        select: 'fullName enrollmentNo name'
      })
      .populate({
        path: 'classId',
        select: 'classNumber subjectCode subjectName'
      })
      .sort({ timestamp: -1 });
    
    // Also, we need a list of all enrolled students to mark absentees
    const enrolledStudents = await ClassEnrollment.find({ classId }).populate('studentId', 'fullName enrollmentNo name');

    // This logic needs to be more sophisticated.
    // For a given day/session, you'd find who from the enrolled list DID NOT attend.
    // The current implementation just returns recorded presences/manual entries.

    const transformedRecords = records.map(record => ({
      _id: record._id,
      student: record.studentId ? {
        _id: record.studentId._id,
        fullName: record.studentId.fullName || record.studentId.name,
        enrollmentNo: record.studentId.enrollmentNo,
      } : null,
      classInfo: record.classId,
      attendedAt: record.timestamp,
      status: record.status,
    }));

    const stats = {
      totalEnrolled: enrolledStudents.length,
      present: transformedRecords.filter(r => r.status === 'present').length,
      absent: enrolledStudents.length - transformedRecords.filter(r => r.status === 'present').length, // Simplistic calculation
    };

    res.json({
      attendance: transformedRecords,
      stats,
    });

  } catch (error) {
    console.error('Error fetching attendance records:', error);
    res.status(500).json({ message: error.message });
  }
};


// Get attendance records for a student
export const getStudentAttendance = async (req, res) => {
  try {
    const studentId = req.user.id;
    const { classId } = req.query; // optional filter by class

    const query = { studentId };
    if (classId) {
      query.classId = classId;
    }

    const records = await Attendance.find(query)
      .populate({
        path: 'classId',
        select: 'subjectName subjectCode'
      })
      .sort({ timestamp: -1 });

    res.json(records);
    
  } catch (error) {
    console.error('Error fetching student attendance:', error);
    res.status(500).json({ message: error.message });
  }
};

// Update an attendance record (e.g., mark as absent)
export const updateAttendance = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['present', 'absent', 'late'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status.' });
    }

    const updatedRecord = await Attendance.findByIdAndUpdate(id, { status }, { new: true });

    if (!updatedRecord) {
      return res.status(404).json({ message: 'Record not found.' });
    }

    res.json(updatedRecord);
  } catch (error) {
    console.error('Error updating attendance:', error);
    res.status(500).json({ message: error.message });
  }
};


// Manually create an attendance record
export const createManualAttendance = async (req, res) => {
  try {
    const { studentId, classId, scheduleId, status, timestamp } = req.body;
    
    const newRecord = new Attendance({
      studentId,
      classId,
      scheduleId,
      status,
      timestamp: new Date(timestamp),
      manualEntry: true,
      markedBy: req.user.id, // Log who made the manual entry
    });

    await newRecord.save();
    res.status(201).json(newRecord);
    
  } catch (error) {
    console.error('Error with manual attendance:', error);
    res.status(500).json({ message: error.message });
  }
};

export const getAttendanceBySchedule = async (req, res) => {
  try {
    const { scheduleId } = req.params;

    const attendanceRecords = await Attendance.find({ scheduleId: scheduleId })
      .populate('studentId', 'fullName enrollmentNo');
      
    if (!attendanceRecords) {
      return res.status(404).json({ message: 'No attendance records found for this schedule.' });
    }

    res.status(200).json(attendanceRecords);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};


export const getFullAttendanceReport = async (req, res) => {
  try {
    const { classId } = req.params;
    const { startDate, endDate, studentId } = req.query;

    const matchQuery = { classId: mongoose.Types.ObjectId(classId) };
    if (startDate) {
      matchQuery.timestamp = { $gte: new Date(startDate) };
    }
    if (endDate) {
      matchQuery.timestamp = { ...matchQuery.timestamp, $lte: new Date(endDate) };
    }
    if (studentId) {
      matchQuery.studentId = mongoose.Types.ObjectId(studentId);
    }

    const report = await Attendance.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: '$studentId',
          presentDays: {
            $sum: { $cond: [{ $eq: ['$status', 'present'] }, 1, 0] }
          },
          absentDays: {
            $sum: { $cond: [{ $eq: ['$status', 'absent'] }, 1, 0] }
          },
          lateDays: {
            $sum: { $cond: [{ $eq: ['$status', 'late'] }, 1, 0] }
          }
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'studentInfo'
        }
      },
      { $unwind: '$studentInfo' },
      {
        $project: {
          _id: 0,
          studentId: '$_id',
          studentName: '$studentInfo.fullName',
          enrollmentNo: '$studentInfo.enrollmentNo',
          presentDays: 1,
          absentDays: 1,
          lateDays: 1,
          totalDays: { $add: ['$presentDays', '$absentDays', '$lateDays'] }
        }
      },
      {
        $project: {
          studentId: 1,
          studentName: 1,
          enrollmentNo: 1,
          presentDays: 1,
          absentDays: 1,
          lateDays: 1,
          totalDays: 1,
          percentage: {
            $cond: [
              { $eq: ['$totalDays', 0] },
              0,
              { $multiply: [{ $divide: ['$presentDays', '$totalDays'] }, 100] }
            ]
          }
        }
      }
    ]);

    res.json(report);
  } catch (error) {
    console.error('Error generating full report:', error);
    res.status(500).json({ message: error.message });
  }
};

/**
 * @desc    Get random liveness challenges for the student
 * @route   GET /api/student/attendance/liveness/challenges
 * @access  Private (Student)
 */
export const getLivenessChallenges = async (req, res) => {
  try {
    // Define all possible challenges
    const allChallenges = [
      { type: 'neutral', instruction: 'Look straight at the camera', icon: 'face-man' },
      { type: 'smile', instruction: 'Smile at the camera', icon: 'emoticon-happy' },
      { type: 'turn_left', instruction: 'Turn your head slightly left', icon: 'arrow-left' },
      { type: 'turn_right', instruction: 'Turn your head slightly right', icon: 'arrow-right' },
      { type: 'eyes_open', instruction: 'Open your eyes wide', icon: 'eye' },
    ];

    // Shuffle and select 3 random challenges (always include neutral first)
    const shuffled = allChallenges.slice(1).sort(() => Math.random() - 0.5);
    const selectedChallenges = [
      allChallenges[0], // Always start with neutral
      ...shuffled.slice(0, 2) // Add 2 random challenges
    ];

    res.status(200).json({
      success: true,
      challenges: selectedChallenges,
      message: 'Complete these challenges to verify your identity'
    });
  } catch (error) {
    console.error('Error generating challenges:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to generate liveness challenges' 
    });
  }
};

/**
 * @desc    Submit attendance with enhanced liveness check (face images for challenges)
 * @route   POST /api/student/attendance/verify
 * @access  Private (Student)
 * 
 * Expected Body:
 * {
 *   "classId": "64f1a2b3c4d5e6f7g8h9i0j1",
 *   "studentCoordinates": { "latitude": 18.123, "longitude": 73.456 },
 *   "challengeImages": [
 *     { "challengeType": "neutral", "image": "base64..." },
 *     { "challengeType": "smile", "image": "base64..." },
 *     { "challengeType": "turn_left", "image": "base64..." }
 *   ]
 * }
 */
export const submitAttendanceWithFaceVerification = async (req, res) => {
  console.log('🔄 [Attendance] Starting enhanced face verification');
  try {
    const { 
      classId, 
      studentCoordinates,
      challengeImages // Array of { challengeType, image (base64) }
    } = req.body;
    
    const studentId = req.user.id;

    // --- 1. Input Validation ---
    if (!classId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Class ID is required.' 
      });
    }
    if (!studentCoordinates?.latitude || !studentCoordinates?.longitude) {
      return res.status(400).json({ 
        success: false, 
        message: 'Student coordinates are required.' 
      });
    }
    if (!challengeImages || !Array.isArray(challengeImages) || challengeImages.length < 2) {
      return res.status(400).json({ 
        success: false, 
        message: 'At least 2 challenge images are required.' 
      });
    }

    // --- 2. Verify QR Session is Active ---
    console.log('🔍 [Attendance] Verifying QR session for class:', classId);
    
    const qrSession = await QRCodeSession.findOne({
      classId,
      isActive: true,
      sessionExpiresAt: { $gt: new Date() }
    });

    if (!qrSession) {
      console.log('❌ [Attendance] No active QR session found');
      return res.status(400).json({ 
        success: false, 
        message: 'No active attendance session. QR code may have expired.' 
      });
    }
    console.log('✅ [Attendance] QR session verified:', qrSession.sessionId);
    
    // --- 3. Check for Duplicate Attendance ---
    const existingAttendance = await Attendance.findOne({ 
      studentId, 
      sessionId: qrSession._id 
    });
    
    if (existingAttendance) {
      console.log('⚠️ [Attendance] Duplicate attempt detected');
      return res.status(409).json({ 
        success: false, 
        message: 'Attendance already marked for this session.' 
      });
    }
    console.log('✅ [Attendance] No duplicate found');

    // --- 4. Get Student Profile with Face Image ---
    const student = await User.findById(studentId);
    
    if (!student) {
      return res.status(404).json({ 
        success: false, 
        message: 'Student not found.' 
      });
    }
    
    if (!student.faceImageS3Key) {
      return res.status(400).json({ 
        success: false, 
        message: 'No profile photo registered. Please upload your face photo first.' 
      });
    }
    console.log(`👤 [Attendance] Student found: ${student.fullName}`);
    
    // --- 5. Convert base64 images to buffers and verify ---
    console.log(`🔐 [Attendance] Processing ${challengeImages.length} challenge images`);
    
    const processedChallenges = challengeImages.map(({ challengeType, image }) => {
      // Remove data URL prefix if present
      const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
      const imageBytes = Buffer.from(base64Data, 'base64');
      return { challengeType, imageBytes };
    });

    // --- 6. Verify Liveness with Challenges ---
    const verificationResult = await verifyLivenessWithChallenges(
      processedChallenges,
      student.faceImageS3Key
    );

    if (!verificationResult.success) {
      console.log(`❌ [Attendance] Verification failed: ${verificationResult.reason}`);
      
      const errorMessages = {
        'NO_FACE_DETECTED': 'No face detected. Please position your face clearly.',
        'MULTIPLE_FACES': 'Multiple faces detected. Only your face should be visible.',
        'LOW_CONFIDENCE': 'Face not clear. Please improve lighting.',
        'FACE_NOT_FRONTAL': 'Please face the camera directly.',
        'LOW_BRIGHTNESS': 'Image too dark. Please improve lighting.',
        'LOW_SHARPNESS': 'Image blurry. Please hold steady.',
        'LIVENESS_CHALLENGES_FAILED': verificationResult.message,
        'FACE_NOT_MATCHED': 'Face does not match your registered profile.',
        'PROFILE_IMAGE_NOT_FOUND': 'Profile image not found. Please re-upload your photo.',
        'INVALID_IMAGE': 'Invalid image captured. Please try again.'
      };

      return res.status(400).json({ 
        success: false,
        reason: verificationResult.reason,
        challengeResults: verificationResult.challengeResults,
        message: errorMessages[verificationResult.reason] || verificationResult.message
      });
    }

    console.log(`✅ [Attendance] Identity Verified!`);
    console.log(`   Liveness Score: ${verificationResult.livenessScore}%`);
    console.log(`   Face Similarity: ${verificationResult.similarity}%`);

    // --- 7. Save Attendance Record ---
    console.log('💾 [Attendance] Saving attendance record');
    
    const attendanceRecord = new Attendance({
      studentId,
      classId,
      sessionId: qrSession._id,
      scheduleId: qrSession.scheduleId,
      studentCoordinates,
      status: 'present',
      livenessPassed: true,
      livenessConfidence: verificationResult.livenessScore,
      faceSimilarity: verificationResult.similarity,
      timestamp: new Date(),
      manualEntry: false,
    });

    await attendanceRecord.save();
    console.log('✅ [Attendance] Attendance saved successfully');

    // --- 8. Return Success Response ---
    res.status(201).json({
      success: true,
      message: 'Attendance marked successfully!',
      data: {
        attendanceId: attendanceRecord._id,
        classId,
        timestamp: attendanceRecord.timestamp,
        livenessScore: verificationResult.livenessScore,
        faceSimilarity: verificationResult.similarity
      }
    });

  } catch (error) {
    console.error('❌ [Attendance] Error:', error);
    
    res.status(500).json({ 
      success: false,
      message: 'An unexpected error occurred. Please try again.',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};