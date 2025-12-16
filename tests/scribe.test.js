import { jest } from '@jest/globals';
import request from 'supertest';

// Mock all dependencies
jest.unstable_mockModule('../src/services/llm.service.js', () => ({
    runLlmTask: jest.fn()
}));

jest.unstable_mockModule('../src/database.js', () => ({
    getProviderSettings: jest.fn().mockResolvedValue({}),
    getUser: jest.fn(),
    getUserById: jest.fn(),
    getCredits: jest.fn()
}));

// Mock bcryptjs for login flow
jest.unstable_mockModule('bcryptjs', () => ({
    default: {
        compareSync: jest.fn(() => true), // Always password match
        hashSync: jest.fn(() => 'hashed')
    }
}));

const { app } = await import('../src/app.js');
const llmService = await import('../src/services/llm.service.js');
const db = await import('../src/database.js');

describe('Scribe Endpoint Tests', () => {
    let agent;

    beforeEach(async () => {
        jest.clearAllMocks();
        agent = request.agent(app);

        // Mock Login to establish session
        db.getUser.mockResolvedValue({ id: 100, phone: 'testuser', password: 'hashed' });
        await agent.post('/api/login').send({ phone: 'testuser', password: 'any' });
    });

    it('POST /api/review should return reviewed html', async () => {
        const mockHtml = "<p>Draft Prescription</p>";
        const mockResponse = "Review: <b>Better Prescription</b>";

        llmService.runLlmTask.mockResolvedValue({ raw: mockResponse });

        const res = await agent
            .post('/api/review')
            .send({ html: mockHtml });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.reviewed).toContain("Better Prescription");
        expect(llmService.runLlmTask).toHaveBeenCalledWith('review', expect.any(String));
    });

    it('POST /api/format should return structured data', async () => {
        const mockHtml = "Rx Data";
        const mockRawJson = JSON.stringify({
            html: "<table>Formatted</table>",
            sections: { medicines: [] }
        });

        llmService.runLlmTask.mockResolvedValue({
            raw: mockRawJson,
            provider: 'test',
            model: 'test-model'
        });

        const res = await agent
            .post('/api/format')
            .send({ html: mockHtml });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.formatted).toContain("<table>Formatted</table>");
        expect(res.body.structured).toBeDefined();
    });
});
