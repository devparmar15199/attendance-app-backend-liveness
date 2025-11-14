import jwt from 'jsonwebtoken';
import { User } from '../models/userModel.js'; // Assuming User model is imported correctly

/**
 * Middleware to protect routes by verifying a JWT.
 * It checks for a 'Bearer' token in the 'Authorization' header.
 * If valid, it decodes the token, finds the corresponding user,
 * and attaches the user object (minus password) to `req.user`.
 *
 * @param {object} req - Express request object.
 * @param {object} res - Express response object.
 * @param {function} next - Express next middleware function.
 */
export const protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      // Get token from header (e.g., "Bearer <token>")
      token = req.headers.authorization.split(' ')[1];

      // Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret');

      // Get user from the token payload (decoded.id)
      // Attach user to the request object for subsequent middleware/controllers
      req.user = await User.findById(decoded.id).select('-password');

      if (!req.user) {
        // User not found, even with a valid token (e.g., user deleted)
        return res.status(401).json({ message: 'User not found' });
      }

      next(); // Proceed to the next middleware or route handler
    } catch (error) {
      console.error(error);
      res.status(401).json({ message: 'Not authorized, token failed' });
    }
  }

  if (!token) {
    res.status(401).json({ message: 'Not authorized, no token' });
  }
};

/**
 * Middleware to restrict access to admin users only.
 * This middleware *must* be used *after* the `protect` middleware,
 * as it relies on `req.user` being populated.
 *
 * @param {object} req - Express request object (must contain req.user).
 * @param {object} res - Express response object.
 * @param {function} next - Express next middleware function.
 */
export const admin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next(); // User is an admin, proceed
  } else {
    res.status(401).json({ message: 'Not authorized as an admin' });
  }
};

/**
 * Middleware to restrict access to teachers or admins.
 * This middleware *must* be used *after* the `protect` middleware,
 * as it relies on `req.user` being populated.
 *
 * @param {object} req - Express request object (must contain req.user).
 * @param {object} res - Express response object.
 * @param {function} next - Express next middleware function.
 */
export const teacher = (req, res, next) => {
  if (req.user && (req.user.role === 'teacher' || req.user.role === 'admin')) {
    next(); // User is a teacher or admin, proceed
  } else {
    res.status(401).json({ message: 'Not authorized as a teacher' });
  }
};