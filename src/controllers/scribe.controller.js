import * as llmService from '../services/llm.service.js';
import { generateReviewPrompt, generateFormatPrompt } from '../prompts.js';
import { formatResponseSchema } from '../schemas/formatSchema.js'; // Ensure this file exists or move it
import sanitizeHtml from 'sanitize-html';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..', '..'); // Up from src/controllers

// Utility for cleaning AI response
const cleanAI = (text = "") => text.replace(/```(?:html)?/gi, "").replace(/```/g, "").trim();

const sanitizeContent = (html = "") => sanitizeHtml(html, {
    allowedTags: ['h1', 'h2', 'h3', 'h4', 'p', 'b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr', 'br', 'span', 'div'],
    allowedAttributes: {
        '*': ['colspan', 'rowspan', 'class', 'style']
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    disallowedTagsMode: 'discard'
});

const appendFormatLog = (line) => {
    const entry = `[${new Date().toISOString()}] ${line}\n`;
    const logPath = path.join(PROJECT_ROOT, 'logs', 'format.log');
    fs.appendFile(logPath, entry, (err) => {
        if (err) console.error('format log write error:', err);
    });
};

export const review = async (req, res) => {
    try {
        const { html } = req.body;
        if (!req.session.userId) return res.status(401).json({ error: "Unauthorized" });
        if (!html) return res.status(400).json({ error: "Missing html" });
        const prompt = generateReviewPrompt(html);

        const llmRes = await llmService.runLlmTask('review', prompt);
        const reviewed = llmRes.raw;

        res.json({ success: true, reviewed: sanitizeContent(cleanAI(reviewed)) });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
};

export const format = async (req, res) => {
    try {
        const { html } = req.body;
        if (!req.session.userId) return res.status(401).json({ error: "Unauthorized" });
        if (!html) return res.status(400).json({ error: "Missing html" });

        // Note: accessing provider config directly from service might need a getter if we want to log it
        // For now, logging generic start
        const startMsg = `format start user=${req.session.userId} htmlLength=${(html || "").length}`;
        console.log("🧪", startMsg);
        appendFormatLog(startMsg);

        const prompt = generateFormatPrompt(html);
        const llmRes = await llmService.runLlmTask('format', prompt, { responseSchema: formatResponseSchema, forceJson: true });

        const raw = cleanAI(llmRes.raw);
        let parsed = {};
        try {
            parsed = JSON.parse(raw);
        } catch (err) {
            parsed = { html: raw };
        }

        const schemaMsg = `format schema user=${req.session.userId} provider=${llmRes.provider} model=${llmRes.model} hasHtml=${Boolean(parsed.html)} sectionKeys=${parsed.sections ? Object.keys(parsed.sections).join(',') : ''} preview=${raw.slice(0, 120).replace(/\s+/g, ' ')}`;
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
};
