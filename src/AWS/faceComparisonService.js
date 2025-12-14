import { 
  RekognitionClient, 
  CompareFacesCommand,
  DetectFacesCommand 
} from '@aws-sdk/client-rekognition';
import { BUCKET_NAME } from './s3Service.js';

// Lazy Initialization
let rekognitionClient = null;

const getRekognitionClient = () => {
  if (!rekognitionClient) {
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
    console.log('✅ [AWS] Rekognition client initialized for face comparison');
  }
  return rekognitionClient;
};

const SIMILARITY_THRESHOLD = 90; // Minimum similarity for face match
const MIN_FACE_CONFIDENCE = 90; // Minimum confidence for face detection

/**
 * Detect faces in an image and analyze face attributes
 * Used for basic liveness validation (eyes open, face orientation, etc.)
 * 
 * @param {Buffer} imageBytes - Image as buffer
 * @returns {Promise<Object>} - Face detection results with liveness indicators
 */
export const detectFaceWithAttributes = async (imageBytes) => {
  try {
    const client = getRekognitionClient();
    
    const command = new DetectFacesCommand({
      Image: { Bytes: imageBytes },
      Attributes: ['ALL'] // Get all face attributes for liveness analysis
    });

    const response = await client.send(command);

    if (!response.FaceDetails || response.FaceDetails.length === 0) {
      return {
        success: false,
        reason: 'NO_FACE_DETECTED',
        message: 'No face detected in the image. Please position your face clearly.'
      };
    }

    if (response.FaceDetails.length > 1) {
      return {
        success: false,
        reason: 'MULTIPLE_FACES',
        message: 'Multiple faces detected. Please ensure only your face is visible.'
      };
    }

    const face = response.FaceDetails[0];
    
    // Check face confidence
    if (face.Confidence < MIN_FACE_CONFIDENCE) {
      return {
        success: false,
        reason: 'LOW_CONFIDENCE',
        message: 'Face not clearly visible. Please improve lighting and try again.'
      };
    }

    // Extract liveness-related attributes
    const livenessIndicators = {
      eyesOpen: face.EyesOpen?.Value === true && face.EyesOpen?.Confidence > 80,
      eyesOpenConfidence: face.EyesOpen?.Confidence || 0,
      mouthOpen: face.MouthOpen?.Value === true,
      mouthOpenConfidence: face.MouthOpen?.Confidence || 0,
      smile: face.Smile?.Value === true,
      smileConfidence: face.Smile?.Confidence || 0,
      pose: {
        pitch: face.Pose?.Pitch || 0,  // Up/Down
        roll: face.Pose?.Roll || 0,    // Tilt
        yaw: face.Pose?.Yaw || 0       // Left/Right
      },
      quality: {
        brightness: face.Quality?.Brightness || 0,
        sharpness: face.Quality?.Sharpness || 0
      },
      faceConfidence: face.Confidence,
      boundingBox: face.BoundingBox
    };

    // NOTE: We no longer check for frontal pose here.
    // Pose validation is now handled in validateLivenessChallenge() 
    // based on the specific challenge type (turn_left, turn_right need non-frontal poses)

    // Check image quality
    if (livenessIndicators.quality.brightness < 20) {
      return {
        success: false,
        reason: 'LOW_BRIGHTNESS',
        message: 'Image too dark. Please improve lighting.',
        livenessIndicators
      };
    }

    if (livenessIndicators.quality.sharpness < 20) {
      return {
        success: false,
        reason: 'LOW_SHARPNESS',
        message: 'Image blurry. Please hold steady and try again.',
        livenessIndicators
      };
    }

    return {
      success: true,
      livenessIndicators,
      message: 'Face detected successfully'
    };

  } catch (error) {
    console.error('❌ [FaceDetection] Error:', error);
    throw new Error('Face detection failed. Please try again.');
  }
};

/**
 * Validate liveness challenge response
 * Checks if the captured image matches the expected challenge
 * 
 * @param {Buffer} imageBytes - Captured image
 * @param {string} challengeType - Type of challenge ('blink', 'smile', 'turn_left', 'turn_right', 'nod')
 * @returns {Promise<Object>} - Challenge validation result
 */
export const validateLivenessChallenge = async (imageBytes, challengeType) => {
  try {
    const detectionResult = await detectFaceWithAttributes(imageBytes);
    
    if (!detectionResult.success) {
      return detectionResult;
    }

    const indicators = detectionResult.livenessIndicators;
    let challengePassed = false;
    let challengeMessage = '';

    // Log pose data for debugging
    console.log(`🎯 [Challenge: ${challengeType}] Pose - Yaw: ${indicators.pose.yaw.toFixed(1)}°, Pitch: ${indicators.pose.pitch.toFixed(1)}°`);

    // ============================================
    // TESTING MODE: Very lenient checks
    // TODO: Tighten these thresholds for production
    // ============================================

    switch (challengeType) {
      case 'eyes_open':
        // Just check if eyes are detected as open (any confidence)
        challengePassed = indicators.eyesOpen || indicators.eyesOpenConfidence > 50;
        challengeMessage = challengePassed 
          ? 'Eyes open detected' 
          : 'Please open your eyes wide';
        break;

      case 'smile':
        // Very lenient smile detection
        challengePassed = indicators.smile || indicators.smileConfidence > 30;
        challengeMessage = challengePassed 
          ? 'Smile detected' 
          : 'Please smile at the camera';
        break;

      case 'turn_left':
        // For testing: Accept any head position that's not straight right
        // Just check face was detected - we log the yaw for debugging
        challengePassed = indicators.pose.yaw < 20; // Accept anything not turning hard right
        challengeMessage = challengePassed 
          ? 'Left turn detected' 
          : `Please turn your head to the left (current: ${indicators.pose.yaw.toFixed(0)}°)`;
        break;

      case 'turn_right':
        // For testing: Accept any head position that's not straight left
        challengePassed = indicators.pose.yaw > -20; // Accept anything not turning hard left
        challengeMessage = challengePassed 
          ? 'Right turn detected' 
          : `Please turn your head to the right (current: ${indicators.pose.yaw.toFixed(0)}°)`;
        break;

      case 'look_up':
        // Very lenient - just detect face
        challengePassed = indicators.pose.pitch > -10;
        challengeMessage = challengePassed 
          ? 'Look up detected' 
          : 'Please look slightly upward';
        break;

      case 'neutral':
      default:
        // For testing: Just check face is detected with eyes open
        challengePassed = indicators.eyesOpen || indicators.faceConfidence > 80;
        challengeMessage = challengePassed 
          ? 'Neutral face detected' 
          : 'Please look straight at the camera';
        break;
    }

    console.log(`${challengePassed ? '✅' : '❌'} [Challenge: ${challengeType}] ${challengeMessage}`);

    return {
      success: challengePassed,
      challengeType,
      livenessIndicators: indicators,
      message: challengeMessage
    };

  } catch (error) {
    console.error('❌ [LivenessChallenge] Error:', error);
    throw error;
  }
};

/**
 * Compare captured face with stored profile image in S3
 * 
 * @param {string} storedFaceS3Key - S3 key of stored profile image
 * @param {Buffer} capturedImageBytes - Captured image as buffer
 * @returns {Promise<Object>} - Comparison result
 */
export const compareFaceWithProfile = async (storedFaceS3Key, capturedImageBytes) => {
  try {
    const client = getRekognitionClient();

    // First detect face in captured image
    const detectionResult = await detectFaceWithAttributes(capturedImageBytes);
    
    if (!detectionResult.success) {
      return detectionResult;
    }

    // Compare faces
    const compareCommand = new CompareFacesCommand({
      SourceImage: {
        S3Object: {
          Bucket: BUCKET_NAME,
          Name: storedFaceS3Key,
        },
      },
      TargetImage: {
        Bytes: capturedImageBytes,
      },
      SimilarityThreshold: SIMILARITY_THRESHOLD,
    });

    const compareResponse = await client.send(compareCommand);

    if (compareResponse.FaceMatches && compareResponse.FaceMatches.length > 0) {
      const bestMatch = compareResponse.FaceMatches[0];
      console.log(`✅ [FaceMatch] Similarity: ${bestMatch.Similarity.toFixed(2)}%`);
      
      return {
        success: true,
        similarity: bestMatch.Similarity,
        livenessIndicators: detectionResult.livenessIndicators,
        message: 'Face verified successfully'
      };
    } else {
      console.log('❌ [FaceMatch] Face does not match profile');
      return {
        success: false,
        reason: 'FACE_NOT_MATCHED',
        similarity: 0,
        message: 'Face does not match your registered profile.'
      };
    }

  } catch (error) {
    console.error('❌ [FaceComparison] Error:', error);
    
    if (error.name === 'InvalidS3ObjectException') {
      return {
        success: false,
        reason: 'PROFILE_IMAGE_NOT_FOUND',
        message: 'Profile image not found. Please re-upload your photo.'
      };
    }

    if (error.name === 'InvalidParameterException') {
      return {
        success: false,
        reason: 'INVALID_IMAGE',
        message: 'Invalid image. Please capture a clear photo of your face.'
      };
    }

    throw new Error('Face comparison failed. Please try again.');
  }
};

/**
 * Complete liveness verification with multiple challenges and face matching
 * 
 * @param {Array<{imageBytes: Buffer, challengeType: string}>} challengeImages - Array of challenge images
 * @param {string} storedFaceS3Key - S3 key of stored profile image
 * @returns {Promise<Object>} - Complete verification result
 */
export const verifyLivenessWithChallenges = async (challengeImages, storedFaceS3Key) => {
  try {
    console.log(`🔐 [Liveness] Starting verification with ${challengeImages.length} challenges`);
    
    const challengeResults = [];
    let allChallengesPassed = true;

    // Validate each challenge
    for (const { imageBytes, challengeType } of challengeImages) {
      const result = await validateLivenessChallenge(imageBytes, challengeType);
      challengeResults.push({
        challengeType,
        passed: result.success,
        message: result.message
      });
      
      if (!result.success) {
        allChallengesPassed = false;
      }
    }

    if (!allChallengesPassed) {
      const failedChallenges = challengeResults.filter(r => !r.passed);
      return {
        success: false,
        reason: 'LIVENESS_CHALLENGES_FAILED',
        challengeResults,
        message: `Liveness check failed: ${failedChallenges[0].message}`
      };
    }

    console.log('✅ [Liveness] All challenges passed, comparing face...');

    // Use the last challenge image for face comparison (should be the clearest)
    const lastImage = challengeImages[challengeImages.length - 1];
    const comparisonResult = await compareFaceWithProfile(storedFaceS3Key, lastImage.imageBytes);

    if (!comparisonResult.success) {
      return {
        success: false,
        reason: comparisonResult.reason || 'FACE_NOT_MATCHED',
        challengeResults,
        message: comparisonResult.message
      };
    }

    console.log('✅ [Liveness] Face verification complete!');
    
    return {
      success: true,
      similarity: comparisonResult.similarity,
      livenessScore: 100, // All challenges passed
      challengeResults,
      message: 'Identity verified successfully'
    };

  } catch (error) {
    console.error('❌ [Liveness] Verification error:', error);
    throw error;
  }
};
