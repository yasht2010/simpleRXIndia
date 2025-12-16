import { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';

dotenv.config();

const S3_REGION = process.env.AWS_REGION;
const S3_BUCKET = process.env.S3_BUCKET;
const S3_CLEANUP_MAX_AGE_HOURS = Number(process.env.S3_CLEANUP_MAX_AGE_HOURS || 24);

let s3Client = null;

if (S3_REGION && S3_BUCKET) {
    s3Client = new S3Client({
        region: S3_REGION,
        credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY ? {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
        } : undefined
    });
}

export const generateUploadUrl = async (userId, contentType) => {
    if (!s3Client) throw new Error("S3 not configured");

    // Normalize content type
    const normalizedContentType = contentType === 'video/webm' ? 'audio/webm' : contentType;
    const isAudio = normalizedContentType && normalizedContentType.startsWith('audio/');

    if (!isAudio) throw new Error("Invalid content type");

    const ext = audioExtForContentType(normalizedContentType);
    const key = `uploads/${userId}/${Date.now()}-${uuidv4()}${ext}`;

    const command = new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
        ContentType: normalizedContentType
    });

    const url = await getSignedUrl(s3Client, command, { expiresIn: 300 });
    return { url, key, expiresIn: 300 };
};

export const scheduleCleanup = () => {
    if (!s3Client || !S3_CLEANUP_MAX_AGE_HOURS) return;
    const intervalMs = 3 * 60 * 60 * 1000; // every 3 hours

    const run = async () => {
        console.log("🧹 Starting S3 cleanup...");
        const cutoff = Date.now() - S3_CLEANUP_MAX_AGE_HOURS * 60 * 60 * 1000;
        let deleted = 0;
        let checked = 0;
        let token;
        try {
            do {
                const resp = await s3Client.send(new ListObjectsV2Command({
                    Bucket: S3_BUCKET,
                    Prefix: 'uploads/',
                    ContinuationToken: token
                }));
                const objs = resp.Contents || [];
                const stale = objs
                    .filter(o => o.LastModified && o.LastModified.getTime() < cutoff)
                    .map(o => ({ Key: o.Key }));
                checked += objs.length;
                token = resp.IsTruncated ? resp.NextContinuationToken : undefined;
                if (stale.length) {
                    const del = await s3Client.send(new DeleteObjectsCommand({
                        Bucket: S3_BUCKET,
                        Delete: { Objects: stale, Quiet: true }
                    }));
                    deleted += del?.Deleted?.length || 0;
                }
            } while (token);
            if (checked) {
                console.log(`🧹 S3 cleanup: checked ${checked}, deleted ${deleted}, maxAgeHrs=${S3_CLEANUP_MAX_AGE_HOURS}`);
            }
        } catch (err) {
            console.error('S3 cleanup error:', err);
        }
    };

    run();
    setInterval(run, intervalMs);
};

// Helper
const audioExtForContentType = (ct = '') => {
    const lower = ct.toLowerCase();
    if (lower.includes('wav')) return '.wav';
    if (lower.includes('mpeg')) return '.mp3';
    if (lower.includes('mp4') || lower.includes('m4a')) return '.m4a';
    if (lower.includes('ogg')) return '.ogg';
    if (lower.includes('webm')) return '.webm';
    return '.webm';
};

export const getClient = () => s3Client;
