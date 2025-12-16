import express from 'express';
import * as scribeController from '../controllers/scribe.controller.js';
import rateLimit from 'express-rate-limit';

const router = express.Router();
const aiLimiter = rateLimit({ windowMs: 5 * 60 * 1000, max: 30 });

router.post('/review', aiLimiter, scribeController.review);
router.post('/format', aiLimiter, scribeController.format);

export default router;
