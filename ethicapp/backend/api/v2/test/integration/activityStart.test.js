const request = require('supertest');
const bcrypt = require('bcryptjs');
const app = require('../../testApi');
const API_VERSION_PATH_PREFIX = process.env.API_VERSION_PATH_PREFIX || '/api/v2';
const userData = require('../fixtures/users.json');

describe('POST /activities/start', () => {
    let token, userId, sessionId, designId;

    beforeAll(async () => {
        const professor = userData[9];
      
        // Create User
        await request(app)
          .post(`${API_VERSION_PATH_PREFIX}/users`)
          .send({
            ...professor,
            pass_confirmation: professor.pass
          });
      
        // Login
        const loginRes = await request(app)
          .post(`${API_VERSION_PATH_PREFIX}/authenticate_client`)
          .send({ mail: professor.mail, pass: professor.pass });
      
      
        token = loginRes.body.token;
        userId = loginRes.body.userId;
      
        // Create desing
        const designRes = await request(app)
          .post(`${API_VERSION_PATH_PREFIX}/designs`)
          .set('Authorization', `Bearer ${token}`)
          .send({
            creator: userId,
            design: {
              type: "semantic_differential",
              phases: [
                {
                  mode: "individual",
                  anonymous: true,
                  chat: false,
                  prevPhasesResponse: []
                }
              ]
            },
            public: true,
            locked: false
          });
      
        if (designRes.body.status !== 'success') {
          throw new Error('Design creation failed: ' + designRes.body.message);
        }
      
        designId = designRes.body.data.id;
      
        // Close Session
        const sessionRes = await request(app)
          .post(`${API_VERSION_PATH_PREFIX}/sessions`)
          .set('Authorization', `Bearer ${token}`)
          .send({
            name: 'Session for Activity Start',
            descr: 'Testing activity start endpoint',
            status: 1,
            type: 'A',
            time: new Date(),
            creator: userId
          });
      
      
        if (sessionRes.body.status !== 'success') {
          throw new Error('Session creation failed: ' + sessionRes.body.message);
        }
      
        sessionId = sessionRes.body.data.id;
      });
      

    it('should create an activity and its first phase', async () => {
        const res = await request(app)
            .post(`${API_VERSION_PATH_PREFIX}/activities/start`)
            .set('Authorization', `Bearer ${token}`)
            .send({
                session: sessionId,
                design: designId
            })
            .expect(201);

        expect(res.body.status).toBe('success');
        expect(res.body.data.activity).toHaveProperty('id');
        expect(res.body.data.firstPhase.number).toBe(1);
        expect(res.body.data.firstPhase.chat).toBe(false);
        expect(res.body.data.firstPhase.anon).toBe(true);
    });

    it('should fail if session does not belong to user', async () => {
        const otherUser = { ...userData[8] };
        const hashedPass = bcrypt.hashSync(otherUser.pass, 10);
        otherUser.pass = hashedPass;
        otherUser.pass_confirmation = hashedPass;

        await request(app)
            .post(`${API_VERSION_PATH_PREFIX}/users`)
            .send(otherUser);

        const loginRes = await request(app)
            .post(`${API_VERSION_PATH_PREFIX}/authenticate_client`)
            .send({ mail: userData[8].mail, pass: userData[8].pass });

        const otherToken = loginRes.body.token;

        const res = await request(app)
            .post(`${API_VERSION_PATH_PREFIX}/activities/start`)
            .set('Authorization', `Bearer ${otherToken}`)
            .send({
                session: sessionId,
                design: designId
            })
            .expect(403);

        expect(res.body.status).toBe('error');
    });
});
