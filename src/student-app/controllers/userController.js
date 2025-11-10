import { User } from '../../models/userModel.js';
import bcrypt from 'bcryptjs';
import { 
  uploadFaceImage as uploadToS3,
  generateFaceImageFilename
} from '../../AWS/s3Service.js';

// Get User Profile
export const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({
      _id: user._id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      enrollmentNo: user.enrollmentNo,
      classYear: user.classYear,
      semester: user.semester,
      hasFaceImage: !!user.faceImageS3Key,
      createdAt: user.createdAt
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Update User Profile
export const updateProfile = async (req, res) => {
  try {
    const { fullName, email } = req.body;
    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Update fields if provided
    if (fullName) {
      user.fullName = fullName;
    }
    if (email) {
      // Add check for email uniqueness if desired
      const emailExists = await User.findOne({ email, _id: { $ne: user._id } });
      if (emailExists) {
        return res.status(400).json({ message: 'Email already in use.' });
      }
      user.email = email;
    }

    const updatedUser = await user.save();

    res.json({
      _id: updatedUser._id,
      fullName: updatedUser.fullName,
      email: updatedUser.email,
      role: updatedUser.role,
      enrollmentNo: updatedUser.enrollmentNo,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Change Password
export const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Current password and new password are required' });
    }

    if (newPassword.length < 6) { // Example of a simple strength check
        return res.status(400).json({ message: 'New password must be at least 6 characters long' });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Verify current password
    const isCurrentPasswordValid = await user.matchPassword(currentPassword);
    if (!isCurrentPasswordValid) {
      return res.status(400).json({ message: 'Current password is incorrect' });
    }
    
    user.password = newPassword;
    await user.save();

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * @desc    Update the student's registered face image
 * @route   PUT /api/users/profile/face
 * @access  Private (Student)
 */
export const updateFaceImage = async (req, res) => {
  try {
    const studentId = req.user.id;

    // 1. Check if file exists (multer middleware adds `files` object)
    if (!req.files || !req.files.faceImage || !req.files.faceImage[0]) {
      return res.status(400).json({ message: 'No face image file was uploaded.' });
    }
    
    const file = req.files.faceImage[0];
    const imageBuffer = file.buffer;
    const contentType = file.mimetype;

    // 2. Generate a unique filename for S3
    const filename = generateFaceImageFilename(studentId, contentType.split('/')[1] || 'jpg');

    // 3. Upload the new image to S3 using the service
    console.log(`Uploading new face image for user ${studentId} to S3...`);
    const newS3Key = await uploadToS3(imageBuffer, filename, contentType);

    // 4. Update the user's record in the database
    // Note: We are not deleting the old S3 object here, which might orphan it.
    // A robust solution would involve also deleting the old user.faceImageS3Key from S3.
    const user = await User.findById(studentId);
    if (user.faceImageS3Key) {
        console.warn(`Orphaned S3 key: ${user.faceImageS3Key}. Consider implementing S3 delete logic.`);
    }

    user.faceImageS3Key = newS3Key;
    await user.save();

    res.status(200).json({
      message: 'Face image updated successfully.',
      faceImageS3Key: newS3Key
    });

  } catch (error) {
    console.error('Error updating face image:', error);
    res.status(500).json({ message: `Failed to update face image: ${error.message}` });
  }
};