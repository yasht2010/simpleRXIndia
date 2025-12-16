import { jest } from '@jest/globals';
import request from 'supertest';

// Mock dependencies
jest.unstable_mockModule('../src/services/s3.service.js', () => ({
    generateUploadUrl: jest.fn(),
    scheduleCleanup: jest.fn()
}));

jest.unstable_mockModule('../src/database.js', () => ({
    getProviderSettings: jest.fn().mockResolvedValue({}),
    getUser: jest.fn(),
    getUserById: jest.fn(),
}));

jest.unstable_mockModule('bcryptjs', () => ({
    default: {
        compareSync: jest.fn(() => true), // Always password match
        hashSync: jest.fn(() => 'hashed')
    }
}));

const { app } = await import('../src/app.js');
const s3Service = await import('../src/services/s3.service.js');
const db = await import('../src/database.js');

describe('Upload Endpoint Tests', () => {
    let agent;

    beforeEach(async () => {
        jest.clearAllMocks();
        agent = request.agent(app);

        // Mock Login
        db.getUser.mockResolvedValue({ id: 100, phone: 'testuser', password: 'hashed' });
        await agent.post('/api/login').send({ phone: 'testuser', password: 'any' });
    });

    it('POST /api/upload-url should return presigned url', async () => {
        s3Service.generateUploadUrl.mockResolvedValue({
            url: "https://s3.aws.com/upload-key",
            key: "upload-key",
            expiresIn: 300
        });

        const res = await agent
            .post('/api/upload-url')
            .send({ contentType: 'audio/webm' });

        expect(res.status).toBe(200);
        expect(res.body.url).toBe("https://s3.aws.com/upload-key");
        expect(s3Service.generateUploadUrl).toHaveBeenCalledWith(100, 'audio/webm');
    });

    it('should reject invalid content type', async () => {
        s3Service.generateUploadUrl.mockRejectedValue(new Error("Invalid content type"));

        const res = await agent
            .post('/api/upload-url')
            .send({ contentType: 'image/png' });

        expect(res.status).toBe(400);
        expect(res.body.error).toBe("Invalid content type");
    });
});
