const request = require('supertest');
const app = require('../../backend/api/v2/testApi'); // Asegúrate de que apunta a tu aplicación Express
const { User, Session  } = require('../../backend/api/v2/models');

describe('POST /api-v2/sessions/users', () => {
    let token;

    beforeAll(async () => {
        // Create a user
        await User.create({
            name: 'Test User',
            rut: '12345678-9',
            pass: 'password',
            pass_confirmation: 'password',
            mail: 'testuser@example.com',
            sex: 'M',
            role: 'A',
        });

        // Login to get the token
        const loginRes = await request(app)
            .post('/login/user_session')
            .send({ mail: 'testuser@example.com', pass: 'password' });

        token = loginRes.body.token;
        console.log('token -->', token); // Ensure the token is obtained correctly
    });

    it('should add a user to a session', async () => {
        // Create a session first
        const sessionRes = await request(app)
            .post('/sessions')
            .send({ name: 'Test Session', descr: 'A session for testing', creator: 1, type: 'A' });

        const sessionCode = sessionRes.body.data.code;

        // Add a user to the session
        const userRes = await request(app)
            .post('/api-v2/sessions/users')
            .send({ code: sessionCode, user_id: 1 })
            .set('Authorization', `Bearer ${token}`);

        expect(userRes.status).toBe(201);
        expect(userRes.body.data).toHaveProperty('session_id');
        expect(userRes.body.data).toHaveProperty('user_id');

        // Verify the user is in the session
        const usersRes = await request(app)
            .get(`/api-v2/sessions/${userRes.body.data.session_id}/users`)
            .set('Authorization', `Bearer ${token}`);

        expect(usersRes.status).toBe(200);
        expect(usersRes.body.data).toContain(1);
    });
});