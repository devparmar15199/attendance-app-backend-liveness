import { 
  RekognitionClient, 
  CreateFaceLivenessSessionCommand, 
  GetFaceLivenessSessionResultsCommand,
  CompareFacesCommand
} from '@aws-sdk/client-rekognition';
import { BUCKET_NAME } from './s3Service.js';

// 1. Lazy Initialization Helper
let rekognitionClient = null;

const getRekognitionClient = () => {
  if (!rekognitionClient) {
    // Debug Check
    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
      console.error('❌ [AWS Error] Credentials missing in .env file');
      throw new Error('AWS credentials not found. Please check your .env file.');
    }

    rekognitionClient = new RekognitionClient({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
      }
    });
    console.log('✅ [AWS] Rekognition client initialized');
  }
  return rekognitionClient;
};

const SIMILARITY_THRESHOLD = 95; // Strict match
const LIVENESS_CONFIDENCE_THRESHOLD = 85; 

/**
 * Step 1: Create a Face Liveness session to send to the frontend
 * @param {string} userId - Optional user ID for tracking
 * @returns {Promise<string>} - Session ID
 */
export const createLivenessSession = async (userId = null) => {
  try {
    const client = getRekognitionClient();

    const commandParams = {};

    if (userId) {
      commandParams.ClientRequestToken = `${userId}-${Date.now()}`;
    }

    commandParams.Settings = {
      OutputConfig: {
        S3Bucket: BUCKET_NAME,
        S3KeyPrefix: `liveness-sessions/${userId || 'anonymous'}/`,
      },
      AuditImagesLimit: 4,
    };
    
    const command = new CreateFaceLivenessSessionCommand(commandParams);
    const response = await client.send(command);

    console.log(`✅ [Liveness] Session created: ${response.SessionId}`);
    return response.SessionId;
  } catch (error) {
    console.error('❌ [AWS Liveness] Error creating session:', error);
    throw error;
  }
};

/**
 * Step 2: Get liveness session results only (without face comparison)
 * @param {string} sessionId - The liveness session ID
 * @returns {Promise<Object>} - Session results
 */
export const getLivenessSessionResults = async (sessionId) => {
  try {
    const client = getRekognitionClient();
    const command = new GetFaceLivenessSessionResultsCommand({ SessionId: sessionId });
    const response = await client.send(command);

    console.log(`📊 [Liveness] Session ${sessionId} - Status: ${response.Status}, Confidence: ${response.Confidence}`);

    return {
      status: response.Status,
      confidence: response.Confidence,
      isLive: response.Status === 'SUCCEEDED' && response.Confidence >= LIVENESS_CONFIDENCE_THRESHOLD,
      referenceImage: response.ReferenceImage,
      auditImages: response.AuditImages,
    };
  } catch (error) {
    console.error('❌ [Liveness] Error getting session results:', error);
    throw error;
  }
};

/**
 * Step 3: Verify the session results and compare against stored profile photo
 * @param {string} sessionId - The liveness session ID
 * @param {string} storedFaceS3Key - S3 key of the stored profile photo
 * @returns {Promise<Object>} - Verification result
 */
export const verifyLivenessAndCompare = async (sessionId, storedFaceS3Key) => {
  try {
    const client = getRekognitionClient();

    // 1. Get Liveness Results
    const getCommand = new GetFaceLivenessSessionResultsCommand({ SessionId: sessionId });
    const sessionResults = await client.send(getCommand);

    console.log(`📊 [Liveness] Session Status: ${sessionResults.Status}, Confidence: ${sessionResults.Confidence}`);

    // 2. Check Liveness Status
    if (sessionResults.Status !== 'SUCCEEDED') {
      console.log(`❌ [Liveness] Session failed or expired. Status: ${sessionResults.Status}`);
      return { 
        success: false, 
        reason: 'LIVENESS_NOT_COMPLETED',
        message: 'Liveness session was not completed successfully.' 
      };
    }

    // 3. Check Liveness Confidence
    if (sessionResults.Confidence < LIVENESS_CONFIDENCE_THRESHOLD) {
      console.log(`❌ [Liveness] Confidence too low: ${sessionResults.Confidence}`);
      return { 
        success: false, 
        reason: 'LOW_CONFIDENCE',
        confidence: sessionResults.Confidence,
        message: 'Liveness check failed. Please ensure you are in good lighting.' 
      };
    }

    // 4. Validate Reference Image exists
    if (!sessionResults.ReferenceImage || !sessionResults.ReferenceImage.Bytes) {
      console.log('❌ [Liveness] No reference image captured');
      return { 
        success: false, 
        reason: 'NO_REFERENCE_IMAGE',
        message: 'No reference image captured during liveness check.' 
      };
    }

    // 5. Compare the Reference Image (from live scan) with Stored S3 Image
    const compareCommand = new CompareFacesCommand({
      SourceImage: {
        S3Object: {
          Bucket: BUCKET_NAME,
          Name: storedFaceS3Key,
        },
      },
      TargetImage: {
        Bytes: sessionResults.ReferenceImage.Bytes,
      },
      SimilarityThreshold: SIMILARITY_THRESHOLD,
    });

    const compareResponse = await client.send(compareCommand);

    // 6. Evaluate Face Match Results
    if (compareResponse.FaceMatches && compareResponse.FaceMatches.length > 0) {
      const bestMatch = compareResponse.FaceMatches[0];
      console.log(`✅ [FaceMatch] Similarity: ${bestMatch.Similarity.toFixed(2)}%`);
      
      return { 
        success: true, 
        livenessConfidence: sessionResults.Confidence,
        similarity: bestMatch.Similarity,
        message: 'Face verification successful.'
      };
    } else {
      console.log('❌ [FaceMatch] Liveness passed, but face did not match profile.');
      return { 
        success: false, 
        reason: 'FACE_NOT_MATCHED',
        livenessConfidence: sessionResults.Confidence,
        message: 'Face does not match the registered student profile.' 
      };
    }

  } catch (error) {
    console.error('❌ [Liveness] Verification error:', error);
    
    // Handle specific AWS errors
    if (error.name === 'InvalidParameterException') {
      return {
        success: false,
        reason: 'INVALID_SESSION',
        message: 'Invalid or expired liveness session.'
      };
    }
    
    if (error.name === 'InvalidS3ObjectException') {
      return {
        success: false,
        reason: 'PROFILE_IMAGE_NOT_FOUND',
        message: 'Student profile image not found.'
      };
    }

    throw new Error('Internal server error during face verification.');
  }
};

/**
 * Utility: Check if a liveness session is still valid/pending
 * @param {string} sessionId - The liveness session ID
 * @returns {Promise<Object>} - Session status
 */
export const checkSessionStatus = async (sessionId) => {
  try {
    const client = getRekognitionClient();
    const command = new GetFaceLivenessSessionResultsCommand({ SessionId: sessionId });
    const response = await client.send(command);

    return {
      sessionId,
      status: response.Status,
      isCompleted: response.Status === 'SUCCEEDED' || response.Status === 'FAILED',
      isExpired: response.Status === 'EXPIRED',
    };
  } catch (error) {
    console.error('❌ [Liveness] Error checking session status:', error);
    throw error;
  }
};