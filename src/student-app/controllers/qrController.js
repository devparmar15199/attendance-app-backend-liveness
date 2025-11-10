import { QRCodeSession } from '../../models/qrCodeSessionModel.js';
import { ClassEnrollment } from '../../models/classEnrollmentModel.js';

// Validate QR Code Token
export const validateQRCode = async (req, res) => {
  try {
    const { token } = req.body;
    
    if (!token) {
      return res.status(400).json({ message: 'QR token is required' });
    }

    console.log('Validating QR token:', token);
    console.log('QR validation request body:', req.body);

    // Find active QR session with matching token
    const session = await QRCodeSession.findOne({
      currentToken: token,
      isActive: true,
      sessionExpiresAt: { $gt: new Date() }
    }).populate('classId');

    if (!session) {
      console.log('Invalid or expired QR token:', token);
      console.log('Current time:', new Date());
      
      // Debug: Check if there are any active sessions
      const activeSessions = await QRCodeSession.find({
        isActive: true,
        sessionExpiresAt: { $gt: new Date() }
      });
      console.log('Active sessions found:', activeSessions.length);
      
      return res.status(400).json({ 
        valid: false, 
        message: 'Invalid or expired QR code' 
      });
    }

    console.log('QR token validated successfully:', session.sessionId);
    console.log('Session details:', {
      sessionId: session.sessionId,
      classId: session.classId._id,
      token: session.currentToken,
      expiresAt: session.sessionExpiresAt
    });

    res.json({
      valid: true,
      sessionId: session.sessionId,
      classId: session.classId._id,
      classInfo: {
        classNumber: session.qrPayload.classNumber,
        subjectCode: session.qrPayload.subjectCode,
        subjectName: session.qrPayload.subjectName,
        classYear: session.qrPayload.classYear,
        semester: session.qrPayload.semester,
        division: session.qrPayload.division
      },
      coordinates: session.qrPayload.coordinates,
      timestamp: session.qrPayload.timestamp
    });

  } catch (error) {
    console.error('QR validation error:', error);
    res.status(500).json({ message: error.message });
  }
};

/**
 * @desc    Check if an attendance session is currently active for a specific class
 * @route   GET /api/qr/session/status/:classId
 * @access  Private (Student)
 */
export const getSessionStatus = async (req, res) => {
  try {
    const { classId } = req.params;

    // Find an active session for this class
    const activeSession = await QRCodeSession.findOne({
      classId: classId,
      isActive: true,
      sessionExpiresAt: { $gt: new Date() }
    })
    .select('sessionId classId isActive sessionExpiresAt') // Only send necessary info
    .lean(); // Use .lean() for faster, read-only query

    if (activeSession) {
      res.status(200).json({
        isActive: true,
        session: activeSession,
        message: 'An attendance session is currently active.'
      });
    } else {
      res.status(200).json({
        isActive: false,
        message: 'No active attendance session found for this class.'
      });
    }
  } catch (error) {
    console.error('Error checking session status:', error);
    res.status(500).json({ message: 'Failed to check session status.' });
  }
};

/**
 * @desc    Get all currently active sessions for the student's enrolled classes
 * @route   GET /api/qr/session/active
 * @access  Private (Student)
 */
export const getActiveSessions = async (req, res) => {
  try {
    const studentId = req.user.id;

    // 1. Find all classes the student is enrolled in
    const enrollments = await ClassEnrollment.find({ studentId }).select('classId').lean();
    const enrolledClassIds = enrollments.map(e => e.classId);

    if (enrolledClassIds.length === 0) {
      return res.status(200).json({
        message: 'Student is not enrolled in any classes.',
        activeSessions: []
      });
    }

    // 2. Find all active sessions for those classes
    const activeSessions = await QRCodeSession.find({
      classId: { $in: enrolledClassIds },
      isActive: true,
      sessionExpiresAt: { $gt: new Date() }
    })
    .populate('classId', 'subjectName subjectCode classNumber') // Populate with class details
    .select('sessionId classId isActive sessionExpiresAt qrPayload.subjectName qrPayload.classNumber')
    .lean();

    res.status(200).json({
      message: `Found ${activeSessions.length} active session(s).`,
      activeSessions: activeSessions
    });
    
  } catch (error) {
    console.error('Error fetching active sessions:', error);
    res.status(500).json({ message: 'Failed to fetch active sessions.' });
  }
};