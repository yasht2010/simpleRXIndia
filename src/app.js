import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import pgSession from 'connect-pg-simple';
import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import fs from 'fs';
import * as db from './database.js'; // Ensure this path is correct relative to src/app.js
import { getTranscriptionConfig, setProviderOverrides } from './services/providerConfig.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Adjust __dirname to point to project root if needed, or handle public folder correctly
// Since src/app.js is one level deep, public is ../public
const PROJECT_ROOT = path.join(__dirname, '..');

const app = express();

if (!fs.existsSync(path.join(PROJECT_ROOT, 'uploads'))) fs.mkdirSync(path.join(PROJECT_ROOT, 'uploads'));
if (!fs.existsSync(path.join(PROJECT_ROOT, 'logs'))) fs.mkdirSync(path.join(PROJECT_ROOT, 'logs'));

// --- CONFIG CONSTANTS ---
// These could be moved to src/config/index.js later
const SESSION_SECRET = process.env.SESSION_SECRET || 'change_me_session_secret';
const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;

// --- SESSION CONFIG ---
if (!SUPABASE_DB_URL) {
    // Making this non-fatal for tests if env not set, but warning
    console.warn('SUPABASE_DB_URL env missing for session storage');
}

const { Pool } = pg;
let sessionStore;

if (SUPABASE_DB_URL) {
    const pgPool = new Pool({
        connectionString: SUPABASE_DB_URL,
        ssl: { rejectUnauthorized: false }
    });
    pgPool.on('error', (err) => console.error('Postgres pool error:', err));
    const PGStore = pgSession(session);
    sessionStore = new PGStore({
        pool: pgPool,
        tableName: 'session',
        createTableIfMissing: true
    });
} else {
    sessionStore = new session.MemoryStore();
}

const sessionMiddleware = session({
    store: sessionStore,
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

// Rate Limiters - Exported or defined here
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });
const aiLimiter = rateLimit({ windowMs: 5 * 60 * 1000, max: 30 });

// --- PROVIDER OVERRIDES ---
const applyProviderOverrides = (overrides = {}) => {
    setProviderOverrides(overrides);
};
(async () => {
    try {
        const stored = await db.getProviderSettings();
        applyProviderOverrides(stored);
        console.log("✅ Provider overrides loaded");
    } catch (err) {
        console.warn("Provider override load failed (non-fatal):", err?.message || err);
    }
})();

// --- ROUTES ---
import authRoutes from './routes/auth.routes.js';
import uploadRoutes from './routes/upload.routes.js';
import scribeRoutes from './routes/scribe.routes.js';
import medicineRoutes from './routes/medicine.routes.js';
import adminRoutes from './routes/admin.routes.js';
import settingsRoutes from './routes/settings.routes.js';
import processRoutes from './routes/process.routes.js';

app.use('/api', authRoutes);
app.use('/api', uploadRoutes);
app.use('/api', scribeRoutes);
app.use('/api', medicineRoutes);
app.use('/api', processRoutes);
app.use('/api/admin', adminRoutes);
app.use('/', settingsRoutes); // Handles /settings and /api/macros etc.

app.get('/', (req, res) => {
    if (req.session.userId) return res.redirect('/dashboard');
    return res.sendFile(path.join(PROJECT_ROOT, 'public', 'index.html'));
});

app.get('/dashboard', (req, res) => {
    if (!req.session.userId) return res.redirect('/');
    return res.sendFile(path.join(PROJECT_ROOT, 'public', 'index.html'));
});

app.get('/register', (req, res) => {
    if (req.session.userId) return res.redirect('/dashboard');
    return res.sendFile(path.join(PROJECT_ROOT, 'public', 'register.html'));
});

app.use(express.static(path.join(PROJECT_ROOT, 'public')));

export { app, sessionMiddleware, PROJECT_ROOT };
