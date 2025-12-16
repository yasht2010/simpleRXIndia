import express from 'express';
import * as uploadController from '../controllers/upload.controller.js';
import rateLimit from 'express-rate-limit';

const router = express.Router();
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

router.post('/upload-url', authLimiter, uploadController.getUploadUrl);

export default router;
