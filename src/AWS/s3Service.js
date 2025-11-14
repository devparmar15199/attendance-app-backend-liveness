        
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

// Lazy initialize S3 client to ensure environment variables are loaded
let s3Client = null;

/**
 * Gets a singleton instance of the S3Client.
 * It initializes the client on first call, ensuring AWS credentials
 * are loaded from environment variables.
 * @returns {S3Client} The initialized S3 Client instance.
 * @throws {Error} If AWS credentials (AWS_ACCESS_KEY_ID or AWS_SECRET_ACCESS_KEY) are not set.
 */
const getS3Client = () => {
  if (!s3Client) {
    // Debug environment variables
    console.log('AWS Environment Check:');
    console.log('AWS_REGION:', process.env.AWS_REGION);
    console.log('AWS_ACCESS_KEY_ID:', process.env.AWS_ACCESS_KEY_ID ? 'Set' : 'Not Set');
    console.log('AWS_SECRET_ACCESS_KEY:', process.env.AWS_SECRET_ACCESS_KEY ? 'Set' : 'Not Set');

    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
      throw new Error('AWS credentials not found in environment variables');
    }

    s3Client = new S3Client({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
      }
    });

    console.log('S3 Client initialized successfully');
  }
  return s3Client;
};

/**
 * @const {string} BUCKET_NAME
 * @description The name of the S3 bucket where face images are stored.
 */
const BUCKET_NAME = 'qr-attendance-student-faces-18102025';

/**
 * Upload face image to S3.
 * Creates a unique key, sets metadata, and uploads the image buffer.
 *
 * @param {Buffer} imageBuffer - The image buffer (e.g., from a file upload or mobile camera).
 * @param {string} filename - The original or desired filename for the S3 object.
 * @param {string} [contentType='image/jpeg'] - The content type of the image.
 * @returns {Promise<string>} The full S3 key (path) of the uploaded image.
 * @throws {Error} If the upload to S3 fails.
 */
const uploadFaceImage = async (imageBuffer, filename, contentType = 'image/jpeg') => {
  try {
    const client = getS3Client();

    // Creates a unique key to prevent file collisions
    const key = `face-images/${Date.now()}-${filename}`;

    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: imageBuffer,
      ContentType: contentType,
      ACL: 'private', // Make sure images are private and only accessible via SDK/presigned URLs
      Metadata: {
        purpose: 'face-recognition',
        uploadedAt: new Date().toISOString()
      }
    });

    await client.send(command);

    console.log(`Successfully uploaded face image to S3: ${key}`);
    return key;
  } catch (error) {
    console.error('Error uploading face image to S3:', error);
    throw new Error(`Failed to upload face image: ${error.message}`);
  }
};

const deleteFaceImage = async (S3Key) => {
  try {
    const client = getS3Client();
    const command = new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: S3Key
    });
    await client.send(command);
    console.log(`Successfully deleted object from S3: ${S3Key}`);
  } catch (error) {
    error('Error deleting object from S3:', error);
    throw new Error(`Failed to delete object from S3: ${error.message}`);
  }
}

/**
 * Generate a unique filename for face images.
 * This helps in creating a standardized and collision-resistant filename.
 *
 * @param {string} userId - The unique ID of the user (e.g., student ID).
 * @param {string} [extension='jpg'] - File extension (default: jpg).
 * @returns {string} A formatted, unique filename.
 */
const generateFaceImageFilename = (userId, extension = 'jpg') => {
  const timestamp = Date.now();
  return `user-${userId}-face-${timestamp}.${extension}`;
};

export {
  uploadFaceImage,
  deleteFaceImage,
  generateFaceImageFilename,
  BUCKET_NAME
};