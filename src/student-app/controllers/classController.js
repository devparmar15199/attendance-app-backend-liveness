import { Class } from '../../models/classModel.js';
import { ClassEnrollment } from '../../models/classEnrollmentModel.js';
import { User } from '../../models/userModel.js';

// Get all classes
export const getAllClasses = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;

    let classes;

    if (userRole === 'student') {
      // For students, only return enrolled classes
      const enrollments = await ClassEnrollment.find({ studentId: userId })
        .populate({
          path: 'classId',
          select: 'classNumber subjectCode subjectName classYear semester division teacherId teacherName'
        });
      
      classes = enrollments.map(enrollment => enrollment.classId);
    } else if (userRole === 'teacher') {
      // For teachers, return classes they teach
      classes = await Class.find({ teacherId: userId });
    } else {
      // For admins, return all classes
      classes = await Class.find();
    }

    // Transform to match expected format
    const transformedClasses = classes.map(cls => ({
      _id: cls._id,
      classNumber: cls.classNumber,
      subjectCode: cls.subjectCode,
      subjectName: cls.subjectName,
      classYear: cls.classYear,
      semester: cls.semester,
      division: cls.division,
      teacherId: cls.teacherId,
      teacherName: cls.teacherName
    }));

    res.json(transformedClasses);

  } catch (error) {
    console.error('Get All Classes Error:', error);
    res.status(500).json({ message: error.message });
  }
};

// Get enrolled classes (for students)
export const getEnrolledClasses = async (req, res) => {
  try {
    const studentId = req.user.id;

    if (req.user.role !== 'student') {
      return res.status(403).json({ message: 'This endpoint is only for students' });
    }

    const enrollments = await ClassEnrollment.find({ studentId })
      .populate({
        path: 'classId',
        select: 'classNumber subjectCode subjectName classYear semester division teacherId teacherName'
      });

    const classes = enrollments
      .filter(enrollment => enrollment.classId) // Filter out enrollments with null classId
      .map(enrollment => ({
        _id: enrollment.classId._id,
        classNumber: enrollment.classId.classNumber,
        subjectCode: enrollment.classId.subjectCode,
        subjectName: enrollment.classId.subjectName,
        classYear: enrollment.classId.classYear,
        semester: enrollment.classId.semester,
        division: enrollment.classId.division,
        teacherId: enrollment.classId.teacherId,
        teacherName: enrollment.classId.teacherName
      }));

    res.json(classes);

  } catch (error) {
    console.error('Get Enrolled Classes Error:', error);
    res.status(500).json({ message: error.message });
  }
};

// Get all available classes for students to browse and enroll
export const getAvailableClasses = async (req, res) => {
  try {
    const studentId = req.user.id;

    if (req.user.role !== 'student') {
      return res.status(403).json({ message: 'This endpoint is only for students' });
    }

    const student = await User.findById(studentId).select('classYear semester division');
    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }

    // Get all classes
    // const allClasses = await Class.find()
    //   .populate('teacherId', 'fullName email')
    //   .select('classNumber subjectCode subjectName classYear semester division teacherId');

    // Get student's current enrollments
    const enrollments = await ClassEnrollment.find({ studentId }).select('classId -_id');
    const enrolledClassIds = enrollments.map(e => e.classId.toString());

    // Filter out classes the student is already enrolled in
    // const availableClasses = allClasses
    //   .filter(cls => !enrolledClassIds.includes(cls._id.toString()))
    //   .map(cls => ({
    //     _id: cls._id,
    //     classNumber: cls.classNumber,
    //     subjectCode: cls.subjectCode,
    //     subjectName: cls.subjectName,
    //     classYear: cls.classYear,
    //     semester: cls.semester,
    //     division: cls.division,
    //     teacher: {
    //       _id: cls.teacherId._id,
    //       fullName: cls.teacherId.fullName || cls.teacherName,
    //       email: cls.teacherId.email
    //     }
    //   }));

    const availableClasses = await Class.find({
      classYear: student.classYear,
      semester: student.semester,
      division: student.division,
      _id: { $nin: enrolledClassIds }
    }).select('classNumber subjectCode subjectName classYear semester division teacherId teacherName');

    if (!availableClasses || availableClasses.length === 0) {
        return res.json({
            success: true,
            data: [],
            total: 0
        });
    }

    const classIds = availableClasses.map(cls => cls._id);

    const populatedClasses = availableClasses.map(cls => ({
      _id: cls._id,
      classNumber: cls.classNumber,
      subjectCode: cls.subjectCode,
      subjectName: cls.subjectName,
      classYear: cls.classYear,
      semester: cls.semester,
      division: cls.division,
      teacher: {
        _id: cls.teacherId,
        fullName: cls.teacherName,
        email: ''
      }
    }));

    res.json({
      success: true,
      data: populatedClasses,
      total: populatedClasses.length
    });

  } catch (error) {
    console.error('Get Available Classes Error:', error);
    res.status(500).json({ 
      success: false,
      message: error.message 
    });
  }
};

// Get class by ID
export const getClassById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    // Validate ObjectId format
    if (!id || !id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ 
        message: 'Invalid class ID format',
        error: 'Class ID must be a valid MongoDB ObjectId' 
      });
    }

    const classRecord = await Class.findById(id);
    
    if (!classRecord) {
      return res.status(404).json({ message: 'Class not found' });
    }

    // Check permissions
    if (userRole === 'student') {
      const enrollment = await ClassEnrollment.findOne({
        studentId: userId,
        classId: id
      });
      
      if (!enrollment) {
        return res.status(403).json({ message: 'You are not enrolled in this class' });
      }
    } else if (userRole === 'teacher' && classRecord.teacherId.toString() !== userId) {
      return res.status(403).json({ message: 'You do not have access to this class' });
    }

    res.json({
      _id: classRecord._id,
      classNumber: classRecord.classNumber,
      subjectCode: classRecord.subjectCode,
      subjectName: classRecord.subjectName,
      classYear: classRecord.classYear,
      semester: classRecord.semester,
      division: classRecord.division,
      teacherId: classRecord.teacherId,
      teacherName: classRecord.teacherName
    });

  } catch (error) {
    console.error('Get Class By ID Error:', error);
    res.status(500).json({ message: error.message });
  }
};

// Student self-enrollment in a class
export const enrollInClass = async (req, res) => {
  try {
    const { classId } = req.params;
    const studentId = req.user.id;

    if (req.user.role !== 'student') {
      return res.status(403).json({ 
        success: false,
        message: 'This endpoint is only for students' 
      });
    }

    // Validate ObjectId format
    if (!classId || !classId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ 
        success: false,
        message: 'Invalid class ID format',
        error: 'Class ID must be a valid MongoDB ObjectId' 
      });
    }

    // Verify the class exists
    const classData = await Class.findById(classId);
    if (!classData) {
      return res.status(404).json({ 
        success: false,
        message: 'Class not found' 
      });
    }

    // Check if student is already enrolled
    const existingEnrollment = await ClassEnrollment.findOne({ classId, studentId });
    if (existingEnrollment) {
      return res.status(409).json({ 
        success: false,
        message: 'You are already enrolled in this class' 
      });
    }

    // Create enrollment
    const enrollment = await ClassEnrollment.create({ classId, studentId });
    
    // Populate the enrollment for response
    const populatedEnrollment = await ClassEnrollment.findById(enrollment._id)
      .populate('studentId', 'fullName name email enrollmentNo')
      .populate('classId', 'classNumber subjectCode subjectName classYear semester division');

    res.status(201).json({
      success: true,
      message: 'Successfully enrolled in class!',
      data: {
        _id: populatedEnrollment._id,
        student: {
          _id: populatedEnrollment.studentId._id,
          name: populatedEnrollment.studentId.fullName || populatedEnrollment.studentId.name,
          email: populatedEnrollment.studentId.email,
          enrollmentNo: populatedEnrollment.studentId.enrollmentNo
        },
        class: {
          _id: populatedEnrollment.classId._id,
          classNumber: populatedEnrollment.classId.classNumber,
          subjectCode: populatedEnrollment.classId.subjectCode,
          subjectName: populatedEnrollment.classId.subjectName,
          classYear: populatedEnrollment.classId.classYear,
          semester: populatedEnrollment.classId.semester,
          division: populatedEnrollment.classId.division
        },
        enrolledAt: populatedEnrollment.enrolledAt
      }
    });

  } catch (error) {
    console.error('Enroll In Class Error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to enroll in class',
      error: error.message 
    });
  }
};

/**
 * @desc    Student self-unenrollment from a class
 * @route   DELETE /api/classes/:classId/unenroll
 * @access  Private (Student)
 */
export const unenrollFromClass = async (req, res) => {
  try {
    const { classId } = req.params;
    const studentId = req.user.id;

    // 1. Check user role
    if (req.user.role !== 'student') {
      return res.status(403).json({
        success: false,
        message: 'This endpoint is only for students'
      });
    }

    // 2. Validate ObjectId format
    if (!classId || !classId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid class ID format',
        error: 'Class ID must be a valid MongoDB ObjectId'
      });
    }

    // 3. Find the enrollment
    const enrollment = await ClassEnrollment.findOne({
      classId: classId,
      studentId: studentId
    });

    // 4. Check if enrollment exists
    if (!enrollment) {
      return res.status(404).json({
        success: false,
        message: 'You are not enrolled in this class.'
      });
    }

    // 5. Delete the enrollment
    await enrollment.deleteOne();

    res.status(200).json({
      success: true,
      message: 'Successfully unenrolled from class.'
    });

  } catch (error) {
    console.error('Unenroll From Class Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to unenroll from class',
      error: error.message
    });
  }
};

// Get all available students for teachers to enroll
export const getAvailableStudentsForClass = async (req, res) => {
  try {
    const { classId } = req.params;
    
    if (req.user.role !== 'teacher') {
      return res.status(403).json({ 
        success: false,
        message: 'This endpoint is only for teachers' 
      });
    }

    // Validate ObjectId format
    if (!classId || !classId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ 
        success: false,
        message: 'Invalid class ID format',
        error: 'Class ID must be a valid MongoDB ObjectId' 
      });
    }

    // Verify the class exists and belongs to the teacher
    const classData = await Class.findById(classId);
    if (!classData) {
      return res.status(404).json({ 
        success: false,
        message: 'Class not found' 
      });
    }

    if (classData.teacherId.toString() !== req.user.id) {
      return res.status(403).json({ 
        success: false,
        message: 'You do not have access to this class' 
      });
    }

    // Get all students matching the class year and semester
    const allStudents = await User.find({ 
      role: 'student',
      classYear: classData.classYear,
      semester: classData.semester
    })
      .select('fullName name email enrollmentNo classYear semester')
      .sort({ fullName: 1, name: 1 });

    // Get students already enrolled in this class
    const enrollments = await ClassEnrollment.find({ classId });
    const enrolledStudentIds = enrollments.map(e => e.studentId.toString());

    // Filter out already enrolled students
    const availableStudents = allStudents.filter(s => 
      !enrolledStudentIds.includes(s._id.toString())
    );

    const formattedStudents = availableStudents.map(student => ({
      _id: student._id,
      name: student.fullName || student.name,
      email: student.email,
      enrollmentNo: student.enrollmentNo,
      classYear: student.classYear,
      semester: student.semester
    }));

    res.json({
      success: true,
      data: formattedStudents,
      total: formattedStudents.length
    });

  } catch (error) {
    console.error('Get Available Students Error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to get available students',
      error: error.message 
    });
  }
};

// Teacher enroll single student in class
export const teacherEnrollStudent = async (req, res) => {
  try {
    const { classId } = req.params;
    const { studentId } = req.body;
    
    if (req.user.role !== 'teacher') {
      return res.status(403).json({ 
        success: false,
        message: 'This endpoint is only for teachers' 
      });
    }

    // Validate ObjectId formats
    if (!classId || !classId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ 
        success: false,
        message: 'Invalid class ID format',
        error: 'Class ID must be a valid MongoDB ObjectId' 
      });
    }

    if (!studentId || !studentId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ 
        success: false,
        message: 'Invalid student ID format',
        error: 'Student ID must be a valid MongoDB ObjectId' 
      });
    }

    // Verify the class exists and belongs to the teacher
    const classData = await Class.findById(classId);
    if (!classData) {
      return res.status(404).json({ 
        success: false,
        message: 'Class not found' 
      });
    }

    if (classData.teacherId.toString() !== req.user.id) {
      return res.status(403).json({ 
        success: false,
        message: 'You do not have access to this class' 
      });
    }

    // Verify the student exists
    const student = await User.findOne({ _id: studentId, role: 'student' });
    if (!student) {
      return res.status(404).json({ 
        success: false,
        message: 'Student not found' 
      });
    }

    // Check if student is already enrolled
    const existingEnrollment = await ClassEnrollment.findOne({ classId, studentId });
    if (existingEnrollment) {
      return res.status(409).json({ 
        success: false,
        message: 'Student is already enrolled in this class' 
      });
    }

    // Create enrollment
    const enrollment = await ClassEnrollment.create({ classId, studentId });
    
    // Populate the enrollment for response
    const populatedEnrollment = await ClassEnrollment.findById(enrollment._id)
      .populate('studentId', 'fullName name email enrollmentNo')
      .populate('classId', 'classNumber subjectCode subjectName classYear semester division');

    res.status(201).json({
      success: true,
      message: 'Student enrolled successfully!',
      data: {
        _id: populatedEnrollment._id,
        student: {
          _id: populatedEnrollment.studentId._id,
          name: populatedEnrollment.studentId.fullName || populatedEnrollment.studentId.name,
          email: populatedEnrollment.studentId.email,
          enrollmentNo: populatedEnrollment.studentId.enrollmentNo
        },
        class: {
          _id: populatedEnrollment.classId._id,
          classNumber: populatedEnrollment.classId.classNumber,
          subjectCode: populatedEnrollment.classId.subjectCode,
          subjectName: populatedEnrollment.classId.subjectName,
          classYear: populatedEnrollment.classId.classYear,
          semester: populatedEnrollment.classId.semester,
          division: populatedEnrollment.classId.division
        },
        enrolledAt: populatedEnrollment.enrolledAt
      }
    });

  } catch (error) {
    console.error('Teacher Enroll Student Error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to enroll student',
      error: error.message 
    });
  }
};

// Teacher batch enroll students in class
export const teacherBatchEnrollStudents = async (req, res) => {
  try {
    const { classId } = req.params;
    const { studentIds } = req.body;
    
    if (req.user.role !== 'teacher') {
      return res.status(403).json({ 
        success: false,
        message: 'This endpoint is only for teachers' 
      });
    }

    if (!Array.isArray(studentIds) || studentIds.length === 0) {
      return res.status(400).json({ 
        success: false,
        message: 'Student IDs array is required and cannot be empty' 
      });
    }

    // Validate ObjectId formats
    if (!classId || !classId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ 
        success: false,
        message: 'Invalid class ID format',
        error: 'Class ID must be a valid MongoDB ObjectId' 
      });
    }

    // Validate all student IDs
    const invalidStudentIds = studentIds.filter(id => !id || !id.match(/^[0-9a-fA-F]{24}$/));
    if (invalidStudentIds.length > 0) {
      return res.status(400).json({ 
        success: false,
        message: 'Invalid student ID format(s)',
        error: 'All student IDs must be valid MongoDB ObjectIds' 
      });
    }

    // Verify the class exists and belongs to the teacher
    const classData = await Class.findById(classId);
    if (!classData) {
      return res.status(404).json({ 
        success: false,
        message: 'Class not found' 
      });
    }

    if (classData.teacherId.toString() !== req.user.id) {
      return res.status(403).json({ 
        success: false,
        message: 'You do not have access to this class' 
      });
    }

    // Verify all students exist
    const students = await User.find({ 
      _id: { $in: studentIds }, 
      role: 'student' 
    });
    
    if (students.length !== studentIds.length) {
      return res.status(404).json({ 
        success: false,
        message: 'One or more students not found' 
      });
    }

    // Check for existing enrollments
    const existingEnrollments = await ClassEnrollment.find({ 
      classId, 
      studentId: { $in: studentIds } 
    });
    
    const alreadyEnrolledIds = existingEnrollments.map(e => e.studentId.toString());
    const newStudentIds = studentIds.filter(id => !alreadyEnrolledIds.includes(id));

    if (newStudentIds.length === 0) {
      return res.status(409).json({ 
        success: false,
        message: 'All selected students are already enrolled in this class' 
      });
    }

    // Create enrollments for new students
    const enrollmentData = newStudentIds.map(studentId => ({
      classId,
      studentId
    }));

    const enrollments = await ClassEnrollment.insertMany(enrollmentData);
    
    // Populate enrollments for response
    const populatedEnrollments = await ClassEnrollment.find({ 
      _id: { $in: enrollments.map(e => e._id) } 
    })
      .populate('studentId', 'fullName name email enrollmentNo')
      .populate('classId', 'classNumber subjectCode subjectName');

    const enrolledStudents = populatedEnrollments.map(enrollment => ({
      _id: enrollment.studentId._id,
      name: enrollment.studentId.fullName || enrollment.studentId.name,
      email: enrollment.studentId.email,
      enrollmentNo: enrollment.studentId.enrollmentNo,
      enrolledAt: enrollment.enrolledAt
    }));

    res.status(201).json({
      success: true,
      message: `Successfully enrolled ${enrolledStudents.length} student(s)`,
      data: {
        enrolledCount: enrolledStudents.length,
        skippedCount: alreadyEnrolledIds.length,
        enrolledStudents: enrolledStudents
      }
    });

  } catch (error) {
    console.error('Teacher Batch Enroll Students Error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to enroll students',
      error: error.message 
    });
  }
};
