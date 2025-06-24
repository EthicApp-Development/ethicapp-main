// tests/groupByResponses.test.js
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

describe.each([
  ['similarResponses', 'similarity'],
  ['diverseResponses', 'diversity']
])('POST /activities/:id/init_next_phase (group by response %s)', (algorithm, desc) => {
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

    // 4) Create design with two phases:
    //    Phase 1: individual (to collect responses)
    //    Phase 2: group with our algorithm
    const dRes = await request(app)
      .post(`${API}/designs`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        creator: userId,
        design: {
          roles: [], 
          phases: [
            {
              number: 1,
              mode: 'individual',
              anonymous: false,
              chat: false,
              prevPhasesResponse: []
            },
            {
              number: 2,
              mode: 'group',
              anonymous: false,
              chat: false,
              prevPhasesResponse: [1],
              stdntAmount: 2,
              grouping_algorithm: algorithm,
              heteroQuestionIndex: null
            }
          ]
        },
        public: true,
        locked: false
      });
    designId = dRes.body.data.id;

    //console.log("Punto 1: Profesor creado y autenticado");
    //await new Promise(resolve => setTimeout(resolve, 1000)); // 100 ms
    // 2) Create session
    const sRes = await request(app)
      .post(`${API}/sessions`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: `Session response groups (${desc})`,
        descr: `Test by ${desc}`,
        status: 1,
        type: 'A',
        time: new Date(),
        creator: userId
      });
    sessionId = sRes.body.data.id;

    // 3) Create 4 students and add to session
    for (let i = 3; i <= 6; i++) {
      const stu = userData[i];
      await request(app).post(`${API}/users`).send({ ...stu, pass_confirmation: stu.pass });
      const stuLogin = await request(app)
        .post(`${API}/authenticate_client`)
        .send({ mail: stu.mail, pass: stu.pass });
      const stuId = stuLogin.body.userId;
      studentIds.push(stuId);
      await request(app)
        .post(`${API}/sessions/${sessionId}/users`)
        .send({ user_id: stuId });
    }

    //console.log("Punto 3: Alumnos creados y añadidos a la sesión");

    

    //console.log("Punto 4: Diseño creado con dos fases");

    // 5) Start the activity
    const aRes = await request(app)
      .post(`${API}/activities/start`)
      .set('Authorization', `Bearer ${token}`)
      .send({ session: sessionId, design: designId });
    activityId = aRes.body.data.activity.id;

    //console.log("Punto 5: Actividad iniciada");

    // 6) INIT PHASE 1
    const phase1Res = await request(app)
      .post(`${API}/activities/${activityId}/init_next_phase`)
      .set('Authorization', `Bearer ${token}`)
      .send();
    expect(phase1Res.status).toBe(201);
    expect(phase1Res.body.data.number).toBe(1);
    phase1Id = phase1Res.body.data.id;


    //console.log("Punto 6: Fase 1 iniciada");
    // 7) Seed dos preguntas para Fase 1
    const question1 = await Question.create({
      session_id: sessionId,
      phase_id:   phase1Id,
      number:     1,
      type:       'numeric',
      text:       'Auto‐generated test question 1',
      content:    {}
    });

    const question2 = await Question.create({
      session_id: sessionId,
      phase_id:   phase1Id,
      number:     2,
      type:       'numeric',
      text:       'Auto‐generated test question 2',
      content:    {}
    });

    //console.log("Punto 7: Dos preguntas creadas para la fase 1");

    // 8) Seed respuestas para cada alumno y cada pregunta:
    //    - Para question1: scores [1] o [10]
    //    - Para question2: scores [2] o [20]
    const responses = [];
    studentIds.forEach((sid, idx) => {
      // Si idx es par → respuestas bajas; si idx es impar → respuestas altas
      const score1 = idx % 2 === 0 ? 1 : 10;
      const score2 = idx % 2 === 0 ? 2 : 20;
      responses.push({
        user_id:     sid,
        question_id: question1.id,
        content:     {},
        type:        'numeric',
        score:       [ score1 ]
      });
      responses.push({
        user_id:     sid,
        question_id: question2.id,
        content:     {},
        type:        'numeric',
        score:       [ score2 ]
      });
    });
    await Response.bulkCreate(responses);

    const inserted = await Response.findAll({
      where: { question_id: [question1.id, question2.id] },
      raw: true
    });
    //console.log('>>> inserted responses:', inserted);

    //console.log("Punto 8: Respuestas creadas para cada pregunta y cada alumno");
  });

  

  it(`creates two groups clustering by response ${algorithm}`, async () => {
    // Trigger Phase 2 grouping
    const phase2Res = await request(app)
      .post(`${API}/activities/${activityId}/init_next_phase`)
      .set('Authorization', `Bearer ${token}`)
      .send();
    expect(phase2Res.status).toBe(201);
    expect(phase2Res.body.data.number).toBe(2);

    // Verify that two groups were created
    const groups = await Group.findAll({
      where: { session_id: sessionId },
      attributes: ['id'],
      raw: true
    });
    expect(groups).toHaveLength(2);

    // Collect actual member sets
    const actualSets = await Promise.all(
      groups.map(({ id }) =>
        groupUser.findAll({
          where: { group_id: id },
          attributes: ['user_id'],
          raw: true
        }).then(rows => rows.map(r => r.user_id).sort())
      )
    );

    // Build expected clusters: students at even indices vs odd
    const lowCluster  = [ studentIds[0], studentIds[2] ].sort();
    const highCluster = [ studentIds[1], studentIds[3] ].sort();
    const expectedSets = [ lowCluster, highCluster ];

    expect(actualSets).toEqual(
      expect.arrayContaining(expectedSets)
    );
  });
});
