const request = require('supertest');
const app = require('../../testApi'); // Ajusta la ruta según sea necesario
const API_VERSION_PATH_PREFIX = process.env.API_VERSION_PATH_PREFIX || '/api/v2';
const jwt = require('jsonwebtoken');
const userData = require('../fixtures/users.json')

describe('Activities and Phases API', () => {
    let token, activityId, phaseId;

    beforeAll(async () => {

        // Autenticar al profesor
        const loginRes = await request(app)
            .post(`${API_VERSION_PATH_PREFIX}/login_user`)
            .send({ mail: userData[9].mail, pass: userData[9].pass });
        console.log(loginRes.body)
        token = loginRes.body.token;

        // Crear una actividad para la sesión
        const sessionRes = await request(app)
            .post(`${API_VERSION_PATH_PREFIX}/sessions/creator/1`)
            .set('Authorization', `Bearer ${token}`)
            .send({ name: 'Test Session', descr: 'Description', status: 1, type: 'A' });

        activityId = sessionRes.body.data.activity;
        console.log(activityId)
    });
    it('should list all phases in an activity', async () => {
        const res = await request(app)
            .get(`${API_VERSION_PATH_PREFIX}/activities/${activityId}/phases`)
            .set('Authorization', `Bearer ${token}`)
            .expect(200);

        expect(res.body.status).toBe('success');
        expect(res.body.data).toBeInstanceOf(Array);
    });

    it('should initiate the next phase in the design', async () => {
        const res = await request(app)
            .post(`${API_VERSION_PATH_PREFIX}/activities/${activityId}/init_next_phase`)
            .set('Authorization', `Bearer ${token}`)
            .expect(201);

        expect(res.body.status).toBe('success');
        expect(res.body.data).toHaveProperty('id');
        phaseId = res.body.data.id;
    });

    it('should update an existing phase', async () => {
        const res = await request(app)
            .put(`${API_VERSION_PATH_PREFIX}/phases/${phaseId}`)
            .set('Authorization', `Bearer ${token}`)
            .send({ anon: true })
            .expect(200);

        expect(res.body.status).toBe('success');
        expect(res.body.data.anon).toBe(true);
    });
});
