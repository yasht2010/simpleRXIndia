import express from 'express';
import multer from 'multer';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@deepgram/sdk';
import fs from 'fs';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import basicAuth from 'express-basic-auth'; 
import * as db from './database.js'; 

// IMPORT PROMPTS MODULE
import { generateScribePrompt } from './prompts.js';


dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const upload = multer({ dest: 'uploads/' }); // Temp storage

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

// --- THE MAIN ENDPOINT ---
app.post('/process-audio', upload.single('audio'), async (req, res) => {
    try {
        if (!req.file) throw new Error("No audio file.");
        
        console.log(`🎤 Processing Audio: ${req.file.size} bytes`);

        // 1. Transcribe (Deepgram)
        // We force 'audio/webm' because browsers send WebM blobs
        const { result, error } = await deepgram.listen.prerecorded.transcribeFile(
            fs.readFileSync(req.file.path),
            {
                model: 'nova-2-medical',
                smart_format: true,
                language: 'en-IN',
                mimetype: 'audio/webm' 
            }
        );

        if (error) throw error;
        const transcript = result.results.channels[0].alternatives[0].transcript;
        console.log("📝 Transcript:", transcript);

        // 2. Format / Merge (Gemini)
        const macros = await db.getMacros();
        const currentContext = req.body.context || ""; // The existing HTML note
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });
        
        const prompt = generateScribePrompt(transcript, currentContext, macros);

        const aiResult = await model.generateContent(prompt);
        const html = aiResult.response.text();

        // Cleanup
        fs.unlinkSync(req.file.path);
        
        res.json({ success: true, raw: html });

    } catch (err) {
        console.error("Error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// --- SETTINGS APIs ---
app.get('/settings', async (req, res) => res.json(await db.getSettings()));
app.post('/settings', async (req, res) => { await db.saveSettings(req.body); res.json({ success: true }); });
app.get('/macros', async (req, res) => res.json(await db.getMacros()));
app.post('/macros', async (req, res) => { await db.saveMacro(req.body.trigger, req.body.expansion); res.json({ success: true }); });

const PORT = 3000;
app.listen(PORT, () => console.log(`\n🚀 Simple Server running on port ${PORT}\n`));