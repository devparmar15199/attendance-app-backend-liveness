import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

const BUCKET_NAME = 'qr-attendance-student-faces-18102025';
const REGION = process.env.AWS_REGION || 'ap-south-1';

// Lazy Singleton Client
let s3Client = null;
const getS3Client = () => {
  if (!s3Client) {
    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
      throw new Error('Missing AWS Credentials in environment variables.');
    }

    s3Client = new S3Client({
      region: REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
      }
    });
  }
  return s3Client;
};

export const uploadFaceImage = async (imageBuffer, filename, contentType = 'image/jpeg') => {
  try {
    const key = `face-images/${Date.now()}-${filename}`;
    await getS3Client().send(new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: imageBuffer,
      ContentType: contentType,
      ACL: 'private',
      Metadata: { purpose: 'face-recognition' }
    }));
    return key;
  } catch (error) {
    throw new Error(`Upload failed: ${error.message}`);
  }
};

export const deleteFaceImage = async (S3Key) => {
  try {
    await getS3Client().send(new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: S3Key
    }));
  } catch (error) {
    throw new Error(`Delete failed: ${error.message}`);
  }
}

const generateFaceImageFilename = (userId, extension = 'jpg') => {
  const timestamp = Date.now();
  return `user-${userId}-face-${timestamp}.${extension}`;
};

export { BUCKET_NAME, generateFaceImageFilename };