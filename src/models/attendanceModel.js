import mongoose from 'mongoose';

const attendanceSchema = new mongoose.Schema({
  /**
   * Reference to the User (Student) this record belongs to.
   */
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  /**
   * Reference to the QRCodeSession this attendance was marked against.
   */
  sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'QRCodeSession', required: false },
  /**
   * Reference to the Class this attendance is for.
   */
  classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true, index: true },
  /**
   * Reference to the specific Schedule (or ScheduleInstance) this attendance is for.
   */
  scheduleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Schedule', required: false },
  /**
   * The latitude and longitude captured from the student's device.
   */
  studentCoordinates: { latitude: Number, longitude: Number },
  /**
   * The exact timestamp the attendance was successfully recorded.
   */
  timestamp: { type: Date, default: Date.now },
  /**
   * Flag indicating if the liveness check (e.g., face match) passed.
   */
  livenessPassed: { type: Boolean, required: true },
  /**
   * Stores the face embedding vector (if used). Kept optional.
   */
  faceEmbedding: { type: [Number], required: false, default: [] },
  /**
   * Flag for data synchronization (e.g., to an external system).
   */
  synced: { type: Boolean, default: false },
  /**
   * Version number for managing sync conflicts.
   */
  syncVersion: { type: Number, default: 1 },
  /**
   * Flag indicating if this record was entered manually (e.g., by a teacher)
   * instead of via the QR code system.
   */
  manualEntry: { type: Boolean, default: false },
  /**
   * Notes field, primarily for manual entries, to add context or reason.
   */
  notes: { type: String, default: '' },
}, { timestamps: true });

/**
 * @model Attendance
 * @description Mongoose model compiled from the attendanceSchema.
 */
export const Attendance = mongoose.model('Attendance', attendanceSchema);