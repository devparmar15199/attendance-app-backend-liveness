import { RekognitionClient, IndexFacesCommand } from '@aws-sdk/client-rekognition';
import crypto from 'crypto';

const rekognitionClient = new RekognitionClient({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

/**
 * Create face embedding by indexing the face in an AWS Rekognition collection.
 * This detects a face, extracts its features, and stores it in the specified
 * collection, returning a unique FaceId.
 *
 * @param {Buffer} imageBuffer - The image buffer containing the face.
 * @returns {Promise<Object>} An object containing the FaceId and other metadata.
 * @throws {Error} If no face is detected or the API call fails.
 * @throws {Error} If the specified Rekognition collection is not found.
 */
const createFaceEmbedding = async (imageBuffer) => {
    try {
        const command = new IndexFacesCommand({
            // The CollectionId must be created in your AWS Rekognition console first.
            CollectionId: 'student-faces-collection',
            Image: {
                Bytes: imageBuffer
            },
            DetectionAttributes: ['ALL'], // Get all details (landmarks, pose, quality)
            MaxFaces: 1, // We only want to index the single best face
            QualityFilter: 'AUTO' // Let Rekognition filter out low-quality images
        });

        const response = await rekognitionClient.send(command);

        if (response.FaceRecords && response.FaceRecords.length > 0) {
            const faceRecord = response.FaceRecords[0];
            // Return the detailed record of the indexed face
            return {
                faceId: faceRecord.Face.FaceId,  // The unique ID for this face in the collection
                boundingBox: faceRecord.Face.BoundingBox,
                confidence: faceRecord.Face.Confidence,
                landmarks: faceRecord.FaceDetail.Landmarks,
                pose: faceRecord.FaceDetail.Pose,
                quality: faceRecord.FaceDetail.Quality
            };
        } else {
            throw new Error('No face detected in the image');
        }
    } catch (error) {
        console.error('Error creating face embedding:', error);
        if (error.name === 'ResourceNotFoundException') {
            // This is a common configuration error.
            throw new Error('Face collection not found. Please contact administrator.');
        }
        throw new Error(`Failed to create face embedding: ${error.message}`);
    }
};

/**
 * Create a simple, hash-based face embedding array (fallback method).
 * NOTE: This is NOT a real biometric embedding and should not be used for
 * actual face comparison. It serves as a placeholder.
 *
 * @param {Buffer} imageBuffer - The image buffer.
 * @returns {Promise<Array<number>>} A simple embedding array (normalized hash).
 * @throws {Error} If hashing fails.
 */
const createSimpleFaceEmbedding = async (imageBuffer) => {
    try {
        // For now, create a simple hash-based embedding as fallback
        // In production, you'd want to use a proper face recognition library
        const hash = crypto.createHash('sha256').update(imageBuffer).digest('hex');

        // Convert hash to array of numbers (simple embedding)
        const embedding = [];
        for (let i = 0; i < hash.length; i += 2) {
            const hexPair = hash.substr(i, 2);
            embedding.push(parseInt(hexPair, 16) / 255); // Normalize to 0-1
        }

        return embedding.slice(0, 128); // Return first 128 values as embedding
    } catch (error) {
        console.error('Error creating simple face embedding:', error);
        throw new Error(`Failed to create face embedding: ${error.message}`);
    }
};

export {
    createFaceEmbedding,
    createSimpleFaceEmbedding
};