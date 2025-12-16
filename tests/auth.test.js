import { jest } from '@jest/globals';
import request from 'supertest';

// Use unstable_mockModule for ESM support BEFORE importing app
jest.unstable_mockModule('../src/database.js', () => ({
    getUser: jest.fn(),
    createUser: jest.fn(),
    createUserWithDetails: jest.fn(),
    getUserById: jest.fn(),
    getCredits: jest.fn()
}));

// Mock bcryptjs
jest.unstable_mockModule('bcryptjs', () => ({
    default: {
        compareSync: jest.fn((pass, hash) => pass === "password123"),
        hashSync: jest.fn(() => 'hashed_password')
    }
}));

// Dynamic imports are needed after mockModule
const { app } = await import('../src/app.js');
const db = await import('../src/database.js');
const bcrypt = await import('bcryptjs'); // not used directly but good to ensure loaded

describe('Auth Routes', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('POST /api/login', () => {
        it('should login successfully with correct credentials', async () => {
            db.getUser.mockResolvedValue({ id: 1, phone: '1234567890', password: 'hashed_password' });

            const res = await request(app)
                .post('/api/login')
                .send({ phone: '1234567890', password: 'password123' });

            expect(res.body).toEqual({ success: true });
            expect(res.headers['set-cookie']).toBeDefined(); // Session cookie
        });

        it('should fail with incorrect password', async () => {
            db.getUser.mockResolvedValue({ id: 1, phone: '1234567890', password: 'hashed_password' });

            // Using "wrongpass" which our mock compareSync will reject
            const res = await request(app)
                .post('/api/login')
                .send({ phone: '1234567890', password: 'wrongpass' });

            expect(res.body).toEqual({ success: false, message: "Invalid" });
        });

        it('should fail if user does not exist', async () => {
            db.getUser.mockResolvedValue(null);

            const res = await request(app)
                .post('/api/login')
                .send({ phone: '9999999999', password: 'password123' });

            expect(res.body).toEqual({ success: false, message: "Invalid" });
        });
    });

    describe('POST /api/register', () => {
        it('should register a new user successfully', async () => {
            db.createUser.mockResolvedValue(true);

            const res = await request(app)
                .post('/api/register')
                .send({ phone: '9876543210', password: 'password123' });

            expect(res.body).toEqual({ success: true });
            expect(db.createUser).toHaveBeenCalledWith('9876543210', 'password123');
        });

        it('should handle existing user registration attempt', async () => {
            db.createUser.mockRejectedValue(new Error('Duplicate'));

            const res = await request(app)
                .post('/api/register')
                .send({ phone: '1234567890', password: 'password123' });

            expect(res.body).toEqual({ success: false, message: "Exists" });
        });
    });

    // Additional tests for OTP flow can be added here
});
