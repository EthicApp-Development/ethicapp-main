// tests/groupByResponsesRanking5Options.test.js
const request = require('supertest');
const app = require('../../testApi');
const API = process.env.API_VERSION_PATH_PREFIX || '/api/v2';

const {
  Group,
  groupUser,
  Question,
  Response
} = require('../../models');
//console.log('TEST  → models.resolve:', require.resolve('../../models'));

jest.mock('../../config/socket.config.js', () => ({
  studentNotifications: { phaseTransition: jest.fn() }
}));
const { studentNotifications } = require('../../config/socket.config.js');

const userData = require('../fixtures/users.json');

describe('POST /activities/:id/init_next_phase (group by ranking diverseResponses)', () => {
  let token, userId, sessionId, designId, activityId, phase1Id;
  const studentIds = [];

  beforeAll(async () => {
    // 1) Create professor and login
    const prof = userData[0];
    await request(app)
      .post(`${API}/users`)
      .send({ ...prof, pass_confirmation: prof.pass });
    const loginRes = await request(app)
      .post(`${API}/authenticate_client`)
      .send({ mail: prof.mail, pass: prof.pass });
    token = loginRes.body.token;
    userId = loginRes.body.userId;

    //console.log('Punto 1: Profesor creado y autenticado');

    // 2) Create session
    const sRes = await request(app)
      .post(`${API}/sessions`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: `Session ranking (5-options)` ,
        descr: 'Test ranking 5 options diverse',
        status: 1,
        type: 'A',
        time: new Date(),
        creator: userId
      });
    sessionId = sRes.body.data.id;
    //console.log('Punto 2: Sesión creada');

    // 3) Crear 10 alumnos y añadir a la sesión (sin usar userData más allá de los primeros)
    const dummyPass = 'Test1234!';
    for (let idx = 0; idx < 10; idx++) {
    // Genero un email único por alumno
    const email = `student${Date.now()}_${idx}@test.com`;
    // Creo el usuario
    await request(app)
        .post(`${API}/users`)
        .send({
        mail: email,
        pass: dummyPass,
        pass_confirmation: dummyPass,
        rut: `1${10000000 + idx}`,      // cualquier rut válido
        name: `Student ${idx}`          // si tu endpoint lo requiere
        });
    // Login del alumno
    const stuLogin = await request(app)
        .post(`${API}/authenticate_client`)
        .send({ mail: email, pass: dummyPass });
    const stuId = stuLogin.body.userId;
    studentIds.push(stuId);
    // Lo agrego a la sesión
    await request(app)
        .post(`${API}/sessions/${sessionId}/users`)
        .send({ user_id: stuId });
    }

    //console.log('Punto 3: 10 alumnos creados y añadidos a la sesión');

    // 4) Create design with two phases
    const dRes = await request(app)
      .post(`${API}/designs`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        creator: userId,
        design: {
          roles: [],
          phases: [
            { number: 1, mode: 'individual', anonymous: false, chat: false },
            { number: 2, mode: 'group', anonymous: false, chat: false,
              stdntAmount: 3, grouping_algorithm: 'diverseResponses', heteroQuestionIndex: null }
          ]
        },
        public: true,
        locked: false
      });
    designId = dRes.body.data.id;
    //console.log('Punto 4: Diseño creado con stdntAmount 3 y algoritmo diverseResponses');

    // 5) Start the activity
    const aRes = await request(app)
      .post(`${API}/activities/start`)
      .set('Authorization', `Bearer ${token}`)
      .send({ session: sessionId, design: designId });
    activityId = aRes.body.data.activity.id;
    //console.log('Punto 5: Actividad iniciada');

    // 6) INIT PHASE 1
    const phase1Res = await request(app)
      .post(`${API}/activities/${activityId}/init_next_phase`)
      .set('Authorization', `Bearer ${token}`)
      .send();
    expect(phase1Res.status).toBe(201);
    expect(phase1Res.body.data.number).toBe(1);
    phase1Id = phase1Res.body.data.id;
    //console.log('Punto 6: Fase 1 iniciada');

    // 7) Seed one ranking question (5 options)
    const question = await Question.create({
      session_id: sessionId,
      phase_id: phase1Id,
      number: 1,
      type: 'ranking',
      text: 'Ranking 5-options question',
      content: {}
    });
    //console.log('Punto 7: Pregunta de ranking (5 valores) creada');

    // 8) Seed ranking responses: each student a rotated [1,2,3,4,5]
    const base = [1,2,3,4,5];
    const responses = studentIds.map((sid, idx) => ({
      user_id: sid,
      question_id: question.id,
      content: {},
      type: 'ranking',
      score: [
        base[(idx+0)%5], base[(idx+1)%5], base[(idx+2)%5],
        base[(idx+3)%5], base[(idx+4)%5]
      ]
    }));
    await Response.bulkCreate(responses);
    const inserted = await Response.findAll({ where: { question_id: question.id }, raw: true });
    //console.log('>>> inserted ranking responses:', inserted);
    //console.log('Punto 8: Respuestas de ranking creadas para cada alumno');
  });

  it('creates three groups clustering by ranking diverseResponses', async () => {
    // Trigger Phase 2 grouping
    const phase2Res = await request(app)
      .post(`${API}/activities/${activityId}/init_next_phase`)
      .set('Authorization', `Bearer ${token}`)
      .send();
    expect(phase2Res.status).toBe(201);
    expect(phase2Res.body.data.number).toBe(2);

    // Verify that three groups were created
    const groups = await Group.findAll({ where: { session_id: sessionId }, raw: true });
    expect(groups).toHaveLength(3);

    // Collect and print actual member sets
    const actualSets = await Promise.all(
      groups.map(({ id }) =>
        groupUser.findAll({ where: { group_id: id }, attributes: ['user_id'], raw: true })
          .then(rows => rows.map(r => r.user_id).sort())
      )
    );
    //console.log('Final groups:', actualSets);

    // Ensure every student is in exactly one group
    const allMembers = actualSets.flat().sort();
    expect(allMembers).toEqual(expect.arrayContaining(studentIds.sort()));
    expect(allMembers).toHaveLength(studentIds.length);
  });
});
