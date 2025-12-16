import { jest } from '@jest/globals';
import request from 'supertest';
import { Readable } from 'stream';

// Mock dependencies
jest.unstable_mockModule('../src/services/s3.service.js', () => ({
    getClient: jest.fn(),
    generateUploadUrl: jest.fn()
}));

jest.unstable_mockModule('../src/services/transcription.service.js', () => ({
    transcribe: jest.fn()
}));

jest.unstable_mockModule('../src/services/llm.service.js', () => ({
    runLlmTask: jest.fn()
}));

jest.unstable_mockModule('../src/database.js', () => ({
    getProviderSettings: jest.fn().mockResolvedValue({}),
    getUser: jest.fn(),
    deductCredit: jest.fn(),
    getCredits: jest.fn(),
    getMacros: jest.fn()
}));

jest.unstable_mockModule('bcryptjs', () => ({
    default: {
        compareSync: jest.fn(() => true),
        hashSync: jest.fn(() => 'hashed')
    }
}));

const { app } = await import('../src/app.js');
const s3Service = await import('../src/services/s3.service.js');
const transcriptionService = await import('../src/services/transcription.service.js');
const llmService = await import('../src/services/llm.service.js');
const db = await import('../src/database.js');

// Mock S3 Client send method
const mockSend = jest.fn();
s3Service.getClient.mockReturnValue({ send: mockSend });

describe('Process Endpoints', () => {
    let agent;

    beforeEach(async () => {
        jest.clearAllMocks();
        agent = request.agent(app);

        // Mock Login
        db.getUser.mockResolvedValue({ id: 100, phone: 'testuser', password: 'hashed' });
        await agent.post('/api/login').send({ phone: 'testuser', password: 'any' });
    });

    describe('POST /api/process-s3', () => {
        it('should process audio from S3 successfully', async () => {
            db.deductCredit.mockResolvedValue(true);
            db.getCredits.mockResolvedValue(49);
            db.getMacros.mockResolvedValue([]);

            // Mock S3 GetObject stream
            const mockStream = new Readable();
            mockStream.push('audio-content');
            mockStream.push(null);
            mockSend.mockResolvedValue({ Body: mockStream });

            transcriptionService.transcribe.mockResolvedValue("Transcribed text");
            llmService.runLlmTask.mockResolvedValue({ raw: "<b>Rx HTML</b>", provider: 'test', model: 'test' });

            const res = await agent
                .post('/api/process-s3')
                .send({ key: 'uploads/100/audio.webm' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.html).toContain("Rx HTML");
            expect(db.deductCredit).toHaveBeenCalledWith(100);
            expect(transcriptionService.transcribe).toHaveBeenCalled();
        });

        it('should handle insufficient credits', async () => {
            db.deductCredit.mockResolvedValue(false);

            const res = await agent
                .post('/api/process-s3')
                .send({ key: 'uploads/100/audio.webm' });

            expect(res.status).toBe(402);
        });
    });

    // We skip process-backup full integration test because it involves file uploads which are tricky in supertest + mock modules logic sometimes
    // But we can try a basic one.
});
