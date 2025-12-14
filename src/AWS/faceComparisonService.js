import {
  RekognitionClient,
  CompareFacesCommand,
  DetectFacesCommand
} from '@aws-sdk/client-rekognition';
import { BUCKET_NAME } from './s3Service.js';

// Configuration
const CONFIG = {
  REGION: process.env.AWS_REGION || 'ap-south-1',
  SIMILARITY_THRESHOLD: 90,
  MIN_CONFIDENCE: 90
};

// Lazy Singleton Client
let rekClient = null;
const getClient = () => {
  if (!rekClient) {
    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
      throw new Error('Missing AWS Credentials.');
    }

    rekClient = new RekognitionClient({
      region: CONFIG.REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
      }
    });
  }
  return rekClient;
};

/**
 * Optimized Face Detection
 * Returns liveness indicators from a single image buffer.
 */
export const detectFaceWithAttributes = async (imageBytes) => {
  try {
    const command = new DetectFacesCommand({
      Image: { Bytes: imageBytes },
      Attributes: ['ALL'] // Required for Pose, Smile, EyesOpen
    });

    const { FaceDetails } = await getClient().send(command);

    if (!FaceDetails?.length) {
      return {
        success: false,
        reason: 'NO_FACE',
        message: 'No face detected.'
      };
    }

    if (FaceDetails.length > 1) {
      return {
        success: false,
        reason: 'MULTIPLE_FACES',
        message: 'Multiple faces detected.'
      };
    }

    const face = FaceDetails[0];
    if (face.Confidence < CONFIG.MIN_CONFIDENCE) {
      return {
        success: false,
        reason: 'LOW_CONFIDENCE',
        message: 'Face not clear enough.'
      };
    }

    // Quality Check (Fail fast)
    if ((face.Quality?.Brightness || 0) < 30) {
      return {
        success: false,
        reason: 'TOO_DARK',
        message: 'Image too dark.'
      };
    }

    if ((face.Quality?.Sharpness || 0) < 30) {
      return {
        success: false,
        reason: 'BLURRY',
        message: 'Image too blurry.'
      };
    }

    return {
      success: true,
      livenessIndicators: {
        eyesOpen: face.EyesOpen?.Value === true && face.EyesOpen?.Confidence > 80,
        smile: face.Smile?.Value === true && face.Smile?.Confidence > 80,
        pose: {
          pitch: face.Pose?.Pitch || 0,  // Up/Down
          yaw: face.Pose?.Yaw || 0       // Left/Right
        },
      }
    };
  } catch (error) {
    console.error('[FaceDetect] Error:', error);
    throw new Error('Face detection failed.');
  }
};

/**
 * Validates specific liveness actions (Smile, Turn Head, etc.)
 */
export const validateLivenessChallenge = async (imageBytes, challengeType) => {
  const result = await detectFaceWithAttributes(imageBytes);
  if (!result.success) return result;

  const { eyesOpen, smile, pose } = result.livenessIndicators;
  let passed = false;
  let msg = '';

  // Logic Mapping
  const checks = {
    eyes_open: { check: eyesOpen, pass: 'Eyes open', fail: 'Open eyes wider' },
    // smile: { check: smile && face.Smile?.Confidence > 50, pass: 'Smile detected', fail: 'Smile not detected' },
    smile: { check: smile, pass: 'Smile detected', fail: 'Smile not detected' },
    turn_left: { check: pose.yaw < -45, pass: 'Head turned left', fail: 'Turn head left' },
    turn_right: { check: pose.yaw > 15, pass: 'Head turned right', fail: 'Turn head right' },
    look_up: { check: pose.pitch > 10, pass: 'Looking up', fail: 'Look up' },
    neutral: { check: Math.abs(pose.yaw) < 10 && Math.abs(pose.pitch) < 10, pass: 'Neutral face', fail: 'Look straight ahead' }
  };

  const criteria = checks[challengeType] || checks['neutral'];
  passed = criteria.check;
  msg = passed ? criteria.pass : criteria.fail;

  return { success: passed, message: msg };
};

/**
 * Compares face against S3 profile.
 * OPTIMIZED: Removed redundant DetectFaces call. Uses CompareFaces directly.
 */
export const compareFaceWithProfile = async (storedS3Key, imageBytes) => {
  try {
    const command = new CompareFacesCommand({
      SourceImage: { S3Object: { Bucket: BUCKET_NAME, Name: storedS3Key } },
      TargetImage: { Bytes: imageBytes },
      SimilarityThreshold: CONFIG.SIMILARITY_THRESHOLD,
    });

    const { FaceMatches } = await getClient().send(command);

    if (FaceMatches?.length > 0) {
      return {
        success: true,
        similarity: FaceMatches[0].Similarity,
        message: 'Face matched.'
      };
    }

    return {
      success: false,
      reason: 'NOT_MATCH',
      message: 'Face does not match profile.'
    };
  } catch (error) {
    console.error('[FaceCompare] Error:', error);
    return { success: false, reason: 'ERROR', message: 'Comparison failed.' };
  }
};

/**
 * Orchestrator: Validates challenges first, then compares identity.
 */
export const verifyLivenessWithChallenges = async (challengeImages, storedS3Key) => {
  // 1. Validate all Liveness Challenges
  for (const { imageBytes, challengeType } of challengeImages) {
    const check = await validateLivenessChallenge(imageBytes, challengeType);
    if (!check.success) {
      return {
        success: false,
        reason: 'LIVENESS_FAILED',
        message: `Challenge failed: ${check.message}`
      };
    }
  }

  // 2. Verify Identity (Compare with Profile)
  // We use the last image as it's the most recent capture
  const lastImage = challengeImages[challengeImages.length - 1];
  const matchResult = await compareFaceWithProfile(storedS3Key, lastImage.imageBytes);

  if (!matchResult.success) return matchResult;

  return {
    success: true,
    similarity: matchResult.similarity,
    livenessScore: 100,
    message: 'Identity and Liveness Verified'
  };
};
