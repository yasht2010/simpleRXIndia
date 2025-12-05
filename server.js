import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import session from 'express-session';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import SQLiteStore from 'connect-sqlite3';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import fs from 'fs';
import * as db from './database.js';
import { generateScribePrompt, generateReviewPrompt, generateFormatPrompt } from './prompts.js';
import crypto from 'crypto';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);
const upload = multer({ dest: 'uploads/' });

if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');

// --- CONFIG CONSTANTS ---
const ADMIN_PASSCODE = process.env.ADMIN_PASSCODE || 'adminpass';
const REGISTRATION_OTP = process.env.REGISTRATION_OTP || '2345';
const DG_MODEL = process.env.TRANSCRIPTION_MODEL || 'nova-2-medical';
const DG_LANGUAGE = process.env.TRANSCRIPTION_LANGUAGE || 'en-IN';
const SCRIBE_MODEL = process.env.SCRIBE_MODEL || 'gemini-2.5-pro';
const REVIEW_MODEL = process.env.REVIEW_MODEL || 'gemini-2.5-pro';
const FORMAT_MODEL = process.env.FORMAT_MODEL || 'gemini-2.5-pro';
const SESSION_SECRET = process.env.SESSION_SECRET || 'change_me_session_secret';

// --- SESSION CONFIG ---
const SQLStore = SQLiteStore(session);
const sessionMiddleware = session({
    store: new SQLStore({ dir: __dirname, db: 'smartrx.db' }),
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { 
        maxAge: 7 * 24 * 60 * 60 * 1000,
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax'
    }
});

app.use(sessionMiddleware);
app.use(express.json());
app.use(helmet({ contentSecurityPolicy: false }));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });
const aiLimiter = rateLimit({ windowMs: 5 * 60 * 1000, max: 30 });

const deepgram = createClient(process.env.DEEPGRAM_API_KEY);
const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

// --- ROUTING FOR HOME/DASHBOARD ---
app.get('/', (req, res) => {
    if (req.session.userId) return res.redirect('/dashboard');
    return res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/dashboard', (req, res) => {
    if (!req.session.userId) return res.redirect('/');
    return res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/register', (req, res) => {
    if (req.session.userId) return res.redirect('/dashboard');
    return res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

app.use(express.static('public'));

// --- 1. SOCKET LOGIC (The Live Stream) ---
const wrap = (middleware) => (socket, next) => middleware(socket.request, socket.request.res || {}, next);
io.use(wrap(sessionMiddleware));

const cleanAI = (text = "") => text.replace(/```(?:html)?/gi, "").replace(/```/g, "").trim();

io.on('connection', (socket) => {
    const userId = socket.request.session.userId;
    if (!userId) { socket.disconnect(); return; }

    console.log(`🔌 Client ${socket.id} connected.`);

    let dgConnection = null;
    let keepAliveInterval = null;

    // A. Setup Deepgram Connection
    const setupDeepgram = async () => {
        try {
            const settings = await db.getSettings(userId);
            const keywords = settings?.custom_keywords 
                ? settings.custom_keywords.split(',').map(k => k.trim() + ":2") 
                : [];

            dgConnection = deepgram.listen.live({
                model: DG_MODEL,
                language: DG_LANGUAGE,
                smart_format: true,
                interim_results: true,
                keywords: keywords,
                encoding: "linear16",
                sample_rate: 16000,
                channels: 1,
                utterance_end_ms: 1200
            });

            // Events
            dgConnection.on(LiveTranscriptionEvents.Open, () => {
                console.log(`🟢 Deepgram Open (${socket.id})`);
                
                // KeepAlive Logic (Prevent 10s timeout during silence)
                keepAliveInterval = setInterval(() => {
                    if (dgConnection && dgConnection.getReadyState() === 1) {
                        dgConnection.keepAlive();
                    }
                }, 8000);
            });

            dgConnection.on(LiveTranscriptionEvents.Transcript, (data) => {
                const transcript = data.channel?.alternatives?.[0]?.transcript;
                if (transcript) {
                    console.log(`🗣️ DG transcript (${socket.id}):`, transcript);
                    socket.emit('transcript-update', { 
                        text: transcript, 
                        isFinal: data.is_final 
                    });
                }
            });

            dgConnection.on(LiveTranscriptionEvents.Error, (err) => console.error("DG Error:", err));
            
            dgConnection.on(LiveTranscriptionEvents.Close, () => {
                console.log(`🔴 Deepgram Closed (${socket.id})`);
                clearInterval(keepAliveInterval);
                dgConnection = null;
            });

        } catch (err) {
            console.error("Setup Error:", err);
        }
    };

    // B. Handle Audio Stream
    let chunkCount = 0;
    socket.on('audio-stream', async (data) => {
        // Initialize on first chunk
        if (!dgConnection) {
            await setupDeepgram();
        }

        // Ensure Deepgram is ready and send as a Buffer
        if (dgConnection && dgConnection.getReadyState() === 1) {
            let payload = data;
            // Support object payload { type, data }
            if (data && data.data) payload = data.data;

            let audioBuffer = null;
            if (Buffer.isBuffer(payload)) audioBuffer = payload;
            else if (payload instanceof ArrayBuffer) audioBuffer = Buffer.from(payload);
            else if (ArrayBuffer.isView(payload)) audioBuffer = Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength);
            
            if (audioBuffer && audioBuffer.length) {
                if (chunkCount < 3) {
                    console.log(`🎙️ Audio chunk ${chunkCount + 1}: ${audioBuffer.length} bytes`);
                }
                chunkCount += 1;
                dgConnection.send(audioBuffer);
            }
        }
    });

    // C. Finalize & Format
    socket.on('finalize-prescription', async ({ fullTranscript, context }) => {
        // Close connection immediately to save costs
        if (dgConnection) {
            dgConnection.finish();
            dgConnection = null;
        }
        clearInterval(keepAliveInterval);

        console.log(`📝 Finalizing... Text Length: ${fullTranscript?.length}`);

        // If empty, trigger backup
        if (!fullTranscript || fullTranscript.trim().length < 2) {
            socket.emit('use-backup-upload', {}); 
            return;
        }

        // Deduct Credit
        const hasBalance = await db.deductCredit(userId);
        if (!hasBalance) {
            socket.emit('prescription-result', { success: false, error: "Low Balance." });
            return;
        }

        // Gemini Processing
        try {
            const macros = await db.getMacros(userId);
            const model = genAI.getGenerativeModel({ model: SCRIBE_MODEL });
            const prompt = generateScribePrompt(fullTranscript, context, macros);
            const result = await model.generateContent(prompt);
            const newCredits = await db.getCredits(userId);
            
            socket.emit('prescription-result', { 
                success: true, 
                html: cleanAI(result.response.text()), 
                credits: newCredits 
            });
        } catch (e) {
            console.error("AI Error:", e);
            socket.emit('prescription-result', { success: false, error: "AI Processing Failed" });
        }
    });

    socket.on('disconnect', () => {
        if (dgConnection) dgConnection.finish();
        clearInterval(keepAliveInterval);
    });
});

// --- 2. REST APIs (Settings/Auth) ---
// (These remain exactly the same as your previous working version)

app.post('/api/login', authLimiter, async (req, res) => {
    const user = await db.getUser(req.body.phone);
    if (user && bcrypt.compareSync(req.body.password, user.password)) {
        req.session.userId = user.id; res.json({ success: true });
    } else res.json({ success: false, message: "Invalid" });
});
app.post('/api/logout', (req, res) => {
    req.session.userId = null;
    req.session.isAdmin = false;
    req.session.destroy(() => {
        res.clearCookie('connect.sid');
        res.json({ success: true });
    });
});
app.post('/api/register', authLimiter, async (req, res) => {
    try { await db.createUser(req.body.phone, req.body.password); res.json({ success: true }); } 
    catch (e) { res.json({ success: false, message: "Exists" }); }
});

// Registration with OTP (static for now)
app.post('/api/register/send-otp', authLimiter, async (req, res) => {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: "Phone required" });
    const existing = await db.getUser(phone);
    if (existing) return res.status(400).json({ error: "User exists" });
    req.session.pendingPhone = phone;
    res.json({ success: true });
});

app.post('/api/register/verify-otp', authLimiter, (req, res) => {
    const { phone, otp } = req.body;
    if (!phone || !otp) return res.status(400).json({ error: "Missing fields" });
    if (phone !== req.session.pendingPhone) return res.status(400).json({ error: "Phone mismatch" });
    if (otp !== REGISTRATION_OTP) return res.status(400).json({ error: "Invalid OTP" });
    req.session.verifiedPhone = phone;
    res.json({ success: true });
});

app.post('/api/register/complete', authLimiter, async (req, res) => {
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
});
app.get('/api/me', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: "Unauthorized" });
    const user = await db.getUserById(req.session.userId);
    if (!user) { req.session.destroy(); return res.status(401).json({ error: "User not found" }); }
    const credits = await db.getCredits(req.session.userId);
    res.json({ phone: user.phone, credits: credits, header_html: user.header_html });
});
app.post('/api/header', async (req, res) => { await db.updateHeader(req.session.userId, req.body.html); res.json({ success: true }); });
app.get('/api/macros', async (req, res) => { if (!req.session.userId) return res.json([]); res.json(await db.getMacros(req.session.userId)); });
app.post('/api/macros', async (req, res) => { await db.saveMacro(req.session.userId, req.body.trigger, req.body.expansion); res.json({ success: true }); });
app.post('/api/macros/delete', async (req, res) => { 
    if (!req.session.userId) return res.status(401).json({ error: "Unauthorized" });
    await db.deleteMacro(req.session.userId, req.body.trigger);
    res.json({ success: true }); 
});

// --- REVIEW ENDPOINT ---
app.post('/api/review', aiLimiter, async (req, res) => {
    try {
        const { html } = req.body;
        if (!req.session.userId) return res.status(401).json({ error: "Unauthorized" });
        if (!html) return res.status(400).json({ error: "Missing html" });
        const model = genAI.getGenerativeModel({ model: REVIEW_MODEL });
        const prompt = generateReviewPrompt(html);
        const result = await model.generateContent(prompt);
        res.json({ success: true, reviewed: cleanAI(result.response.text()) });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/format', aiLimiter, async (req, res) => {
    try {
        const { html } = req.body;
        if (!req.session.userId) return res.status(401).json({ error: "Unauthorized" });
        if (!html) return res.status(400).json({ error: "Missing html" });
        const model = genAI.getGenerativeModel({ model: FORMAT_MODEL });
        const prompt = generateFormatPrompt(html);
        const result = await model.generateContent(prompt);
        res.json({ success: true, formatted: cleanAI(result.response.text()) });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
app.get('/settings', async (req, res) => { if (!req.session.userId) return res.status(401).json({}); res.json(await db.getSettings(req.session.userId) || {}); });
app.post('/settings', async (req, res) => { if (!req.session.userId) return res.status(401).json({}); await db.saveSettings(req.session.userId, req.body); res.json({ success: true }); });

// --- ADMIN ROUTES ---
const requireAdmin = (req, res, next) => {
    if (req.session.isAdmin) return next();
    return res.status(401).json({ error: 'Unauthorized' });
};

app.post('/api/admin/login', (req, res) => {
    const { passcode } = req.body;
    if (passcode && passcode === ADMIN_PASSCODE) {
        req.session.isAdmin = true;
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false, error: 'Invalid passcode' });
    }
});

app.post('/api/admin/logout', (req, res) => {
    req.session.isAdmin = false;
    res.json({ success: true });
});

app.get('/api/admin/users', requireAdmin, async (req, res) => {
    const users = await db.listUsers();
    res.json(users.map(u => ({
        id: u.id,
        phone: u.phone,
        doctor_name: u.doctor_name,
        qualification: u.qualification,
        clinic_details: u.clinic_details,
        credits: u.credits // represent prescriptions count
    })));
});

app.post('/api/admin/credits', requireAdmin, async (req, res) => {
    const { userId, amount } = req.body;
    if (!userId || !amount) return res.status(400).json({ error: 'Missing params' });
    await db.addCredits(userId, Number(amount));
    res.json({ success: true });
});

app.post('/api/admin/remove-user', requireAdmin, async (req, res) => {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'Missing userId' });
    await db.removeUser(userId);
    res.json({ success: true });
});

// --- 3. BACKUP UPLOAD ENDPOINT ---
app.post('/api/process-backup', upload.single('audio'), async (req, res) => {
    try {
        if (!req.session.userId) return res.status(401).json({ error: "Unauthorized" });
        if (!req.file) throw new Error("No audio file.");

        await db.deductCredit(req.session.userId);

        const { result, error } = await deepgram.listen.prerecorded.transcribeFile(
            fs.readFileSync(req.file.path),
            { model: DG_MODEL, smart_format: true, language: DG_LANGUAGE, mimetype: 'audio/webm' }
        );
        if (error) throw error;
        
        const transcript = result.results.channels[0].alternatives[0].transcript;
        const macros = await db.getMacros(req.session.userId);
        const model = genAI.getGenerativeModel({ model: SCRIBE_MODEL });
        const prompt = generateScribePrompt(transcript, req.body.context || "", macros);
        const aiRes = await model.generateContent(prompt);
        
        fs.unlinkSync(req.file.path);
        const newCredits = await db.getCredits(req.session.userId);
        res.json({ success: true, html: cleanAI(aiRes.response.text()), credits: newCredits });

    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

const PORT = 3000;
httpServer.listen(PORT, () => console.log(`\n🚀 Clinova Rx running on port ${PORT}\n`));
