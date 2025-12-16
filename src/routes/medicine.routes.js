import express from 'express';
import * as medicineController from '../controllers/medicine.controller.js';

const router = express.Router();

router.get('/medicine-suggest', medicineController.suggest);
router.get('/medicine-validate', medicineController.validate);

export default router;
