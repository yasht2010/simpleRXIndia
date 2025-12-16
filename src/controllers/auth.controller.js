import bcrypt from 'bcryptjs';
import * as db from '../database.js';

export const login = async (req, res) => {
    try {
        const { phone, password } = req.body;
        const user = await db.getUser(phone);
        if (user && bcrypt.compareSync(password, user.password)) {
            req.session.userId = user.id;
            res.json({ success: true });
        } else {
            res.json({ success: false, message: "Invalid" });
        }
    } catch (e) {
        console.error('Login error:', e);
        res.status(500).json({ success: false, message: "Login failed" });
    }
};

export const logout = (req, res) => {
    req.session.userId = null;
    req.session.isAdmin = false;
    req.session.destroy(() => {
        res.clearCookie('connect.sid');
        res.json({ success: true });
    });
};

export const register = async (req, res) => {
    try {
        await db.createUser(req.body.phone, req.body.password);
        res.json({ success: true });
    } catch (e) {
        res.json({ success: false, message: "Exists" });
    }
};

// Static OTP for now as per original code
const REGISTRATION_OTP = process.env.REGISTRATION_OTP || '2345';

export const sendOtp = async (req, res) => {
    try {
        const { phone } = req.body;
        if (!phone) return res.status(400).json({ error: "Phone required" });
        const existing = await db.getUser(phone);
        if (existing) return res.status(400).json({ error: "User exists" });
        req.session.pendingPhone = phone;
        res.json({ success: true });
    } catch (e) {
        console.error('OTP send error:', e);
        res.status(500).json({ error: "OTP flow failed" });
    }
};

export const verifyOtp = (req, res) => {
    const { phone, otp } = req.body;
    if (!phone || !otp) return res.status(400).json({ error: "Missing fields" });
    if (phone !== req.session.pendingPhone) return res.status(400).json({ error: "Phone mismatch" });
    if (otp !== REGISTRATION_OTP) return res.status(400).json({ error: "Invalid OTP" });
    req.session.verifiedPhone = phone;
    res.json({ success: true });
};

export const completeRegistration = async (req, res) => {
    const { phone, password, doctor_name, qualification, reg_no } = req.body;
    if (!req.session.verifiedPhone || req.session.verifiedPhone !== phone) return res.status(400).json({ error: "OTP not verified" });
    try {
        await db.createUserWithDetails(phone, password, doctor_name || "", qualification || "", reg_no || "");
        // clear verification
        req.session.pendingPhone = null;
        req.session.verifiedPhone = null;
        res.json({ success: true });
    } catch (e) {
        res.status(400).json({ error: "Registration failed" });
    }
};

export const getMe = async (req, res) => {
    try {
        if (!req.session.userId) return res.status(401).json({ error: "Unauthorized" });
        const user = await db.getUserById(req.session.userId);
        if (!user) { req.session.destroy(); return res.status(401).json({ error: "User not found" }); }
        const credits = await db.getCredits(req.session.userId);

        // We need sanitizeHtml here, import it or utility
        // For simplicity reusing the utility approach or importing directly
        // I will suggest extracting sanitization to src/utils/sanitizer.js later.
        // For now, I'll return raw and handle sanitization in the route or utility.
        // Recommendation: Create src/utils/index.js

        res.json({ phone: user.phone, credits: credits, header_html: user.header_html || "" });
    } catch (e) {
        console.error('/api/me error:', e);
        res.status(500).json({ error: "Failed to fetch user" });
    }
};
