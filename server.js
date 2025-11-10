import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import connectDB from './src/config/db.js';

// Import student routes
import studentAuthRoutes from './src/student-app/routes/authRoutes.js';
import studentUserRoutes from './src/student-app/routes/userRoutes.js';
import studentClassRoutes from './src/student-app/routes/classRoutes.js';
import studentAttendanceRoutes from './src/student-app/routes/attendanceRoutes.js';
import studentQRRoutes from './src/student-app/routes/qrRoutes.js';
import studentScheduleRoutes from './src/student-app/routes/scheduleRoutes.js';

// Import teacher routes
import teacherAuthRoutes from './src/teacher-website/routes/authRoutes.js';
import teacherClassRoutes from './src/teacher-website/routes/classRoutes.js';
import teacherRecurringScheduleRoutes from './src/teacher-website/routes/recurringScheduleRoutes.js';
import teacherScheduleRoutes from './src/teacher-website/routes/scheduleRoutes.js';
import teacherTimeSlotRoutes from './src/teacher-website/routes/timeSlotRoutes.js';
import teacherRoomRoutes from './src/teacher-website/routes/roomRoutes.js';
import teacherAttendanceRoutes from './src/teacher-website/routes/attendanceRoute.js';

// Import admin routes
import adminRoutes from './src/teacher-website/routes/adminRoutes.js';

// Load environment variables
dotenv.config();

// Connect to Database
connectDB();

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// API Home Route
app.get('/', (req, res) => {
  res.send('Attendance API is up and running...🚀');
});

// Student App Routes
app.use('/api/student/auth', studentAuthRoutes);
app.use('/api/student/users', studentUserRoutes);
app.use('/api/student/classes', studentClassRoutes);
app.use('/api/student/attendance', studentAttendanceRoutes);
app.use('/api/student/qr', studentQRRoutes);
app.use('/api/student/schedules', studentScheduleRoutes);

// Teacher Website Routes
app.use('/api/teacher/auth', teacherAuthRoutes);
app.use('/api/teacher/classes', teacherClassRoutes);
app.use('/api/teacher/recurring-schedules', teacherRecurringScheduleRoutes);
app.use('/api/teacher/schedules', teacherScheduleRoutes);
app.use('/api/teacher/timeslots', teacherTimeSlotRoutes);
app.use('/api/teacher/rooms', teacherRoomRoutes);
app.use('/api/teacher/attendance', teacherAttendanceRoutes);

// Admin Routes
app.use('/api/admin', adminRoutes);

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});