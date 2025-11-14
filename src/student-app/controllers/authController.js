import { User } from '../../models/userModel.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { uploadFaceImage, generateFaceImageFilename } from '../../AWS/s3Service.js';

// Generate JWT Token
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET || 'fallback_secret', { expiresIn: '30d' });
};

// Register (works students)
export const register = async (req, res) => {
  console.log('Unified registration request received:', req.body);
  console.log('Files received:', req.files);
  
  try {
    const { fullName, email, password, enrollmentNo, classYear, semester, division } = req.body;

    // --- Student-Specific Validation ---
    if (!fullName || !email || !password) {
      return res.status(400).json({
        message: 'Full name, email, and password are required'
      });
    }
    if (!enrollmentNo) {
      return res.status(400).json({
        message: 'Enrollment number is required for students',
        error: 'ENROLLMENT_REQUIRED'
      });
    }
    if (!classYear) {
      return res.status(400).json({
        message: 'Class year is required for students',
        error: 'CLASS_YEAR_REQUIRED'
      });
    }
    if (!semester) {
      return res.status(400).json({
        message: 'Semester is required for students',
        error: 'SEMESTER_REQUIRED'
      });
    }
    // --- ADDED division validation ---
    if (!division) {
      return res.status(400).json({
        message: 'Division is required for students',
        error: 'DIVISION_REQUIRED'
      });
    }

    // Check if user exists by email
    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(409).json({
        message: 'An account with this email already exists. Please use a different email or try logging in.',
        error: 'EMAIL_EXISTS',
        suggestion: 'Try logging in instead or use a different email address'
      });
    }

    // Check if enrollment number already exists
    const enrollmentExists = await User.findOne({ enrollmentNo });
    if (enrollmentExists) {
      return res.status(409).json({
        message: 'This enrollment number is already registered. Please check your enrollment number or contact support.',
        error: 'ENROLLMENT_EXISTS',
        suggestion: 'Verify your enrollment number or try logging in if you already have an account'
      });
    }

    // Create user data - pass plain password, let pre-save hook handle hashing
    const userData = {
      fullName,
      email,
      password: password, // Pre-save hook will hash this
      role: 'student', // --- CHANGED: Hardcoded to 'student'
      enrollmentNo,
      classYear,
      semester,
      division // --- ADDED: Division is now saved
    };

    // Handle face image upload if provided
    let faceImageS3Key = null;

    if (req.files && req.files.faceImage) {
      try {
        console.log('Processing face image upload...');
        const faceImageFile = req.files.faceImage[0];
        const filename = generateFaceImageFilename(fullName);
        
        // Upload to S3
        faceImageS3Key = await uploadFaceImage(
          faceImageFile.buffer, 
          filename, 
          faceImageFile.mimetype
        );
        
        userData.faceImageS3Key = faceImageS3Key;
      } catch (faceError) {
        console.error('Error processing face image:', faceError);
        // Continue with registration even if face processing fails
        console.log('Continuing registration without face data...');
      }
    } else if (req.body.faceImageBase64) {
      try {
        // Handle base64 image from mobile app
        const base64Data = req.body.faceImageBase64.replace(/^data:image\/[a-z]+;base64,/, '');
        const imageBuffer = Buffer.from(base64Data, 'base64');
        const filename = generateFaceImageFilename(fullName);
        
        // Upload to S3
        console.log('Attempting S3 upload...');
        faceImageS3Key = await uploadFaceImage(imageBuffer, filename, 'image/jpeg');
        
        userData.faceImageS3Key = faceImageS3Key;
      } catch (faceError) {
        console.error('Error processing base64 face image:', faceError);
        // Continue with registration even if face processing fails
        console.log('Continuing registration without face data...');
      }
    }

    // Create user
    const user = await User.create(userData);

    console.log('User created successfully:', user._id);

    if (user) {
      res.status(201).json({
        token: generateToken(user._id),
        user: {
          _id: user._id,
          fullName: user.fullName || user.name,
          email: user.email,
          role: user.role,
          enrollmentNo: user.enrollmentNo,
          classYear: user.classYear,
          semester: user.semester,
          division: user.division,
          hasFaceImage: !!user.faceImageS3Key
        }
      });
    } else {
      console.log('Failed to create user');
      res.status(400).json({ message: 'Invalid user data' });
    }
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: error.message });
  }
};

// Unified Login (works students)
export const login = async (req, res) => {
  console.log('Login request received:', { email: req.body.email, enrollmentNo: req.body.enrollmentNo, hasPassword: !!req.body.password });
  try {
    const { email, enrollmentNo, password } = req.body;

    // Build query - support login with either email or enrollmentNo
    let query = {};
    if (email) {
      query.email = email;
    } else if (enrollmentNo) {
      query.enrollmentNo = enrollmentNo;
    } else {
      return res.status(400).json({ message: 'Email or enrollment number is required' });
    }

    // Find user
    const user = await User.findOne(query);

    if (user && (await user.matchPassword(password))) {
      console.log('Login successful for user:', user.enrollmentNo || user.email);
      res.json({
        token: generateToken(user._id),
        user: {
          _id: user._id,
          fullName: user.fullName || user.name,
          email: user.email,
          role: user.role,
          enrollmentNo: user.enrollmentNo,
          classYear: user.classYear,
          semester: user.semester,
          division: user.division,
          hasFaceImage: !!user.faceImageS3Key
        }
      });
    } else {
      console.log('Sending 401 Invalid credentials response');
      res.status(401).json({ message: 'Invalid credentials' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Forgot Password
export const forgotPassword = async (req, res) => {
  try {
    const { email, enrollmentNo } = req.body;
    
    if (!email && !enrollmentNo) {
      return res.status(400).json({ message: 'Email or enrollment number is required' });
    }

    // Build query
    let query = {};
    if (email) {
      query.email = email;
    } else if (enrollmentNo) {
      query.enrollmentNo = enrollmentNo;
    }

    const user = await User.findOne(query);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // For now, just return a success message
    // In a real implementation, you would send an email with a reset link
    res.json({ 
      message: 'Password reset instructions have been sent to your email address',
      userFound: true,
      email: user.email
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};