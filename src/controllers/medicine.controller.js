import dotenv from 'dotenv';
dotenv.config();

const MEDICINE_SERVICE_BASE = process.env.MEDICINE_SERVICE_BASE || 'http://127.0.0.1:8000';

const fetchWithTimeout = async (url, options = {}, timeoutMs = 4000) => {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(id);
    }
};

const callMedicineService = async (path, q) => {
    const url = `${MEDICINE_SERVICE_BASE}${path}?q=${encodeURIComponent(q)}`;
    const resp = await fetchWithTimeout(url, { headers: { 'Accept': 'application/json' } }, 4500);
    if (!resp.ok) throw new Error(`medicine service ${resp.status}`);
    return resp.json();
};

const normalizeMedicineResult = (row = {}) => ({
    id: typeof row.id === 'number' ? row.id : (row.id ? Number(row.id) : null),
    brand: row.brand || "",
    manufacturer: row.manufacturer || "",
    composition: row.composition || "",
    match_score: Number(row.match_score) || 0,
    mol1: row.mol1 || "",
    mol2: row.mol2 || ""
});

export const suggest = async (req, res) => {
    try {
        if (!req.session.userId) return res.status(401).json([]);
        const q = (req.query.q || "").toString().trim();
        if (!q) return res.json([]);
        const data = await callMedicineService('/medicine-suggest', q);
        const cleaned = Array.isArray(data) ? data.map(normalizeMedicineResult) : [];
        res.json(cleaned);
    } catch (e) {
        console.error('medicine suggest error:', e?.message || e);
        res.status(500).json([]);
    }
};

export const validate = async (req, res) => {
    try {
        if (!req.session.userId) return res.status(401).json({});
        const q = (req.query.q || "").toString().trim();
        if (!q) return res.json({});
        const data = await callMedicineService('/medicine-validate', q);
        const cleaned = normalizeMedicineResult(data || {});
        if (!cleaned.brand) return res.json({});
        res.json(cleaned);
    } catch (e) {
        console.error('medicine validate error:', e?.message || e);
        res.status(500).json({});
    }
};
