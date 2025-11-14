import { RekognitionClient, CompareFacesCommand } from '@aws-sdk/client-rekognition';

const rekognitionClient = new RekognitionClient({
  region: process.env.AWS_REGION,
});

const S3_BUCKET_NAME = 'qr-attendance-student-faces-18102025';

const SIMILARITY_THRESHOLD = 98; // Faces must be at least 98% similar to be a match

/**
 * Compares a face from an image buffer against a reference image stored in S3.
 *
 * @param {string} sourceImageS3Key - The S3 key (path) to the student's registered face image (the source).
 * @param {Buffer} targetImageBytes - The newly captured face image from the mobile app (the target) as a Buffer.
 * @returns {Promise<boolean>} - Resolves to true if faces match with similarity >= SIMILARITY_THRESHOLD.
 * @throws {Error} If the Rekognition API call fails or a face cannot be verified.
 */
export const compareFaces = async (sourceImageS3Key, targetImageBytes) => {
  try {
    const command = new CompareFacesCommand({
      SourceImage: {
        S3Object: {
          Bucket: S3_BUCKET_NAME,
          Name: sourceImageS3Key,
        },
      },
      TargetImage: {
        Bytes: targetImageBytes,
      },
      SimilarityThreshold: SIMILARITY_THRESHOLD,
    });

    const response = await rekognitionClient.send(command);

    // Check if any face matches were returned and if the top match meets the threshold
    if (response.FaceMatches && response.FaceMatches.length > 0) {
      const bestMatch = response.FaceMatches[0];
      console.log(`Face match successful. Similarity: ${bestMatch.Similarity?.toFixed(2)}%`);
      // Double-check the similarity, although the API should only return matches >= threshold
      return bestMatch.Similarity >= SIMILARITY_THRESHOLD;
    }

    console.log('Face match failed: No matching faces found above the similarity threshold.');
    return false;

  } catch (error) {
    console.error('AWS Rekognition error:', error);
    // For security, any error during face comparison is treated as a failed match.
    // This prevents failing "open" (i.e., marking attendance on an error).
    throw new Error('Face could not be verified. Please ensure your face is clear and centered.');
  }
};