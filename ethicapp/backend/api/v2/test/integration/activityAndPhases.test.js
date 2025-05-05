// tests/integration/activityAndPhases.test.js

const request = require('supertest');
const app = require('../../testApi'); // Ajusta la ruta según sea necesario
const API = process.env.API_VERSION_PATH_PREFIX || '/api/v2';
const userData = require('../fixtures/users.json');

jest.mock('../../config/socket.config.js', () => ({
  studentNotifications: {
    phaseTransition: jest.fn(),
  },
}));
const { studentNotifications } = require('../../config/socket.config.js');


describe('Activities and Phases API', () => {
  let token, designId, sessionId, activityId, phaseId;

  beforeAll(async () => {
    // 1) Crear y loguear profesor
    const prof = userData[9];
    await request(app)
      .post(`${API}/users`)
      .send({ ...prof, pass_confirmation: prof.pass });

    const loginRes = await request(app)
      .post(`${API}/authenticate_client`)
      .send({ mail: prof.mail, pass: prof.pass });

    token = loginRes.body.token;

    // 2) Crear un diseño
    const designRes = await request(app)
      .post(`${API}/designs`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        creator: loginRes.body.userId,
        design: {
          // aquí defines tus fases de diseño
          phases: [
            {
              number: 1,
              mode: "individual",
              question: [
                {
                  content: {
                    question: "¿Cuántos océanos hay actualmente?",
                    options: ["5", "7", "10"],
                    correct_answer: "5"
                  },
                  additional_info: "Geografía",
                  type: "choice",
                  text: "Preguntas sobre el océano",
                  number: 1
                }
              ]
            },
            {
              number: 2,
              mode: "individual",
              question: [
                {
                  content: {
                    question: "¿Cuál es la capital de Chile?",
                    options: ["Santiago", "Lima", "Buenos Aires"],
                    correct_answer: "Santiago"
                  },
                  additional_info: "Capitales",
                  type: "choice",
                  text: "Preguntas de capitales",
                  number: 1
                }
              ]
            }
          ]
        },
        public: true,
        locked: false
      });
    designId = designRes.body.data.id;

    // 3) Crear una sesión
    const sessionRes = await request(app)
      .post(`${API}/sessions`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Test Session',
        descr: 'Description',
        status: 1,
        type: 'A',
        time: new Date(),
        creator: loginRes.body.userId
      });
    sessionId = sessionRes.body.data.id;

    // 4) Iniciar la actividad con el diseño y la sesión
    const startRes = await request(app)
      .post(`${API}/activities/start`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        session: sessionId,
        design: designId
      });
    activityId = startRes.body.data.activity.id;
    // opcional: capturar la primera fase si la necesitas
    phaseId = startRes.body.data.firstPhase.id;
  });

  it('should list all phases in an activity', async () => {
    const res = await request(app)
      .get(`${API}/activities/${activityId}/phases`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.status).toBe('success');
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it('should initiate the next phase in the design', async () => {
    const res = await request(app)
      .post(`${API}/activities/${activityId}/init_next_phase`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    expect(res.body.status).toBe('success');
    expect(res.body.data).toHaveProperty('id');
    phaseId = res.body.data.id;
  });

  it('should update an existing phase', async () => {
    const newNumber = Math.floor(Math.random() * 1000000) + 1;
    const res = await request(app)
      .put(`${API}/phases/${phaseId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ 
        number: newNumber,
        anon: true,
        chat: true,
        mode: "individual",
      })
      .expect(200);

    expect(res.body.status).toBe('success');
    expect(res.body.data.anon).toBe(true);
    expect(res.body.data.number).toBe(newNumber);
  });

  it('should return the phases with their state', async () => {
    const res = await request(app)
      .get(`${API}/activities/${activityId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.status).toBe('success');
    expect(Array.isArray(res.body.data.phases)).toBe(true);
    expect(res.body.data.phases.length).toBeGreaterThan(0);

    res.body.data.phases.forEach(phase => {
      expect(phase).toHaveProperty('id');
      expect(phase).toHaveProperty('number');
      expect(phase).toHaveProperty('status');
      expect(typeof phase.number).toBe('number');
      expect(['inprogress', 'done']).toContain(phase.status);
    });
  });
});
