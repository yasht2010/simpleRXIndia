import * as db from '../database.js';
import sanitizeHtml from 'sanitize-html';

const sanitize = (html = "") => sanitizeHtml(html, {
    allowedTags: ['h1', 'h2', 'h3', 'h4', 'p', 'b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr', 'br', 'span', 'div'],
    allowedAttributes: {
        '*': ['colspan', 'rowspan', 'class', 'style']
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    disallowedTagsMode: 'discard'
});

export const getSettings = async (req, res) => {
    try {
        if (!req.session.userId) return res.status(401).json({});
        const settings = await db.getSettings(req.session.userId);
        res.json(settings || {});
    } catch (e) {
        console.error('Get settings error:', e);
        res.status(500).json({ error: "Failed to fetch settings" });
    }
};

export const saveSettings = async (req, res) => {
    try {
        if (!req.session.userId) return res.status(401).json({});
        await db.saveSettings(req.session.userId, req.body);
        res.json({ success: true });
    } catch (e) {
        console.error('Save settings error:', e);
        res.status(500).json({ success: false, error: "Failed to save settings" });
    }
};

export const updateHeader = async (req, res) => {
    try {
        if (!req.session.userId) return res.status(401).json({ error: "Unauthorized" });
        const clean = sanitize(req.body.html || "");
        await db.updateHeader(req.session.userId, clean);
        res.json({ success: true });
    } catch (e) {
        console.error('Update header error:', e);
        res.status(500).json({ success: false, error: "Failed to update header" });
    }
};

export const getMacros = async (req, res) => {
    try {
        if (!req.session.userId) return res.json([]);
        res.json(await db.getMacros(req.session.userId));
    } catch (e) {
        console.error('Get macros error:', e);
        res.status(500).json({ error: "Failed to fetch macros" });
    }
};

export const saveMacro = async (req, res) => {
    try {
        // userId check via middleware or here
        if (!req.session.userId) return res.status(401).json({ error: "Unauthorized" });
        await db.saveMacro(req.session.userId, req.body.trigger, req.body.expansion);
        res.json({ success: true });
    } catch (e) {
        console.error('Save macro error:', e);
        res.status(500).json({ success: false, error: "Failed to save macro" });
    }
};

export const deleteMacro = async (req, res) => {
    try {
        if (!req.session.userId) return res.status(401).json({ error: "Unauthorized" });
        await db.deleteMacro(req.session.userId, req.body.trigger);
        res.json({ success: true });
    } catch (e) {
        console.error('Delete macro error:', e);
        res.status(500).json({ success: false, error: "Failed to delete macro" });
    }
};
