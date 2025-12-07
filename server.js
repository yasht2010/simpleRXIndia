import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import session from 'express-session';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import pgSession from 'connect-pg-simple';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import fs from 'fs';
import * as db from './database.js';
import { generateScribePrompt, generateReviewPrompt, generateFormatPrompt } from './prompts.js';
import { formatResponseSchema } from './schemas/formatSchema.js';
import crypto from 'crypto';
import sanitizeHtml from 'sanitize-html';
import OpenAI from 'openai';
import { toFile } from 'openai/uploads';
import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';
import { getLlmConfig, getTranscriptionConfig, setProviderOverrides } from './services/providerConfig.js';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');
if (!fs.existsSync('logs')) fs.mkdirSync('logs');
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname || '');
        cb(null, `${Date.now()}-${Math.random().toString(16).slice(2)}${ext || '.webm'}`);
    }
});
const upload = multer({
    storage,
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const isAudio = file.mimetype && file.mimetype.startsWith('audio/');
        const isWebmVideo = file.mimetype === 'video/webm';
        if (isAudio || isWebmVideo) cb(null, true);
        else cb(new Error('Invalid file type'), false);
    }
});

// --- CONFIG CONSTANTS ---
const ADMIN_PASSCODE = process.env.ADMIN_PASSCODE || 'adminpass';
const REGISTRATION_OTP = process.env.REGISTRATION_OTP || '2345';
let LIVE_TRANSCRIPTION = getTranscriptionConfig('live');
let OFFLINE_TRANSCRIPTION = getTranscriptionConfig('offline');
const SESSION_SECRET = process.env.SESSION_SECRET || 'change_me_session_secret';
const S3_REGION = process.env.AWS_REGION;
const S3_BUCKET = process.env.S3_BUCKET;
const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;
const S3_CLEANUP_MAX_AGE_HOURS = Number(process.env.S3_CLEANUP_MAX_AGE_HOURS || 24);
const audioExtForContentType = (ct = '') => {
    const lower = ct.toLowerCase();
    if (lower.includes('wav')) return '.wav';
    if (lower.includes('mpeg')) return '.mp3';
    if (lower.includes('mp4') || lower.includes('m4a')) return '.m4a';
    if (lower.includes('ogg')) return '.ogg';
    if (lower.includes('webm')) return '.webm';
    return '.webm';
};
const mimeForKey = (key = '') => {
    const lower = key.toLowerCase();
    if (lower.endsWith('.wav')) return 'audio/wav';
    if (lower.endsWith('.mp3')) return 'audio/mpeg';
    if (lower.endsWith('.m4a')) return 'audio/mp4';
    if (lower.endsWith('.ogg')) return 'audio/ogg';
    return 'audio/webm';
};

const groqTranscribe = async (buffer, filename, model) => {
    const groqKey = process.env.GROQ_API_KEY;
    if (!groqKey) throw new Error("GROQ_API_KEY missing");
    const form = new FormData();
    form.append('file', new Blob([buffer]), filename);
    form.append('model', model);
    form.append('response_format', 'text');
    const resp = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${groqKey}` },
        body: form
    });
    if (!resp.ok) throw new Error(`Groq transcription error ${resp.status}`);
    return resp.text();
};

// --- SESSION CONFIG ---
if (!SUPABASE_DB_URL) throw new Error('SUPABASE_DB_URL env missing for session storage');
const { Pool } = pg;
const pgPool = new Pool({
    connectionString: SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false }
});
pgPool.on('error', (err) => console.error('Postgres pool error:', err));
const PGStore = pgSession(session);

const sessionMiddleware = session({
    store: new PGStore({
        pool: pgPool,
        tableName: 'session',
        createTableIfMissing: true
    }),
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
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const s3 = new S3Client({
    region: S3_REGION,
    credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY ? {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    } : undefined
});
const sanitizeContent = (html = "") => sanitizeHtml(html, {
    allowedTags: ['h1','h2','h3','h4','p','b','strong','i','em','u','ul','ol','li','table','thead','tbody','tr','th','td','hr','br','span','div'],
    allowedAttributes: {
        '*': ['colspan','rowspan','class','style']
    },
    allowedSchemes: ['http','https','mailto'],
    disallowedTagsMode: 'discard'
});

const applyProviderOverrides = (overrides = {}) => {
    setProviderOverrides(overrides);
    LIVE_TRANSCRIPTION = getTranscriptionConfig('live');
    OFFLINE_TRANSCRIPTION = getTranscriptionConfig('offline');
};

(async () => {
    try {
        const stored = await db.getProviderSettings();
        applyProviderOverrides(stored);
        console.log("✅ Provider overrides loaded", stored);
    } catch (err) {
        console.error("Provider override load failed:", err?.message || err);
    }
})();

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
const streamToBuffer = async (stream) => {
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks);
};
const appendFormatLog = (line) => {
    const entry = `[${new Date().toISOString()}] ${line}\n`;
    fs.appendFile('logs/format.log', entry, (err) => {
        if (err) console.error('format log write error:', err);
    });
};

const runLlmTask = async (task, prompt, { responseSchema, forceJson = false } = {}) => {
    const { provider, model } = getLlmConfig(task);
    const lowerProvider = provider.toLowerCase();

    if (lowerProvider === 'gemini') {
        if (!genAI) throw new Error("Gemini not configured");
        const llm = genAI.getGenerativeModel({ model });
        try {
            const res = responseSchema
                ? await llm.generateContent({
                    contents: [{ role: 'user', parts: [{ text: prompt }]}],
                    generationConfig: {
                        responseMimeType: 'application/json',
                        responseSchema
                    }
                })
                : await llm.generateContent(prompt);
            return { raw: res.response.text(), provider: lowerProvider, model };
        } catch (err) {
            const msg = err?.message || "";
            const schemaUnsupported = msg.includes('responseMimeType') || msg.includes('responseSchema');
            if (responseSchema && schemaUnsupported) {
                console.warn(`Gemini schema not supported for model ${model}, retrying without schema`);
                const res = await llm.generateContent(prompt);
                return { raw: res.response.text(), provider: lowerProvider, model };
            }
            throw err;
        }
    }

    if (lowerProvider === 'openai') {
        if (!openai) throw new Error("OpenAI not configured");
        const messages = [];
        if (responseSchema || forceJson) {
            messages.push({ role: 'system', content: 'Respond with a single JSON object only. Do not include any text before or after the JSON.' });
        }
        messages.push({ role: 'user', content: prompt });
        const completion = await openai.chat.completions.create({
            model,
            messages,
            response_format: (responseSchema || forceJson) ? { type: 'json_object' } : undefined
        });
        return { raw: completion.choices?.[0]?.message?.content || "", provider: lowerProvider, model };
    }

    if (lowerProvider === 'groq') {
        const groqKey = process.env.GROQ_API_KEY;
        if (!groqKey) throw new Error("GROQ_API_KEY missing");
        const payload = {
            model,
            messages: (responseSchema || forceJson)
                ? [
                    { role: 'system', content: 'Respond with a single JSON object only. Do not include any text before or after the JSON.' },
                    { role: 'user', content: prompt }
                ]
                : [{ role: 'user', content: prompt }],
            response_format: (responseSchema || forceJson) ? { type: 'json_object' } : undefined
        };
        const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${groqKey}`
            },
            body: JSON.stringify(payload)
        });
        if (!resp.ok) throw new Error(`Groq error ${resp.status}`);
        const data = await resp.json();
        return { raw: data.choices?.[0]?.message?.content || "", provider: lowerProvider, model };
    }

    throw new Error(`Unsupported provider for ${task}: ${provider}`);
};
const scheduleS3Cleanup = () => {
    if (!S3_BUCKET || !S3_REGION || !S3_CLEANUP_MAX_AGE_HOURS) return;
    const intervalMs = 3 * 60 * 60 * 1000; // every 3 hours
    const run = async () => {
        const cutoff = Date.now() - S3_CLEANUP_MAX_AGE_HOURS * 60 * 60 * 1000;
        let deleted = 0;
        let checked = 0;
        let token;
        try {
            do {
                const resp = await s3.send(new ListObjectsV2Command({
                    Bucket: S3_BUCKET,
                    Prefix: 'uploads/',
                    ContinuationToken: token
                }));
                const objs = resp.Contents || [];
                const stale = objs
                    .filter(o => o.LastModified && o.LastModified.getTime() < cutoff)
                    .map(o => ({ Key: o.Key }));
                checked += objs.length;
                token = resp.IsTruncated ? resp.NextContinuationToken : undefined;
                if (stale.length) {
                    const del = await s3.send(new DeleteObjectsCommand({
                        Bucket: S3_BUCKET,
                        Delete: { Objects: stale, Quiet: true }
                    }));
                    deleted += del?.Deleted?.length || 0;
                }
            } while (token);
            if (checked) {
                console.log(`🧹 S3 cleanup: checked ${checked}, deleted ${deleted}, maxAgeHrs=${S3_CLEANUP_MAX_AGE_HOURS}`);
            }
        } catch (err) {
            console.error('S3 cleanup error:', err);
        }
    };
    // kick off immediately, then schedule
    run();
    setInterval(run, intervalMs);
};

io.on('connection', (socket) => {
    const userId = socket.request.session.userId;
    if (!userId) { socket.disconnect(); return; }

    console.log(`🔌 Client ${socket.id} connected.`);

    let dgConnection = null;
    let keepAliveInterval = null;
    const liveSupportsStreaming = LIVE_TRANSCRIPTION.provider === 'deepgram';

    // A. Setup Deepgram Connection
    const setupDeepgram = async () => {
        if (!liveSupportsStreaming) return;
        try {
            const settings = await db.getSettings(userId);
            const keywords = settings?.custom_keywords 
                ? settings.custom_keywords.split(',').map(k => k.trim() + ":2") 
                : [];

            dgConnection = deepgram.listen.live({
                model: LIVE_TRANSCRIPTION.model,
                language: LIVE_TRANSCRIPTION.language,
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
        if (!liveSupportsStreaming) return; // live streaming only for Deepgram right now
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
        // Close connection immediately to save costs (Deepgram only)
        if (dgConnection) {
            dgConnection.finish();
            dgConnection = null;
        }
        clearInterval(keepAliveInterval);

        console.log(`📝 Finalizing... Text Length: ${fullTranscript?.length}`);

        try {
            // If empty, trigger backup
            if (!liveSupportsStreaming || !fullTranscript || fullTranscript.trim().length < 2) {
                socket.emit('use-backup-upload', {}); 
                return;
            }

            const hasBalance = await db.deductCredit(userId);
            if (!hasBalance) {
                socket.emit('prescription-result', { success: false, error: "Low Balance." });
                return;
            }

            const macros = await db.getMacros(userId);
            const prompt = generateScribePrompt(fullTranscript, context, macros);
            const llmRes = await runLlmTask('scribe', prompt);
            const newCredits = await db.getCredits(userId);
            
            socket.emit('prescription-result', { 
                success: true, 
                html: sanitizeContent(cleanAI(llmRes.raw)), 
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
    try {
        const user = await db.getUser(req.body.phone);
        if (user && bcrypt.compareSync(req.body.password, user.password)) {
            req.session.userId = user.id; res.json({ success: true });
        } else res.json({ success: false, message: "Invalid" });
    } catch (e) {
        console.error('Login error:', e);
        res.status(500).json({ success: false, message: "Login failed" });
    }
});
app.post('/api/logout', (req, res) => {
    req.session.userId = null;
    req.session.isAdmin = false;
    req.session.destroy(() => {
        res.clearCookie('connect.sid');
        res.json({ success: true });
    });
});

// S3 presigned URL for audio upload
app.post('/api/upload-url', authLimiter, async (req, res) => {
    try {
        if (!req.session.userId) return res.status(401).json({ error: "Unauthorized" });
        const { contentType } = req.body || {};
        const normalizedContentType = contentType === 'video/webm' ? 'audio/webm' : contentType;
        const isAudio = normalizedContentType && normalizedContentType.startsWith('audio/');
        if (!isAudio) return res.status(400).json({ error: "Invalid content type" });
        if (!S3_BUCKET || !S3_REGION) return res.status(500).json({ error: "S3 not configured" });
        const ext = audioExtForContentType(normalizedContentType);
        const key = `uploads/${req.session.userId}/${Date.now()}-${uuidv4()}${ext}`;
        const command = new PutObjectCommand({
            Bucket: S3_BUCKET,
            Key: key,
            ContentType: normalizedContentType
        });
        const url = await getSignedUrl(s3, command, { expiresIn: 300 });
        res.json({ url, key, expiresIn: 300 });
    } catch (e) {
        console.error("Presign error:", e);
        res.status(500).json({ error: "Failed to generate upload URL" });
    }
});
app.post('/api/register', authLimiter, async (req, res) => {
    try { await db.createUser(req.body.phone, req.body.password); res.json({ success: true }); } 
    catch (e) { res.json({ success: false, message: "Exists" }); }
});

// Registration with OTP (static for now)
app.post('/api/register/send-otp', authLimiter, async (req, res) => {
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
    try {
        if (!req.session.userId) return res.status(401).json({ error: "Unauthorized" });
        const user = await db.getUserById(req.session.userId);
        if (!user) { req.session.destroy(); return res.status(401).json({ error: "User not found" }); }
        const credits = await db.getCredits(req.session.userId);
        res.json({ phone: user.phone, credits: credits, header_html: sanitizeContent(user.header_html || "") });
    } catch (e) {
        console.error('/api/me error:', e);
        res.status(500).json({ error: "Failed to fetch user" });
    }
});
app.post('/api/header', async (req, res) => { 
    try {
        if (!req.session.userId) return res.status(401).json({ error: "Unauthorized" });
        const clean = sanitizeContent(req.body.html || "");
        await db.updateHeader(req.session.userId, clean); 
        res.json({ success: true }); 
    } catch (e) {
        console.error('Update header error:', e);
        res.status(500).json({ success: false, error: "Failed to update header" });
    }
});
app.get('/api/macros', async (req, res) => { 
    try {
        if (!req.session.userId) return res.json([]);
        res.json(await db.getMacros(req.session.userId)); 
    } catch (e) {
        console.error('Get macros error:', e);
        res.status(500).json({ error: "Failed to fetch macros" });
    }
});
app.post('/api/macros', async (req, res) => { 
    try {
        await db.saveMacro(req.session.userId, req.body.trigger, req.body.expansion); 
        res.json({ success: true }); 
    } catch (e) {
        console.error('Save macro error:', e);
        res.status(500).json({ success: false, error: "Failed to save macro" });
    }
});
app.post('/api/macros/delete', async (req, res) => { 
    try {
        if (!req.session.userId) return res.status(401).json({ error: "Unauthorized" });
        await db.deleteMacro(req.session.userId, req.body.trigger);
        res.json({ success: true }); 
    } catch (e) {
        console.error('Delete macro error:', e);
        res.status(500).json({ success: false, error: "Failed to delete macro" });
    }
});

// --- REVIEW ENDPOINT ---
app.post('/api/review', aiLimiter, async (req, res) => {
    try {
        const { html } = req.body;
        if (!req.session.userId) return res.status(401).json({ error: "Unauthorized" });
        if (!html) return res.status(400).json({ error: "Missing html" });
        const prompt = generateReviewPrompt(html);

        const llmRes = await runLlmTask('review', prompt);
        const reviewed = llmRes.raw;

        res.json({ success: true, reviewed: sanitizeContent(cleanAI(reviewed)) });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/format', aiLimiter, async (req, res) => {
    try {
        const { html } = req.body;
        if (!req.session.userId) return res.status(401).json({ error: "Unauthorized" });
        if (!html) return res.status(400).json({ error: "Missing html" });
        const { provider: formatProvider, model: formatModel } = getLlmConfig('format');
        const startMsg = `format start user=${req.session.userId} provider=${formatProvider} model=${formatModel} htmlLength=${(html || "").length}`;
        console.log("🧪", startMsg);
        appendFormatLog(startMsg);
        const prompt = generateFormatPrompt(html);
        const llmRes = await runLlmTask('format', prompt, { responseSchema: formatResponseSchema, forceJson: true });

        const raw = cleanAI(llmRes.raw);
        let parsed = {};
        try {
            parsed = JSON.parse(raw);
        } catch (err) {
            parsed = { html: raw };
        }

        const schemaMsg = `format schema user=${req.session.userId} provider=${llmRes.provider} model=${llmRes.model} hasHtml=${Boolean(parsed.html)} sectionKeys=${parsed.sections ? Object.keys(parsed.sections).join(',') : ''} preview=${raw.slice(0,120).replace(/\s+/g,' ')}`;
        console.log("🧪", schemaMsg);
        appendFormatLog(schemaMsg);
        appendFormatLog(`format raw user=${req.session.userId} payload=${raw}`);

        const formattedHtml = sanitizeContent(parsed.html || "");
        res.json({ success: true, formatted: formattedHtml, structured: parsed.sections || null });
    } catch (e) {
        const errMsg = `format error user=${req.session.userId} msg=${e?.message}`;
        console.error("❌", errMsg);
        appendFormatLog(errMsg);
        res.status(500).json({ success: false, error: e.message });
    }
});
app.get('/settings', async (req, res) => { 
    try {
        if (!req.session.userId) return res.status(401).json({});
        res.json(await db.getSettings(req.session.userId) || {}); 
    } catch (e) {
        console.error('Get settings error:', e);
        res.status(500).json({ error: "Failed to fetch settings" });
    }
});
app.post('/settings', async (req, res) => { 
    try {
        if (!req.session.userId) return res.status(401).json({});
        await db.saveSettings(req.session.userId, req.body); 
        res.json({ success: true }); 
    } catch (e) {
        console.error('Save settings error:', e);
        res.status(500).json({ success: false, error: "Failed to save settings" });
    }
});

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
});

app.post('/api/admin/credits', requireAdmin, async (req, res) => {
    try {
        const { userId, amount } = req.body;
        if (!userId || !amount) return res.status(400).json({ error: 'Missing params' });
        await db.addCredits(userId, Number(amount));
        res.json({ success: true });
    } catch (e) {
        console.error('Admin add credits error:', e);
        res.status(500).json({ error: 'Failed to update credits' });
    }
});

app.post('/api/admin/remove-user', requireAdmin, async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ error: 'Missing userId' });
        await db.removeUser(userId);
        res.json({ success: true });
    } catch (e) {
        console.error('Admin remove user error:', e);
        res.status(500).json({ error: 'Failed to remove user' });
    }
});

app.get('/api/admin/providers', requireAdmin, async (_req, res) => {
    try {
        const stored = await db.getProviderSettings();
        const resolved = {
            liveTranscription: getTranscriptionConfig('live'),
            offlineTranscription: getTranscriptionConfig('offline'),
            scribe: getLlmConfig('scribe'),
            format: getLlmConfig('format'),
            review: getLlmConfig('review')
        };
        res.json({ overrides: stored, resolved });
    } catch (e) {
        console.error('Admin get providers error:', e);
        res.status(500).json({ error: 'Failed to load providers' });
    }
});

app.post('/api/admin/providers', requireAdmin, async (req, res) => {
    try {
        const allowedLlm = ['gemini', 'openai', 'groq'];
        const allowedTranscription = ['deepgram', 'openai', 'groq'];
        const { liveTranscription, offlineTranscription, scribeProvider, formatProvider, reviewProvider } = req.body || {};
        const sanitized = {};
        if (allowedTranscription.includes((liveTranscription || "").toLowerCase())) sanitized.liveTranscription = liveTranscription.toLowerCase();
        if (allowedTranscription.includes((offlineTranscription || "").toLowerCase())) sanitized.offlineTranscription = offlineTranscription.toLowerCase();
        if (allowedLlm.includes((scribeProvider || "").toLowerCase())) sanitized.scribeProvider = scribeProvider.toLowerCase();
        if (allowedLlm.includes((formatProvider || "").toLowerCase())) sanitized.formatProvider = formatProvider.toLowerCase();
        if (allowedLlm.includes((reviewProvider || "").toLowerCase())) sanitized.reviewProvider = reviewProvider.toLowerCase();

        await db.saveProviderSettings(sanitized);
        applyProviderOverrides(sanitized);
        res.json({ success: true });
    } catch (e) {
        console.error('Admin save providers error:', e);
        res.status(500).json({ error: 'Failed to save providers' });
    }
});

// --- PROCESS FROM S3 ---
app.post('/api/process-s3', aiLimiter, async (req, res) => {
    try {
        if (!req.session.userId) return res.status(401).json({ error: "Unauthorized" });
        const { key, context } = req.body || {};
        console.log("📦 /api/process-s3 start", { userId: req.session.userId, key, hasContext: !!context });
        if (!key || !key.startsWith(`uploads/${req.session.userId}/`)) return res.status(400).json({ error: "Invalid key" });
        if (!S3_BUCKET) return res.status(500).json({ error: "S3 not configured" });

        const creditDeducted = await db.deductCredit(req.session.userId);
        console.log("💳 Credit deduct (process-s3)", { userId: req.session.userId, success: creditDeducted });

        const obj = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }));
        const audioBuffer = await streamToBuffer(obj.Body);
        console.log("🎧 S3 object fetched", { key, bytes: audioBuffer.length });

        const mime = mimeForKey(key);
        let transcript = "";
        if (OFFLINE_TRANSCRIPTION.provider === 'deepgram') {
            console.log("🔊 Transcribing with Deepgram", { model: OFFLINE_TRANSCRIPTION.model, language: OFFLINE_TRANSCRIPTION.language, mime });
            const { result, error } = await deepgram.listen.prerecorded.transcribeFile(
                audioBuffer,
                { model: OFFLINE_TRANSCRIPTION.model, smart_format: true, language: OFFLINE_TRANSCRIPTION.language, mimetype: mime }
            );
            if (error) throw error;
            transcript = result.results.channels[0].alternatives[0].transcript;
        } else if (OFFLINE_TRANSCRIPTION.provider === 'openai') {
            if (!openai) throw new Error("OpenAI not configured");
            const ext = path.extname(key) || '.webm';
            console.log("🔊 Transcribing with OpenAI", { model: OFFLINE_TRANSCRIPTION.model, ext });
            const namedFile = await toFile(audioBuffer, `upload${ext}`);
            const oaRes = await openai.audio.transcriptions.create({
                file: namedFile,
                model: OFFLINE_TRANSCRIPTION.model,
                response_format: "text"
            });
            transcript = oaRes;
        } else if (OFFLINE_TRANSCRIPTION.provider === 'groq') {
            const ext = path.extname(key) || '.webm';
            console.log("🔊 Transcribing with Groq", { model: OFFLINE_TRANSCRIPTION.model, ext });
            transcript = await groqTranscribe(audioBuffer, `upload${ext}`, OFFLINE_TRANSCRIPTION.model);
        } else {
            throw new Error(`Unsupported transcription provider: ${OFFLINE_TRANSCRIPTION.provider}`);
        }
        console.log("✅ Transcript ready", { provider: OFFLINE_TRANSCRIPTION.provider, transcriptLength: transcript?.length || 0 });
        
        const macros = await db.getMacros(req.session.userId);
        const prompt = generateScribePrompt(transcript, context || "", macros);
        const llmRes = await runLlmTask('scribe', prompt);
        
        const newCredits = await db.getCredits(req.session.userId);
        const scribedHtml = sanitizeContent(cleanAI(llmRes.raw));
        console.log("🧪 scribe (process-s3) output preview", {
            userId: req.session.userId,
            provider: llmRes.provider,
            model: llmRes.model,
            length: scribedHtml.length,
            preview: scribedHtml.slice(0, 200)
        });
        res.json({ success: true, html: scribedHtml, credits: newCredits });

    } catch (e) {
        console.error("process-s3 error:", e);
        res.status(500).json({ error: e.message });
    }
});

// --- 3. BACKUP UPLOAD ENDPOINT ---
app.post('/api/process-backup', upload.single('audio'), async (req, res) => {
    try {
        if (!req.session.userId) return res.status(401).json({ error: "Unauthorized" });
        if (!req.file) throw new Error("No audio file.");

        await db.deductCredit(req.session.userId);
        const uploadMime = req.file.mimetype === 'video/webm' ? 'audio/webm' : (req.file.mimetype || 'audio/webm');

        let transcript = "";
        if (OFFLINE_TRANSCRIPTION.provider === 'deepgram') {
            const { result, error } = await deepgram.listen.prerecorded.transcribeFile(
                fs.readFileSync(req.file.path),
                { model: OFFLINE_TRANSCRIPTION.model, smart_format: true, language: OFFLINE_TRANSCRIPTION.language, mimetype: uploadMime }
            );
            if (error) throw error;
            transcript = result.results.channels[0].alternatives[0].transcript;
        } else if (OFFLINE_TRANSCRIPTION.provider === 'openai') {
            if (!openai) throw new Error("OpenAI not configured");
            const audioFile = fs.createReadStream(req.file.path);
            const oaRes = await openai.audio.transcriptions.create({
                file: audioFile,
                model: OFFLINE_TRANSCRIPTION.model,
                response_format: "text"
            });
            transcript = oaRes;
        } else if (OFFLINE_TRANSCRIPTION.provider === 'groq') {
            const buffer = fs.readFileSync(req.file.path);
            transcript = await groqTranscribe(buffer, req.file.originalname || 'upload.webm', OFFLINE_TRANSCRIPTION.model);
        } else {
            throw new Error(`Unsupported transcription provider: ${OFFLINE_TRANSCRIPTION.provider}`);
        }
        
        const macros = await db.getMacros(req.session.userId);
        const prompt = generateScribePrompt(transcript, req.body.context || "", macros);
        const aiRes = await runLlmTask('scribe', prompt);
        
        fs.unlinkSync(req.file.path);
        const newCredits = await db.getCredits(req.session.userId);
        const scribedHtml = sanitizeContent(cleanAI(aiRes.raw));
        console.log("🧪 scribe (process-backup) output preview", {
            userId: req.session.userId,
            provider: aiRes.provider,
            model: aiRes.model,
            length: scribedHtml.length,
            preview: scribedHtml.slice(0, 200)
        });
        res.json({ success: true, html: scribedHtml, credits: newCredits });

    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

const PORT = 3000;
httpServer.listen(PORT, () => console.log(`\n🚀 Clinova Rx running on port ${PORT}\n`));
scheduleS3Cleanup();
