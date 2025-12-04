import express from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@deepgram/sdk';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import basicAuth from 'express-basic-auth'; 
import * as db from './database.js'; 
import { generateScribePrompt } from './prompts.js';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

// --- 🔒 AUTH ---
const adminUser = process.env.ADMIN_USER;
const adminPass = process.env.ADMIN_PASS;
if (adminUser && adminPass) {
    const users = {}; users[adminUser] = adminPass;
    app.use(basicAuth({ users, challenge: true, realm: 'SmartRx Login' }));
}

app.use(express.static('public'));
app.use(express.json()); // Handle JSON text payloads

const deepgram = createClient(process.env.DEEPGRAM_API_KEY);
const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

// 1. KEY VENDING MACHINE (Generates 10-second key)
// 1. KEY VENDING MACHINE (Fixed for SDK v3)
app.get('/auth/deepgram-token', async (req, res) => {
    try {
        if (!process.env.DEEPGRAM_PROJECT_ID) throw new Error("Project ID missing in .env");
        
        // CORRECTED SYNTAX: Remove .v1.projects.keys
        const { result, error } = await deepgram.manage.createProjectKey(
            process.env.DEEPGRAM_PROJECT_ID,
            {
                comment: 'Temporary Client Key',
                scopes: ['usage:write'],
                time_to_live_in_seconds: 60, // Key expires in 1 min
            }
        );

        if (error) throw error;
        res.json({ key: result.key });
    } catch (err) {
        console.error("Token Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// 2. TEXT PROCESSOR (Gemini)
// Audio never touches this server. Only text.
app.post('/process-text', async (req, res) => {
    try {
        const { transcript, context } = req.body;
        if (!transcript) throw new Error("No text provided");

        console.log("📝 Formatting Text Length:", transcript.length);

        const macros = await db.getMacros();
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });
        const prompt = generateScribePrompt(transcript, context, macros);

        const aiResult = await model.generateContent(prompt);
        const html = aiResult.response.text();

        res.json({ success: true, raw: html });

    } catch (err) {
        console.error("Gemini Error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// --- SETTINGS/MACROS (Standard DB Calls) ---
app.get('/settings', async (req, res) => res.json(await db.getSettings()));
app.post('/settings', async (req, res) => { await db.saveSettings(req.body); res.json({ success: true }); });
app.get('/macros', async (req, res) => res.json(await db.getMacros()));
app.post('/macros', async (req, res) => { await db.saveMacro(req.body.trigger, req.body.expansion); res.json({ success: true }); });

const PORT = 3000;
app.listen(PORT, () => console.log(`\n🚀 Lightweight Server running on port ${PORT}\n`));