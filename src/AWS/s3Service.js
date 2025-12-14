        
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

// Lazy initialize S3 client to ensure environment variables are loaded
let s3Client = null;

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

const generateFaceImageFilename = (userId, extension = 'jpg') => {
  const timestamp = Date.now();
  return `user-${userId}-face-${timestamp}.${extension}`;
};

export {
  uploadFaceImage,
  deleteFaceImage,
  generateFaceImageFilename,
  BUCKET_NAME,
  getS3Client
};