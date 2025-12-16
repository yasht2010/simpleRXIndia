import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getClient as getS3Client } from '../services/s3.service.js';
import * as transcriptionService from '../services/transcription.service.js';
import * as llmService from '../services/llm.service.js';
import * as db from '../database.js';
import { generateScribePrompt } from '../prompts.js';
import sanitizeHtml from 'sanitize-html';
import fs from 'fs';
import path from 'path';

// Helper
const cleanAI = (text = "") => text.replace(/```(?:html)?/gi, "").replace(/```/g, "").trim();
const sanitizeContent = (html = "") => sanitizeHtml(html, {
    allowedTags: ['h1', 'h2', 'h3', 'h4', 'p', 'b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr', 'br', 'span', 'div'],
    allowedAttributes: {
        '*': ['colspan', 'rowspan', 'class', 'style']
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    disallowedTagsMode: 'discard'
});
const streamToBuffer = async (stream) => {
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks);
};
const mimeForKey = (key) => {
    if (key.endsWith('.wav')) return 'audio/wav';
    if (key.endsWith('.mp3')) return 'audio/mpeg';
    if (key.endsWith('.m4a')) return 'audio/mp4';
    if (key.endsWith('.ogg')) return 'audio/ogg';
    return 'audio/webm';
};

export const processS3 = async (req, res) => {
    try {
        if (!req.session.userId) return res.status(401).json({ error: "Unauthorized" });
        const { key, context } = req.body || {};
        const s3 = getS3Client();

        console.log("📦 /api/process-s3 start", { userId: req.session.userId, key });

        if (!key || !key.startsWith(`uploads/${req.session.userId}/`)) return res.status(400).json({ error: "Invalid key" });
        if (!s3) return res.status(500).json({ error: "S3 not configured" });

        const creditDeducted = await db.deductCredit(req.session.userId);
        if (!creditDeducted) return res.status(402).json({ error: "Insufficient credits" });

        const obj = await s3.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
        const audioBuffer = await streamToBuffer(obj.Body);

        const mime = mimeForKey(key);
        const filename = path.basename(key);

        const transcript = await transcriptionService.transcribe(audioBuffer, filename, mime);

        const macros = await db.getMacros(req.session.userId);
        const prompt = generateScribePrompt(transcript, context || "", macros);
        const llmRes = await llmService.runLlmTask('scribe', prompt);

        const newCredits = await db.getCredits(req.session.userId);
        const scribedHtml = sanitizeContent(cleanAI(llmRes.raw));

        res.json({ success: true, html: scribedHtml, credits: newCredits });
    } catch (e) {
        console.error("process-s3 error:", e);
        res.status(500).json({ error: e.message });
    }
};

export const processBackup = async (req, res) => {
    try {
        if (!req.session.userId) return res.status(401).json({ error: "Unauthorized" });
        if (!req.file) throw new Error("No audio file.");

        const creditDeducted = await db.deductCredit(req.session.userId);
        if (!creditDeducted) return res.status(402).json({ error: "Insufficient credits" });

        const buffer = fs.readFileSync(req.file.path);
        const mime = req.file.mimetype || 'audio/webm';
        const filename = req.file.originalname || 'upload.webm';

        const transcript = await transcriptionService.transcribe(buffer, filename, mime);

        const macros = await db.getMacros(req.session.userId);
        const prompt = generateScribePrompt(transcript, req.body.context || "", macros);
        const llmRes = await llmService.runLlmTask('scribe', prompt);

        // Cleanup
        fs.unlinkSync(req.file.path);

        const newCredits = await db.getCredits(req.session.userId);
        const scribedHtml = sanitizeContent(cleanAI(llmRes.raw));

        res.json({ success: true, html: scribedHtml, credits: newCredits });
    } catch (e) {
        if (req.file?.path) fs.unlink(req.file.path, () => { });
        console.error("process-backup error:", e);
        res.status(500).json({ error: e.message });
    }
};
