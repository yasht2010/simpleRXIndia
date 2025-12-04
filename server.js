import express from 'express';
import multer from 'multer';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { transcribeAudio } from './transcriber.js';
import * as db from './database.js';
import { generateScribePrompt } from './prompts.js';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const upload = multer({ dest: 'uploads/' });

if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');

app.use(express.static('public'));
app.use(express.json());

const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;
const ACTIVE_PROVIDER = process.env.TRANSCRIPTION_PROVIDER || 'deepgram';

// --- MAIN PROCESS ---
app.post('/process-audio', upload.single('audio'), async (req, res) => {
    try {
        if (!req.file) throw new Error("No audio.");
        
        // 1. Get Context (The text already on screen)
        const currentContext = req.body.context || "";

        // 2. Get Settings (for Keywords)
        const settings = await db.getSettings();
        
        // 3. Transcribe
        const transcript = await transcribeAudio(req.file.path, ACTIVE_PROVIDER, settings.custom_keywords);
        console.log("Transcript:", transcript);

        // 4. Get Macros
        const macros = await db.getMacros();
        const macroContext = JSON.stringify(macros);

        // 5. Gemini Processing (Context-Aware)
        // Switch to gemini-1.5-pro for better "Merging" logic
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });
        
        // Use the imported prompt generator
        const prompt = generateScribePrompt(transcript, currentContext, macroContext);

        const aiResult = await model.generateContent(prompt);
        const rawOutput = aiResult.response.text();
        
        fs.unlinkSync(req.file.path);
        res.json({ success: true, raw: rawOutput });

    } catch (err) {
        console.error("Error:", err);
        res.status(500).json({ success: false, error: err.message, retryId: req.file?.filename });
    }
});

// --- SETTINGS APIs ---
app.get('/settings', async (req, res) => res.json(await db.getSettings()));
app.post('/settings', async (req, res) => { await db.saveSettings(req.body); res.json({ success: true }); });

// --- MACRO APIs ---
app.get('/macros', async (req, res) => res.json(await db.getMacros()));
app.post('/macros', async (req, res) => { await db.saveMacro(req.body.trigger, req.body.expansion); res.json({ success: true }); });

// --- Rx APIs ---
app.post('/save-rx', async (req, res) => {
    try {
        const id = await db.savePrescription(req.body.doctorName, req.body.patientName, req.body.htmlContent);
        res.json({ success: true, link: `${req.protocol}://${req.get('host')}/rx/${id}`, id });
    } catch (err) { res.status(500).json({ error: err.message }); }
});
app.get('/rx/:id', async (req, res) => {
    try {
        const rx = await db.getPrescription(req.params.id);
        if (!rx) return res.send("Prescription not found.");
        res.send(`<html><body><h1>${rx.doctor_name}</h1><div>${rx.content_html}</div></body></html>`); // Simplified for brevity
    } catch (err) { res.send("Error"); }
});

const PORT = 3000;
app.listen(PORT, () => console.log(`\n🚀 Server running at http://localhost:${PORT}\n`));