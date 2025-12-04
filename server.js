import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { createClient } from '@deepgram/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import basicAuth from 'express-basic-auth'; 
import { v4 as uuidv4 } from 'uuid';

// Import Custom Modules
import * as db from './database.js'; 
import { generateScribePrompt } from './prompts.js';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

// --- 🔒 PASSWORD PROTECTION ---
const adminUser = process.env.ADMIN_USER;
const adminPass = process.env.ADMIN_PASS;

if (adminUser && adminPass) {
    const users = {};
    users[adminUser] = adminPass;
    app.use(basicAuth({ users, challenge: true, realm: 'SmartRx Login' }));
}

app.use(express.static('public'));
app.use(express.json());

const deepgram = createClient(process.env.DEEPGRAM_API_KEY);
const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

// --- SOCKET CONNECTION LOGIC ---
io.on('connection', (socket) => {
    console.log('🔌 Client Connected:', socket.id);
    let dgLive = null;

    // 1. Setup Deepgram Live
    const setupDeepgram = async () => {
        const settings = await db.getSettings();
        // Convert "Urimax, Drotin" string to ["Urimax:2", "Drotin:2"]
        const keywords = settings.custom_keywords 
            ? settings.custom_keywords.split(',').map(k => k.trim() + ":2") 
            : [];

        dgLive = deepgram.listen.live({
            model: "nova-2-medical",
            language: "en-IN",
            smart_format: true,
            interim_results: true,
            keywords: keywords,
            encoding: "linear16", // Raw PCM audio
            sample_rate: 16000    // Downsampled rate
        });

        dgLive.on("Transcript", (data) => {
            const transcript = data.channel.alternatives[0].transcript;
            if (transcript) {
                socket.emit('transcript-update', { 
                    text: transcript, 
                    isFinal: data.is_final 
                });
            }
        });

        dgLive.on("error", (err) => console.error("DG Error:", err));
    };

    // 2. Handle Streaming Audio

    let isDeepgramConnecting = false; // Lock flag

    socket.on('audio-stream', async (data) => {
        // Prevent multiple simultaneous connection attempts
        if (!dgLive && !isDeepgramConnecting) {
            isDeepgramConnecting = true;
            await setupDeepgram();
            isDeepgramConnecting = false;
        }
        
        if (dgLive && dgLive.getReadyState() === 1) {
            dgLive.send(data);
        }
    });

    // 3. Finalize & Format (Gemini)
    socket.on('finalize-prescription', async ({ fullTranscript, context }) => {
        if (dgLive) { dgLive.finish(); dgLive = null; }
        
        console.log("📝 Formatting:", fullTranscript);

        try {
            const macros = await db.getMacros();
            const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });
            
            // Use the Prompt Module
            const prompt = generateScribePrompt(fullTranscript, context, macros);
            
            const result = await model.generateContent(prompt);
            socket.emit('prescription-result', { success: true, html: result.response.text() });
        } catch (e) {
            console.error("Gemini Error:", e);
            socket.emit('prescription-result', { success: false, error: e.message });
        }
    });

    socket.on('disconnect', () => {
        if (dgLive) dgLive.finish();
    });
});

// --- REST APIs (Settings/DB) ---
app.get('/settings', async (req, res) => res.json(await db.getSettings()));
app.post('/settings', async (req, res) => { await db.saveSettings(req.body); res.json({ success: true }); });

app.get('/macros', async (req, res) => res.json(await db.getMacros()));
app.post('/macros', async (req, res) => { await db.saveMacro(req.body.trigger, req.body.expansion); res.json({ success: true }); });

// --- VIEW RX PAGE ---
app.get('/rx/:id', async (req, res) => {
    try {
        const rx = await db.getPrescription(req.params.id);
        if (!rx) return res.send("Prescription not found.");
        res.send(`
            <html><head><title>Rx</title></head><body style="font-family:sans-serif;padding:20px;">
            <div style="border-bottom:2px solid #333;margin-bottom:20px;"><h1>Dr. ${rx.doctor_name}</h1></div>
            ${rx.content_html}
            </body></html>
        `);
    } catch (e) { res.send("Error"); }
});

const PORT = 3000;
httpServer.listen(PORT, () => console.log(`\n🚀 Server running on port ${PORT}\n`));
