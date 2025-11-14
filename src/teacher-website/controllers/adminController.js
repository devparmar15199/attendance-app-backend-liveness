import { User } from '../../models/userModel.js';
import { Class } from '../../models/classModel.js';
import { ClassEnrollment } from '../../models/classEnrollmentModel.js';
import { Schedule } from '../../models/scheduleModel.js';
import { RecurringSchedule } from '../../models/recurringScheduleModel.js';
import { Attendance } from '../../models/attendanceModel.js';
import { uploadFaceImage, generateFaceImageFilename } from '../../AWS/s3Service.js';

// ========================= DASHBOARD & STATISTICS =========================

// Get Admin Dashboard Statistics
export const getDashboardStats = async (req, res) => {
  try {
    const totalStudents = await User.countDocuments({ role: 'student' });
    const totalTeachers = await User.countDocuments({ role: 'teacher' });
    const totalClasses = await Class.countDocuments();
    const totalSchedules = await Schedule.countDocuments({ isActive: true });
    
    // Recent registrations (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const recentStudents = await User.countDocuments({ 
      role: 'student', 
      createdAt: { $gte: thirtyDaysAgo } 
    });
    
    const recentTeachers = await User.countDocuments({ 
      role: 'teacher', 
      createdAt: { $gte: thirtyDaysAgo } 
    });

    // Attendance statistics
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayAttendance = await Attendance.countDocuments({ 
      date: { $gte: today } 
    });

    res.json({
      success: true,
      stats: {
        totalStudents,
        totalTeachers,
        totalClasses,
        totalSchedules,
        recentStudents,
        recentTeachers,
        todayAttendance
      }
    });
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching dashboard statistics', 
      error: error.message 
    });
  }
};

// ========================= STUDENT MANAGEMENT =========================

// Get all students with filters
export const getAllStudents = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 20, 
      search, 
      classYear, 
      semester,
      division,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const query = { role: 'student' };

    // Add search filter
    if (search) {
      query.$or = [
        { fullName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { enrollmentNo: { $regex: search, $options: 'i' } }
      ];
    }

    // Add class year filter
    if (classYear) {
      query.classYear = classYear;
    }

    // Add semester filter
    if (semester) {
      query.semester = semester;
    }

    if (division) {
      query.division = division;
    }

    const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

    const students = await User.find(query)
      .select('-password')
      .sort(sort)
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .lean();

    const count = await User.countDocuments(query);

    // Get enrollment counts for each student
    const studentsWithEnrollments = await Promise.all(
      students.map(async (student) => {
        const enrollmentCount = await ClassEnrollment.countDocuments({ 
          studentId: student._id 
        });
        return { ...student, enrollmentCount };
      })
    );

    res.json({
      success: true,
      students: studentsWithEnrollments,
      totalPages: Math.ceil(count / limit),
      currentPage: parseInt(page),
      totalStudents: count
    });
  } catch (error) {
    console.error('Error fetching students:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching students', 
      error: error.message 
    });
  }
};

// Get single student details
export const getStudentById = async (req, res) => {
  try {
    const { id } = req.params;

    const student = await User.findOne({ _id: id, role: 'student' })
      .select('-password')
      .lean();

    if (!student) {
      return res.status(404).json({ 
        success: false, 
        message: 'Student not found' 
      });
    }

    // Get enrolled classes
    const enrollments = await ClassEnrollment.find({ studentId: id })
      .populate('classId')
      .lean();

    // Get attendance records
    const attendanceRecords = await Attendance.find({ studentId: id })
      .populate('classId', 'subjectName subjectCode')
      .populate('scheduleId')
      .sort({ date: -1 })
      .limit(50)
      .lean();

    const attendanceStats = {
      total: attendanceRecords.length,
      present: attendanceRecords.filter(a => a.status === 'present').length,
      absent: attendanceRecords.filter(a => a.status === 'absent').length,
      late: attendanceRecords.filter(a => a.status === 'late').length
    };

    res.json({
      success: true,
      student: {
        ...student,
        enrolledClasses: enrollments.map(e => e.classId),
        attendanceStats,
        recentAttendance: attendanceRecords.slice(0, 10)
      }
    });
  } catch (error) {
    console.error('Error fetching student details:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching student details', 
      error: error.message 
    });
  }
};

// Create new student (Admin creates student account)
export const createStudent = async (req, res) => {
  try {
    const { 
      fullName, 
      email, 
      password, 
      enrollmentNo, 
      classYear, 
      semester,
      division
    } = req.body;

    // Validation
    if (!fullName || !email || !password || !enrollmentNo || !classYear || !semester || !division) {
      return res.status(400).json({ 
        success: false, 
        message: 'All fields are required' 
      });
    }

    // Check if email exists
    const emailExists = await User.findOne({ email });
    if (emailExists) {
      return res.status(409).json({ 
        success: false, 
        message: 'Email already exists' 
      });
    }

    // Check if enrollment number exists
    const enrollmentExists = await User.findOne({ enrollmentNo });
    if (enrollmentExists) {
      return res.status(409).json({ 
        success: false, 
        message: 'Enrollment number already exists' 
      });
    }

    // Handle face image upload if provided
    let faceImageS3Key = null;
    if (req.files && req.files.faceImage) {
      const faceImageFile = req.files.faceImage[0];
      const s3Key = generateFaceImageFilename(enrollmentNo);
      const uploadResult = await uploadFaceImage(faceImageFile.buffer, s3Key);
      faceImageS3Key = uploadResult.key;
    }

    // Create student
    const student = await User.create({
      fullName,
      email,
      password, // Will be hashed by pre-save hook
      enrollmentNo,
      classYear,
      semester,
      division,
      role: 'student',
      faceImageS3Key
    });

    res.status(201).json({
      success: true,
      message: 'Student created successfully',
      student: {
        _id: student._id,
        fullName: student.fullName,
        email: student.email,
        enrollmentNo: student.enrollmentNo,
        classYear: student.classYear,
        semester: student.semester,
        division: student.division,
        faceImageS3Key: student.faceImageS3Key
      }
    });
  } catch (error) {
    console.error('Error creating student:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error creating student', 
      error: error.message 
    });
  }
};

// Update student
export const updateStudent = async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      fullName, 
      email, 
      enrollmentNo, 
      classYear, 
      semester,
      division,
      password
    } = req.body;

    const student = await User.findOne({ _id: id, role: 'student' });
    if (!student) {
      return res.status(404).json({ 
        success: false, 
        message: 'Student not found' 
      });
    }

    // Check email uniqueness if changed
    if (email && email !== student.email) {
      const emailExists = await User.findOne({ email });
      if (emailExists) {
        return res.status(409).json({ 
          success: false, 
          message: 'Email already exists' 
        });
      }
      student.email = email;
    }

    // Check enrollment number uniqueness if changed
    if (enrollmentNo && enrollmentNo !== student.enrollmentNo) {
      const enrollmentExists = await User.findOne({ enrollmentNo });
      if (enrollmentExists) {
        return res.status(409).json({ 
          success: false, 
          message: 'Enrollment number already exists' 
        });
      }
      student.enrollmentNo = enrollmentNo;
    }

    // Update fields
    if (fullName) student.fullName = fullName;
    if (classYear) student.classYear = classYear;
    if (semester) student.semester = semester;
    if (division) student.division = division;
    if (password) student.password = password; // Will be hashed by pre-save hook

    // Handle face image upload if provided
    if (req.files && req.files.faceImage) {
      const faceImageFile = req.files.faceImage[0];
      const s3Key = generateFaceImageFilename(student.enrollmentNo);
      const uploadResult = await uploadFaceImage(faceImageFile.buffer, s3Key);
      student.faceImageS3Key = uploadResult.key;
    }

    await student.save();

    res.json({
      success: true,
      message: 'Student updated successfully',
      student: {
        _id: student._id,
        fullName: student.fullName,
        email: student.email,
        enrollmentNo: student.enrollmentNo,
        classYear: student.classYear,
        semester: student.semester,
        division: student.division,
        faceImageS3Key: student.faceImageS3Key
      }
    });
  } catch (error) {
    console.error('Error updating student:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error updating student', 
      error: error.message 
    });
  }
};

// Delete student
export const deleteStudent = async (req, res) => {
  try {
    const { id } = req.params;

    const student = await User.findOne({ _id: id, role: 'student' });
    if (!student) {
      return res.status(404).json({ 
        success: false, 
        message: 'Student not found' 
      });
    }

    // Delete related records
    await ClassEnrollment.deleteMany({ studentId: id });
    await Attendance.deleteMany({ studentId: id });

    // Delete student
    await User.deleteOne({ _id: id });

    res.json({
      success: true,
      message: 'Student deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting student:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error deleting student', 
      error: error.message 
    });
  }
};

// ========================= TEACHER MANAGEMENT =========================

// Get all teachers with filters
export const getAllTeachers = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 20, 
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const query = { role: 'teacher' };

    // Add search filter
    if (search) {
      query.$or = [
        { fullName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

    const teachers = await User.find(query)
      .select('-password')
      .sort(sort)
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .lean();

    const count = await User.countDocuments(query);

    // Get class counts for each teacher
    const teachersWithClasses = await Promise.all(
      teachers.map(async (teacher) => {
        const classCount = await Class.countDocuments({ teacherId: teacher._id });
        const scheduleCount = await Schedule.countDocuments({ 
          teacherId: teacher._id, 
          isActive: true 
        });
        return { ...teacher, classCount, scheduleCount };
      })
    );

    res.json({
      success: true,
      teachers: teachersWithClasses,
      totalPages: Math.ceil(count / limit),
      currentPage: parseInt(page),
      totalTeachers: count
    });
  } catch (error) {
    console.error('Error fetching teachers:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching teachers', 
      error: error.message 
    });
  }
};

// Get single teacher details
export const getTeacherById = async (req, res) => {
  try {
    const { id } = req.params;

    const teacher = await User.findOne({ _id: id, role: 'teacher' })
      .select('-password')
      .lean();

    if (!teacher) {
      return res.status(404).json({ 
        success: false, 
        message: 'Teacher not found' 
      });
    }

    // Get classes taught by teacher
    const classes = await Class.find({ teacherId: id }).lean();

    // Get schedules
    const schedules = await Schedule.find({ 
      teacherId: id, 
      isActive: true 
    })
      .populate('classId')
      .lean();

    res.json({
      success: true,
      teacher: {
        ...teacher,
        classes,
        schedules,
        classCount: classes.length,
        scheduleCount: schedules.length
      }
    });
  } catch (error) {
    console.error('Error fetching teacher details:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching teacher details', 
      error: error.message 
    });
  }
};

// Create new teacher
export const createTeacher = async (req, res) => {
  try {
    const { fullName, email, password } = req.body;

    // Validation
    if (!fullName || !email || !password) {
      return res.status(400).json({ 
        success: false, 
        message: 'All fields are required' 
      });
    }

    // Check if email exists
    const emailExists = await User.findOne({ email });
    if (emailExists) {
      return res.status(409).json({ 
        success: false, 
        message: 'Email already exists' 
      });
    }

    // Create teacher
    const teacher = await User.create({
      fullName,
      email,
      password, // Will be hashed by pre-save hook
      role: 'teacher'
    });

    res.status(201).json({
      success: true,
      message: 'Teacher created successfully',
      teacher: {
        _id: teacher._id,
        fullName: teacher.fullName,
        email: teacher.email,
        role: teacher.role
      }
    });
  } catch (error) {
    console.error('Error creating teacher:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error creating teacher', 
      error: error.message 
    });
  }
};

// Update teacher
export const updateTeacher = async (req, res) => {
  try {
    const { id } = req.params;
    const { fullName, email, password } = req.body;

    const teacher = await User.findOne({ _id: id, role: 'teacher' });
    if (!teacher) {
      return res.status(404).json({ 
        success: false, 
        message: 'Teacher not found' 
      });
    }

    // Check email uniqueness if changed
    if (email && email !== teacher.email) {
      const emailExists = await User.findOne({ email });
      if (emailExists) {
        return res.status(409).json({ 
          success: false, 
          message: 'Email already exists' 
        });
      }
      teacher.email = email;
    }

    // Update fields
    if (fullName) teacher.fullName = fullName;
    if (password) teacher.password = password; // Will be hashed by pre-save hook

    await teacher.save();

    res.json({
      success: true,
      message: 'Teacher updated successfully',
      teacher: {
        _id: teacher._id,
        fullName: teacher.fullName,
        email: teacher.email,
        role: teacher.role
      }
    });
  } catch (error) {
    console.error('Error updating teacher:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error updating teacher', 
      error: error.message 
    });
  }
};

// Delete teacher
export const deleteTeacher = async (req, res) => {
  try {
    const { id } = req.params;

    const teacher = await User.findOne({ _id: id, role: 'teacher' });
    if (!teacher) {
      return res.status(404).json({ 
        success: false, 
        message: 'Teacher not found' 
      });
    }

    // Check if teacher has active classes
    const hasClasses = await Class.countDocuments({ teacherId: id });
    if (hasClasses > 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Cannot delete teacher with active classes. Please reassign or delete classes first.' 
      });
    }

    // Delete related records
    await Schedule.deleteMany({ teacherId: id });
    await RecurringSchedule.deleteMany({ teacherId: id });

    // Delete teacher
    await User.deleteOne({ _id: id });

    res.json({
      success: true,
      message: 'Teacher deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting teacher:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error deleting teacher', 
      error: error.message 
    });
  }
};

// ========================= CLASS ENROLLMENT MANAGEMENT =========================

// Enroll student in class
export const enrollStudent = async (req, res) => {
  try {
    const { studentId, classId } = req.body;

    if (!studentId || !classId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Student ID and Class ID are required' 
      });
    }

    // Check if student exists
    const student = await User.findOne({ _id: studentId, role: 'student' });
    if (!student) {
      return res.status(404).json({ 
        success: false, 
        message: 'Student not found' 
      });
    }

    // Check if class exists
    const classExists = await Class.findById(classId);
    if (!classExists) {
      return res.status(404).json({ 
        success: false, 
        message: 'Class not found' 
      });
    }

    // Check if already enrolled
    const existingEnrollment = await ClassEnrollment.findOne({ 
      studentId, 
      classId 
    });

    if (existingEnrollment) {
      return res.status(409).json({ 
        success: false, 
        message: 'Student is already enrolled in this class' 
      });
    }

    // Create enrollment
    const enrollment = await ClassEnrollment.create({
      studentId,
      classId
    });

    res.status(201).json({
      success: true,
      message: 'Student enrolled successfully',
      enrollment
    });
  } catch (error) {
    console.error('Error enrolling student:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error enrolling student', 
      error: error.message 
    });
  }
};

// Bulk enroll students
export const bulkEnrollStudents = async (req, res) => {
  try {
    const { studentIds, classId } = req.body;

    if (!studentIds || !Array.isArray(studentIds) || studentIds.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Student IDs array is required' 
      });
    }

    if (!classId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Class ID is required' 
      });
    }

    // Check if class exists
    const classExists = await Class.findById(classId);
    if (!classExists) {
      return res.status(404).json({ 
        success: false, 
        message: 'Class not found' 
      });
    }

    const results = {
      enrolled: [],
      alreadyEnrolled: [],
      notFound: []
    };

    for (const studentId of studentIds) {
      // Check if student exists
      const student = await User.findOne({ _id: studentId, role: 'student' });
      if (!student) {
        results.notFound.push(studentId);
        continue;
      }

      // Check if already enrolled
      const existingEnrollment = await ClassEnrollment.findOne({ 
        studentId, 
        classId 
      });

      if (existingEnrollment) {
        results.alreadyEnrolled.push(studentId);
        continue;
      }

      // Create enrollment
      await ClassEnrollment.create({ studentId, classId });
      results.enrolled.push(studentId);
    }

    res.json({
      success: true,
      message: 'Bulk enrollment completed',
      results: {
        total: studentIds.length,
        enrolled: results.enrolled.length,
        alreadyEnrolled: results.alreadyEnrolled.length,
        notFound: results.notFound.length
      },
      details: results
    });
  } catch (error) {
    console.error('Error in bulk enrollment:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error in bulk enrollment', 
      error: error.message 
    });
  }
};

// Unenroll student from class
export const unenrollStudent = async (req, res) => {
  try {
    const { studentId, classId } = req.body;

    if (!studentId || !classId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Student ID and Class ID are required' 
      });
    }

    const enrollment = await ClassEnrollment.findOneAndDelete({ 
      studentId, 
      classId 
    });

    if (!enrollment) {
      return res.status(404).json({ 
        success: false, 
        message: 'Enrollment not found' 
      });
    }

    res.json({
      success: true,
      message: 'Student unenrolled successfully'
    });
  } catch (error) {
    console.error('Error unenrolling student:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error unenrolling student', 
      error: error.message 
    });
  }
};

// Get class enrollments
export const getClassEnrollments = async (req, res) => {
  try {
    const { classId } = req.params;

    const enrollments = await ClassEnrollment.find({ classId })
      .populate('studentId', '-password')
      .populate('classId')
      .lean();

    res.json({
      success: true,
      enrollments,
      count: enrollments.length
    });
  } catch (error) {
    console.error('Error fetching class enrollments:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching class enrollments', 
      error: error.message 
    });
  }
};

// Get student enrollments
export const getStudentEnrollments = async (req, res) => {
  try {
    const { studentId } = req.params;

    const enrollments = await ClassEnrollment.find({ studentId })
      .populate('classId')
      .lean();

    res.json({
      success: true,
      enrollments,
      count: enrollments.length
    });
  } catch (error) {
    console.error('Error fetching student enrollments:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching student enrollments', 
      error: error.message 
    });
  }
};

// ========================= SCHEDULE MANAGEMENT =========================

// Create schedule for teacher
export const createSchedule = async (req, res) => {
  try {
    const {
      classId,
      teacherId,
      sessionType,
      dayOfWeek,
      startTime,
      endTime,
      roomNumber,
      semester,
      academicYear
    } = req.body;

    // Validation
    if (!classId || !teacherId || !sessionType || !dayOfWeek || 
        !startTime || !endTime || !roomNumber || !semester || !academicYear) {
      return res.status(400).json({ 
        success: false, 
        message: 'All fields are required' 
      });
    }

    // Check if teacher exists
    const teacher = await User.findOne({ _id: teacherId, role: 'teacher' });
    if (!teacher) {
      return res.status(404).json({ 
        success: false, 
        message: 'Teacher not found' 
      });
    }

    // Check if class exists
    const classExists = await Class.findById(classId);
    if (!classExists) {
      return res.status(404).json({ 
        success: false, 
        message: 'Class not found' 
      });
    }

    // Check for scheduling conflicts
    const conflict = await Schedule.findOne({
      teacherId,
      dayOfWeek,
      isActive: true,
      $or: [
        { 
          startTime: { $lte: startTime }, 
          endTime: { $gt: startTime } 
        },
        { 
          startTime: { $lt: endTime }, 
          endTime: { $gte: endTime } 
        },
        {
          startTime: { $gte: startTime },
          endTime: { $lte: endTime }
        }
      ]
    });

    if (conflict) {
      return res.status(409).json({ 
        success: false, 
        message: 'Teacher has a scheduling conflict at this time' 
      });
    }

    // Create schedule
    const schedule = await Schedule.create({
      classId,
      teacherId,
      sessionType,
      dayOfWeek,
      startTime,
      endTime,
      roomNumber,
      semester,
      academicYear,
      isActive: true
    });

    const populatedSchedule = await Schedule.findById(schedule._id)
      .populate('classId')
      .populate('teacherId', '-password');

    res.status(201).json({
      success: true,
      message: 'Schedule created successfully',
      schedule: populatedSchedule
    });
  } catch (error) {
    console.error('Error creating schedule:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error creating schedule', 
      error: error.message 
    });
  }
};

// Get all schedules with filters
export const getAllSchedules = async (req, res) => {
  try {
    const { 
      teacherId, 
      classId, 
      dayOfWeek, 
      isActive 
    } = req.query;

    const query = {};

    if (teacherId) query.teacherId = teacherId;
    if (classId) query.classId = classId;
    if (dayOfWeek) query.dayOfWeek = dayOfWeek;
    if (isActive !== undefined) query.isActive = isActive === 'true';

    const schedules = await Schedule.find(query)
      .populate('classId', 'subjectName subjectCode classNumber')
      .populate('teacherId', 'fullName email')
      .sort({ dayOfWeek: 1, startTime: 1 })
      .lean();

    res.json({
      success: true,
      schedules,
      count: schedules.length
    });
  } catch (error) {
    console.error('Error fetching schedules:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching schedules', 
      error: error.message 
    });
  }
};

// Update schedule
export const updateSchedule = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const schedule = await Schedule.findById(id);
    if (!schedule) {
      return res.status(404).json({ 
        success: false, 
        message: 'Schedule not found' 
      });
    }

    // Check for conflicts if time is being changed
    if (updates.startTime || updates.endTime || updates.dayOfWeek) {
      const startTime = updates.startTime || schedule.startTime;
      const endTime = updates.endTime || schedule.endTime;
      const dayOfWeek = updates.dayOfWeek || schedule.dayOfWeek;
      const teacherId = updates.teacherId || schedule.teacherId;

      const conflict = await Schedule.findOne({
        _id: { $ne: id },
        teacherId,
        dayOfWeek,
        isActive: true,
        $or: [
          { 
            startTime: { $lte: startTime }, 
            endTime: { $gt: startTime } 
          },
          { 
            startTime: { $lt: endTime }, 
            endTime: { $gte: endTime } 
          },
          {
            startTime: { $gte: startTime },
            endTime: { $lte: endTime }
          }
        ]
      });

      if (conflict) {
        return res.status(409).json({ 
          success: false, 
          message: 'Teacher has a scheduling conflict at this time' 
        });
      }
    }

    Object.assign(schedule, updates);
    await schedule.save();

    const populatedSchedule = await Schedule.findById(schedule._id)
      .populate('classId')
      .populate('teacherId', '-password');

    res.json({
      success: true,
      message: 'Schedule updated successfully',
      schedule: populatedSchedule
    });
  } catch (error) {
    console.error('Error updating schedule:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error updating schedule', 
      error: error.message 
    });
  }
};

// Delete schedule
export const deleteSchedule = async (req, res) => {
  try {
    const { id } = req.params;

    const schedule = await Schedule.findByIdAndDelete(id);
    if (!schedule) {
      return res.status(404).json({ 
        success: false, 
        message: 'Schedule not found' 
      });
    }

    res.json({
      success: true,
      message: 'Schedule deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting schedule:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error deleting schedule', 
      error: error.message 
    });
  }
};

// ========================= PENDING REGISTRATIONS =========================

// Get pending student registrations (students without enrollments)
export const getPendingStudents = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;

    // Get all students
    const allStudents = await User.find({ role: 'student' })
      .select('-password')
      .lean();

    // Get students with enrollments
    const enrolledStudentIds = await ClassEnrollment.distinct('studentId');

    // Filter students without enrollments
    const pendingStudents = allStudents.filter(
      student => !enrolledStudentIds.some(id => id.toString() === student._id.toString())
    );

    // Pagination
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + parseInt(limit);
    const paginatedStudents = pendingStudents.slice(startIndex, endIndex);

    res.json({
      success: true,
      students: paginatedStudents,
      totalPages: Math.ceil(pendingStudents.length / limit),
      currentPage: parseInt(page),
      totalPending: pendingStudents.length
    });
  } catch (error) {
    console.error('Error fetching pending students:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching pending students', 
      error: error.message 
    });
  }
};

// ========================= BULK OPERATIONS =========================

// Bulk delete students
export const bulkDeleteStudents = async (req, res) => {
  try {
    const { studentIds } = req.body;

    if (!studentIds || !Array.isArray(studentIds) || studentIds.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Student IDs array is required' 
      });
    }

    // Delete related records
    await ClassEnrollment.deleteMany({ studentId: { $in: studentIds } });
    await Attendance.deleteMany({ studentId: { $in: studentIds } });

    // Delete students
    const result = await User.deleteMany({ 
      _id: { $in: studentIds }, 
      role: 'student' 
    });

    res.json({
      success: true,
      message: `${result.deletedCount} students deleted successfully`,
      deletedCount: result.deletedCount
    });
  } catch (error) {
    console.error('Error in bulk delete:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error in bulk delete', 
      error: error.message 
    });
  }
};

// Get teacher's classes
export const getTeacherClasses = async (req, res) => {
  try {
    const { teacherId } = req.params;

    const classes = await Class.find({ teacherId })
      .lean();

    // Get enrollment count for each class
    const classesWithEnrollment = await Promise.all(
      classes.map(async (cls) => {
        const enrollmentCount = await ClassEnrollment.countDocuments({ 
          classId: cls._id 
        });
        return {
          ...cls,
          enrollmentCount
        };
      })
    );

    res.json({
      success: true,
      classes: classesWithEnrollment
    });
  } catch (error) {
    console.error('Error fetching teacher classes:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching teacher classes', 
      error: error.message 
    });
  }
};

// Get teacher's schedules
export const getTeacherSchedules = async (req, res) => {
  try {
    const { teacherId } = req.params;

    const schedules = await Schedule.find({ teacherId })
      .populate('classId', 'subjectName subjectCode classNumber')
      .sort({ dayOfWeek: 1, startTime: 1 })
      .lean();

    res.json({
      success: true,
      schedules
    });
  } catch (error) {
    console.error('Error fetching teacher schedules:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching teacher schedules', 
      error: error.message 
    });
  }
};

// Get all classes (admin)
export const getAllClasses = async (req, res) => {
  try {
    const classes = await Class.find({})
      .populate('teacherId', 'fullName email')
      .sort({ classYear: 1, semester: 1, subjectName: 1 })
      .lean();

    // Get enrollment count for each class
    const classesWithEnrollment = await Promise.all(
      classes.map(async (cls) => {
        const enrollmentCount = await ClassEnrollment.countDocuments({ 
          classId: cls._id 
        });
        return {
          ...cls,
          teacherName: cls.teacherId?.fullName || cls.teacherName || 'N/A',
          enrollmentCount
        };
      })
    );

    res.json({
      success: true,
      classes: classesWithEnrollment
    });
  } catch (error) {
    console.error('Error fetching all classes:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching all classes', 
      error: error.message 
    });
  }
};

// Get class by ID (admin)
export const getClassById = async (req, res) => {
  try {
    const { id } = req.params;
    
    const classData = await Class.findById(id)
      .populate('teacherId', 'fullName email')
      .lean();

    if (!classData) {
      return res.status(404).json({ 
        success: false, 
        message: 'Class not found' 
      });
    }

    // Get enrollment count
    const enrollmentCount = await ClassEnrollment.countDocuments({ 
      classId: classData._id 
    });

    const classWithDetails = {
      ...classData,
      teacherName: classData.teacherId?.fullName || classData.teacherName || 'N/A',
      enrollmentCount
    };

    res.json(classWithDetails);
  } catch (error) {
    console.error('Error fetching class by ID:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching class details', 
      error: error.message 
    });
  }
};

// Create a new class (admin)
export const createClass = async (req, res) => {
  try {
    console.log('Admin create class request received:', req.body);
    
    // Validate required fields
    const { classNumber, subjectCode, subjectName, classYear, semester, division } = req.body;
    
    if (!classNumber || !subjectCode || !subjectName || !classYear || !semester || !division) {
      return res.status(400).json({
        success: false,
        message: 'All required fields must be provided: classNumber, subjectCode, subjectName, classYear, semester, division'
      });
    }

    // Check if class with same details already exists
    const existingClass = await Class.findOne({
      classNumber,
      subjectCode,
      classYear,
      semester,
      division
    });

    if (existingClass) {
      return res.status(400).json({
        success: false,
        message: 'A class with these details already exists'
      });
    }

    // Create the class
    const classData = {
      ...req.body,
      createdBy: req.user.id, // Admin who created the class
    };

    // If teacherId is provided, validate that the teacher exists and add teacher name
    if (req.body.teacherId) {
      const teacher = await User.findById(req.body.teacherId);
      if (!teacher || teacher.role !== 'teacher') {
        return res.status(400).json({
          success: false,
          message: 'Invalid teacher ID provided'
        });
      }
      classData.teacherName = teacher.fullName;
    } else {
      // For unassigned classes, remove teacherId and teacherName to avoid validation issues
      delete classData.teacherId;
      delete classData.teacherName;
    }

    const newClass = await Class.create(classData);
    console.log('Class created successfully by admin:', newClass._id);

    // Populate teacher details for response
    const populatedClass = await Class.findById(newClass._id)
      .populate('teacherId', 'fullName email')
      .lean();

    res.status(201).json({
      success: true,
      message: 'Class created successfully',
      class: {
        ...populatedClass,
        teacherName: populatedClass.teacherId?.fullName || populatedClass.teacherName || 'N/A',
        enrollmentCount: 0
      }
    });
  } catch (error) {
    console.error('Admin create class error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error creating class', 
      error: error.message 
    });
  }
};

// Get attendance records for a class (admin)
export const getAttendanceRecords = async (req, res) => {
  try {
    const { classId } = req.params;
    const { from, to } = req.query;

    // Get all enrolled students
    const enrolledStudents = await ClassEnrollment.find({ classId })
      .populate('studentId', 'fullName enrollmentNo')
      .lean();

    if (enrolledStudents.length === 0) {
      return res.json({
        success: true,
        records: [],
        count: 0,
        message: 'No students enrolled in this class'
      });
    }

    // Build query for attendance records
    const attendanceQuery = { classId };
    if (from || to) {
      attendanceQuery.timestamp = {};
      if (from) attendanceQuery.timestamp.$gte = new Date(from);
      if (to) {
        const toDate = new Date(to);
        toDate.setHours(23, 59, 59, 999); // End of day
        attendanceQuery.timestamp.$lte = toDate;
      }
    }

    // Get all attendance records
    const attendanceRecords = await Attendance.find(attendanceQuery)
      .populate('studentId', 'fullName enrollmentNo')
      .sort({ timestamp: -1 })
      .lean();

    console.log(`Found ${attendanceRecords.length} attendance records for class ${classId}`);

    // Group attendance by date and create session-like records
    const dateMap = new Map();
    
    for (const record of attendanceRecords) {
      const date = record.timestamp?.toISOString().split('T')[0] || 'Unknown';
      const time = record.timestamp?.toTimeString().split(' ')[0] || 'N/A';
      const studentId = record.studentId?._id?.toString();
      
      if (!dateMap.has(date)) {
        dateMap.set(date, {
          date,
          time,
          presentStudents: new Set()
        });
      }
      
      dateMap.get(date).presentStudents.add(studentId);
    }

    // If no attendance records found, return empty
    if (dateMap.size === 0) {
      return res.json({
        success: true,
        records: [],
        count: 0,
        message: 'No attendance records found for this class'
      });
    }

    // Build complete records for all students across all dates
    const records = [];
    const studentIdToEnrollment = new Map(
      enrolledStudents.map(e => [e.studentId?._id?.toString(), e])
    );

    for (const [date, sessionData] of dateMap.entries()) {
      for (const enrollment of enrolledStudents) {
        const studentId = enrollment.studentId?._id?.toString();
        const isPresent = sessionData.presentStudents.has(studentId);
        
        records.push({
          _id: `${date}_${studentId}`,
          date,
          time: sessionData.time,
          status: isPresent ? 'present' : 'absent',
          studentId: enrollment.studentId?._id || null,
          studentName: enrollment.studentId?.fullName || 'N/A',
          enrollmentNo: enrollment.studentId?.enrollmentNo || 'N/A'
        });
      }
    }

    console.log(`Generated ${records.length} attendance records (${dateMap.size} dates × ${enrolledStudents.length} students)`);

    res.json({
      success: true,
      records,
      count: records.length,
      totalSessions: dateMap.size,
      totalStudents: enrolledStudents.length
    });
  } catch (error) {
    console.error('Error fetching attendance records:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching attendance records', 
      error: error.message 
    });
  }
};

// Get all recurring schedules (admin)
export const getAllRecurringSchedules = async (req, res) => {
  try {
    const { teacherId, classId, isActive } = req.query;

    const query = {};
    if (teacherId) query.teacherId = teacherId;
    if (classId) query.classId = classId;
    if (isActive !== undefined) query.isActive = isActive === 'true';

    const schedules = await RecurringSchedule.find(query)
      .populate('classId', 'subjectName subjectCode classNumber')
      .populate('teacherId', 'fullName email')
      .sort({ dayOfWeek: 1, startTime: 1 })
      .lean();

    res.json({
      success: true,
      schedules,
      count: schedules.length
    });
  } catch (error) {
    console.error('Error fetching recurring schedules:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching recurring schedules', 
      error: error.message 
    });
  }
};

// Create recurring schedule (admin)
export const createRecurringSchedule = async (req, res) => {
  try {
    const {
      classId,
      teacherId,
      title,
      sessionType,
      dayOfWeek,
      startTime,
      endTime,
      roomNumber,
      semester,
      academicYear,
      semesterStartDate,
      semesterEndDate,
      frequency,
      description,
      notes
    } = req.body;

    // Validation
    if (!classId || !teacherId || !title || !sessionType || !dayOfWeek || 
        !startTime || !endTime || !roomNumber || !semester || !academicYear ||
        !semesterStartDate || !semesterEndDate) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields'
      });
    }

    // Check if teacher exists
    const teacher = await User.findOne({ _id: teacherId, role: 'teacher' });
    if (!teacher) {
      return res.status(404).json({
        success: false,
        message: 'Teacher not found'
      });
    }

    // Check if class exists
    const classDoc = await Class.findById(classId);
    if (!classDoc) {
      return res.status(404).json({
        success: false,
        message: 'Class not found'
      });
    }

    // Create recurring schedule
    const recurringSchedule = await RecurringSchedule.create({
      classId,
      teacherId,
      title,
      sessionType,
      dayOfWeek,
      startTime,
      endTime,
      roomNumber,
      semester,
      academicYear,
      semesterStartDate: new Date(semesterStartDate),
      semesterEndDate: new Date(semesterEndDate),
      frequency: frequency || 'weekly',
      isRecurring: true,
      isActive: true,
      description,
      notes
    });

    const populatedSchedule = await RecurringSchedule.findById(recurringSchedule._id)
      .populate('classId', 'subjectName subjectCode classNumber')
      .populate('teacherId', 'fullName email')
      .lean();

    res.status(201).json({
      success: true,
      message: 'Recurring schedule created successfully',
      schedule: populatedSchedule
    });
  } catch (error) {
    console.error('Error creating recurring schedule:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating recurring schedule',
      error: error.message
    });
  }
};

// Delete recurring schedule
export const deleteRecurringSchedule = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Schedule ID is required'
      });
    }

    // Find and delete the recurring schedule
    const deletedSchedule = await RecurringSchedule.findByIdAndDelete(id);

    if (!deletedSchedule) {
      return res.status(404).json({
        success: false,
        message: 'Recurring schedule not found'
      });
    }

    res.json({
      success: true,
      message: 'Recurring schedule deleted successfully',
      deletedSchedule: {
        id: deletedSchedule._id,
        title: deletedSchedule.title,
        dayOfWeek: deletedSchedule.dayOfWeek,
        startTime: deletedSchedule.startTime,
        endTime: deletedSchedule.endTime
      }
    });
  } catch (error) {
    console.error('Error deleting recurring schedule:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting recurring schedule',
      error: error.message
    });
  }
};