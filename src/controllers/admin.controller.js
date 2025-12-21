import * as db from '../database.js';
import { getTranscriptionConfig, getLlmConfig } from '../services/providerConfig.js';
import dotenv from 'dotenv';
dotenv.config();

const ADMIN_PASSCODE = process.env.ADMIN_PASSCODE || 'adminpass';

export const login = (req, res) => {
    const { passcode } = req.body;
    if (passcode && passcode === ADMIN_PASSCODE) {
        req.session.isAdmin = true;
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false, error: 'Invalid passcode' });
    }
};

export const logout = (req, res) => {
    req.session.isAdmin = false;
    res.json({ success: true });
};

export const listUsers = async (req, res) => {
    try {
        const users = await db.listUsers();
        res.json(users.map(u => ({
            id: u.id,
            phone: u.phone,
            doctor_name: u.doctor_name,
            qualification: u.qualification,
            clinic_details: u.clinic_details,
            credits: u.credits // represent prescriptions count
        })));
    } catch (e) {
        console.error('Admin list users error:', e);
        res.status(500).json({ error: 'Failed to load users' });
    }
};

export const addCredits = async (req, res) => {
    try {
        const { userId, amount } = req.body;
        if (!userId || !amount) return res.status(400).json({ error: 'Missing params' });
        await db.addCredits(userId, Number(amount));
        res.json({ success: true });
    } catch (e) {
        console.error('Admin add credits error:', e);
        res.status(500).json({ error: 'Failed to update credits' });
    }
};

export const removeUser = async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ error: 'Missing userId' });
        await db.removeUser(userId);
        res.json({ success: true });
    } catch (e) {
        console.error('Admin remove user error:', e);
        res.status(500).json({ error: 'Failed to remove user' });
    }
};

export const getProviders = async (_req, res) => {
    try {
        // const stored = await db.getProviderSettings(); 
        // Logic from server_original.js just calls getProviderSettings then constructs response
        // But getProviderSettings was called at startup to set the in-memory config
        // Here we can read current in-memory config via the helper getters

        const resolved = {
            liveTranscription: getTranscriptionConfig('live'),
            offlineTranscription: getTranscriptionConfig('offline'),
            scribe: getLlmConfig('scribe'),
            format: getLlmConfig('format'),
            review: getLlmConfig('review')
        };
        res.json(resolved);
    } catch (e) {
        console.error('Admin providers error:', e);
        res.status(500).json({ error: 'Failed to fetch provider settings' });
    }
};

export const saveProviders = async (req, res) => {
    try {
        const settings = req.body;
        // 1. Save to DB
        await db.saveProviderSettings(settings);

        // 2. Update in-memory config
        // Only if we move setProviderOverrides to an accessible import or ensure app.js reloads it?
        // Actually, we imported setProviderOverrides in app.js. 
        // We should probably expose it here or handle it.
        // Let's import it here.
        const { setProviderOverrides } = await import('../services/providerConfig.js');
        setProviderOverrides(settings);

        res.json({ success: true });
    } catch (e) {
        console.error('Admin save providers error:', e);
        res.status(500).json({ error: 'Failed to save provider settings' });
    }
};
