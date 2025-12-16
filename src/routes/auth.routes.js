import express from 'express';
import * as authController from '../controllers/auth.controller.js';
import rateLimit from 'express-rate-limit';

const router = express.Router();
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

router.post('/login', authLimiter, authController.login);
router.post('/logout', authController.logout);
router.post('/register', authLimiter, authController.register);
router.post('/register/send-otp', authLimiter, authController.sendOtp);
router.post('/register/verify-otp', authLimiter, authController.verifyOtp);
router.post('/register/complete', authLimiter, authController.completeRegistration);
router.get('/me', authController.getMe);

export default router;
