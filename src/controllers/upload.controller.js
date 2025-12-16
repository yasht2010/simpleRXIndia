import * as s3Service from '../services/s3.service.js';

export const getUploadUrl = async (req, res) => {
    try {
        if (!req.session.userId) return res.status(401).json({ error: "Unauthorized" });
        const { contentType } = req.body || {};

        const result = await s3Service.generateUploadUrl(req.session.userId, contentType);
        res.json(result);
    } catch (e) {
        if (e.message === "Invalid content type") {
            return res.status(400).json({ error: e.message });
        }
        if (e.message === "S3 not configured") {
            return res.status(500).json({ error: e.message });
        }
        console.error("Presign error:", e);
        res.status(500).json({ error: "Failed to generate upload URL" });
    }
};
