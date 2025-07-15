const request = require('supertest');
const bcrypt = require('bcryptjs');
const app = require('../../testApi');
const API_VERSION_PATH_PREFIX = process.env.API_VERSION_PATH_PREFIX || '/api/v2';
const userData = require('../fixtures/users.json');

describe('POST /activities/end', () => {
    let token, userId, sessionId, designId, activityId;

    beforeAll(async () => {
        // Create user (professor)
        const professor = { ...userData[9] };
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

        // Create design for the user
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

        // Create session
        const sessionRes = await request(app)
            .post(`${API_VERSION_PATH_PREFIX}/sessions`)
            .set('Authorization', `Bearer ${token}`)
            .send({
                name: 'Session for Activity End',
                descr: 'Testing activity end endpoint',
                status: 1,
                type: 'A',
                time: new Date(),
                creator: userId
            });

        if (sessionRes.body.status !== 'success') {
            throw new Error('Session creation failed: ' + sessionRes.body.message);
        }
        sessionId = sessionRes.body.data.id;

        // Start an activity using the design and session created
        const startRes = await request(app)
            .post(`${API_VERSION_PATH_PREFIX}/activities/start`)
            .set('Authorization', `Bearer ${token}`)
            .send({
                session: sessionId,
                design: designId
            });
        
        if (startRes.body.status !== 'success') {
            throw new Error('Activity start failed: ' + startRes.body.message);
        }
        activityId = startRes.body.data.activity.id;
    });

    it('should end an activity successfully', async () => {
        // End the activity
        const endRes = await request(app)
            .post(`${API_VERSION_PATH_PREFIX}/activities/end`)
            .set('Authorization', `Bearer ${token}`)
            .send({ activityId })
            .expect(200);

        expect(endRes.body.status).toBe('success');
        expect(endRes.body.message).toBe('Activity ended successfully');

        // Retrieve all activities and filter by the created activity id
        const activitiesRes = await request(app)
            .get(`${API_VERSION_PATH_PREFIX}/activity`)
            .set('Authorization', `Bearer ${token}`);

        // The GET endpoint returns an array of activities
        const updatedActivity = activitiesRes.body.data.find(act => act.id === activityId);
        expect(updatedActivity).toBeDefined();
        expect(updatedActivity.status).toBe('finished');
    });

    it('should return error if the session does not belong to the user', async () => {
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
            .post(`${API_VERSION_PATH_PREFIX}/activities/end`)
            .set('Authorization', `Bearer ${otherToken}`)
            .send({ activityId })
            .expect(403);

        expect(res.body.status).toBe('error');
    });
});
