import express from 'express';
import * as adminController from '../controllers/admin.controller.js';

const router = express.Router();

const requireAdmin = (req, res, next) => {
    if (req.session.isAdmin) return next();
    return res.status(401).json({ error: 'Unauthorized' });
};

router.post('/login', adminController.login);
router.post('/logout', adminController.logout);

router.get('/users', requireAdmin, adminController.listUsers);
router.post('/credits', requireAdmin, adminController.addCredits);
router.post('/remove-user', requireAdmin, adminController.removeUser);
router.get('/providers', requireAdmin, adminController.getProviders);
router.post('/providers', requireAdmin, adminController.saveProviders);

export default router;
