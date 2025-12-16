import express from 'express';
import * as processController from '../controllers/process.controller.js';
import rateLimit from 'express-rate-limit';
import multer from 'multer';

// Multer setup
const upload = multer({ dest: 'uploads_tmp/' });

const router = express.Router();
const aiLimiter = rateLimit({ windowMs: 5 * 60 * 1000, max: 20 });

router.post('/process-s3', aiLimiter, processController.processS3);
router.post('/process-backup', aiLimiter, upload.single('audio'), processController.processBackup);

export default router;
