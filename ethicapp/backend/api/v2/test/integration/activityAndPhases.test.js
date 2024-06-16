const request = require('supertest');
const app = require('../../testApi'); // Ajusta la ruta según sea necesario
const API_VERSION_PATH_PREFIX = process.env.API_VERSION_PATH_PREFIX || '/api/v2';
const jwt = require('jsonwebtoken');
const userData = require('../fixtures/users.json')

describe('Activities and Phases API', () => {
    let token, activityId, phaseId;

    beforeAll(async () => {

        // Autenticar al profesor
        const professorExample = userData[9]
        await request(app)
            .post(`${API_VERSION_PATH_PREFIX}/users`)
            .send(professorExample)

        const loginRes = await request(app)
            .post(`${API_VERSION_PATH_PREFIX}/authenticate_client`)
            .send({ mail: userData[9].mail, pass: userData[9].pass });
        //console.log(loginRes.body)
        token = loginRes.body.token;
        console.log(loginRes.body)
        await request(app)
            .post(`${API_VERSION_PATH_PREFIX}/designs`)
            .send({
                creator: loginRes.body.userId,
                design: {
                    phases: [{
                        number: 1,
                        question: [
                            {
                                content: {
                                    question: "¿Cuantos oceanos hay actualmente",
                                    options: ["5", "7", "10", "11", "1"],
                                    correct_answer: "5"
                                },
                                additional_info: "Geografia",
                                type: "choice",
                                text: "preguntas sobre el oceano",
                                session_id: 1,
                                number: 1
                            }
                        ]
                    }, {
                        number: 1,
                        question: [{
                            content: {
                                question: "¿asdffasd dsffds sd fsdf",
                                options: ["dsf", "qw", "1wer", "1er1", "1e"],
                                correct_answer: "qw"
                            },
                            additional_info: "cosas",
                            type: "choice",
                            text: "preguntas sobre las cosas",
                            session_id: 1,
                            number: 1
                        }]
                    }]
                },
                public: true,
                locked: false
            })
        // Crear una actividad para la sesión
        const sessionRes = await request(app)
            .post(`${API_VERSION_PATH_PREFIX}/sessions`)
            .set('Authorization', `Bearer ${token}`)
            .send({
                name: 'Test Session',
                descr: 'Description',
                status: 1,
                type: 'A',
                time: new Date(),
                creator: loginRes.body.userId
            });


        activityId = sessionRes.body.data.activity.id;
        //console.log(activityId)
        await request(app)
            .post(`${API_VERSION_PATH_PREFIX}/phases`)
            .send({
                number: 1,
                type: "Phase in Test",
                anon: true,
                chat: false,
                prev_ans: "somethings",
                activity_id: activityId
            })

        //console.log(activityId)
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
    // it('should not initiate the same phase twice', async () => {
    //     const res = await request(app)
    //         .post(`${API_VERSION_PATH_PREFIX}/activities/${activityId}/init_next_phase`)
    //         .set('Authorization', `Bearer ${token}`)
    //         .expect(400);

    //     expect(res.body.status).toBe('error');
    //     expect(res.body.message).toBe('Phase already initiated');
    // });

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
