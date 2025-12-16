import express from 'express';
import * as settingsController from '../controllers/settings.controller.js';

const router = express.Router();

// Root paths
router.get('/settings', settingsController.getSettings);
router.post('/settings', settingsController.saveSettings);

// API paths (mounted at root, so include /api)
router.post('/api/header', settingsController.updateHeader);
router.get('/api/macros', settingsController.getMacros);
router.post('/api/macros', settingsController.saveMacro);
router.post('/api/macros/delete', settingsController.deleteMacro);

export default router;
