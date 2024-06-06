const request = require('supertest');
const app = require('../../testApi');
const { User, Session } = require('../../models');
const jwt = require('jsonwebtoken');
const API_VERSION_PATH_PREFIX = process.env.API_VERSION_PATH_PREFIX || '/api/v2';

const userData = require('../fixtures/users.json');

describe('Integration Test', () => {
  let professorToken;
  let studentToken;
  let activityId;
  let phaseId;
  let student;
  let profesorId;
  let question_id;

  beforeAll(async () => {
    // Create a user
    const professorExample = userData[7];
    const professorIdResponse = await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/users`)
      .send(professorExample);
    //console.log('professorIdResponse:', professorIdResponse.body);
    profesorId = professorIdResponse.body.data?.id;

    if (!profesorId) {
      throw new Error('Failed to create professor');
    }

    // Login to get the token Professor
    const loginResProfessor = await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/authenticate_client`)
      .send({ mail: professorExample.mail, pass: professorExample.pass });
    professorToken = loginResProfessor.body.token;

    if (!professorToken) {
      throw new Error('Failed to authenticate professor');
    }

    const studentExample = userData[8];
    const studentResponse = await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/users`)
      .send(studentExample);
    student = studentResponse.body.data;

    // Login to get the token Student
    const loginResStudent = await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/authenticate_client`)
      .send({ mail: studentExample.mail, pass: studentExample.pass });
    studentToken = loginResStudent.body.token;

    if (!studentToken) {
      throw new Error('Failed to authenticate student');
    }
    // create a Design
    const designResponse = await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/designs`)
      .send({
        creator: profesorId,
        design: {
          phases: [
            {
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
                },
                {
                  content: {
                    question: "¿Cuantos continentes hay actualmente",
                    options: ["5", "7", "10", "11", "1"],
                    correct_answer: "5"
                  },
                  additional_info: "Geografia",
                  type: "choice",
                  text: "preguntas sobre los continentes",
                  session_id: 1,
                  number: 2
                }
              ]
            },
            {
              number: 2,
              question: [
                {
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
                }
              ]
            }
          ]
        },
        public: true,
        locked: false
      });
    // Create an activity

    const sessionResponse = await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/sessions`)
      .send({
        name: 'Session de integracion relevante',
        descr: 'ejemplo de una session en el siguiente flujo',
        status: 1,
        creator: profesorId,
        type: 'E',
        time: new Date(),
      })
      .set('Authorization', `Bearer ${professorToken}`);
    //console.log(loginResStudent.body)
    //console.log('sessionResponse:', sessionResponse.body);
    const sessionId = sessionResponse.body.data.id;
    //console.log(sessionResponse.body)
    if (!sessionId) {
      throw new Error('Failed to create session');
    }


    //console.log('designResponse:', designResponse.body);
    const designId = designResponse.body.data?.id;

    if (!designId) {
      throw new Error('Failed to create design');
    }

    const activityResponse = await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/activity`)
      .send({ design: designId, session: sessionId })
      .set('Authorization', `Bearer ${professorToken}`);
    //console.log('activityResponse:', activityResponse.body);
    activityId = activityResponse.body.data?.id;

    if (!activityId) {
      throw new Error('Failed to create activity');
    }

    // Create phase
    const phaseResponse = await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/phases`)
      .send({
        number: 3,
        type: 'intento de test',
        anon: true,
        chat: false,
        prev_ans: 'test de integracion',
        activity_id: activityId
      })
      .set('Authorization', `Bearer ${professorToken}`);
    //console.log('phaseResponse:', phaseResponse.body);
    phaseId = phaseResponse.body.data?.id;

    if (!phaseId) {
      throw new Error('Failed to create phase');
    }

    // Create Question
    const questionResponse = await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/questions`)
      .send({
        content: {
          question: "¿Cuantos oceanos hay actualmente",
          options: ["5", "7", "10", "11", "1"],
          correct_answer: "5"
        },
        additional_info: "Geografia",
        type: "choice",
        text: "preguntas sobre el oceano",
        session_id: sessionId,
        number: 1,
        phase_id: phaseId
      })
      .set('Authorization', `Bearer ${professorToken}`)
      .expect(201);
    //console.log('questionResponse:', questionResponse.body);
    question_id = questionResponse.body.data?.id;

    if (!question_id) {
      throw new Error('Failed to create question');
    }
  });

  it('Professor can go to the next phase', async () => {
    const res = await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/activities/${activityId}/init_next_phase`)
      .set('Authorization', `Bearer ${professorToken}`)
      .expect(201);

    expect(res.body.status).toBe('success');
    expect(res.body.data).toHaveProperty('id');
    phaseId = res.body.data.id;
  });

  it('Student can get the current phase and question', async () => {
    const res = await request(app)
      .get(`${API_VERSION_PATH_PREFIX}/phases/${phaseId}/questions`)
      .set('Authorization', `Bearer ${professorToken}`)
      .expect(200);

    expect(res.body.status).toBe('success');
    expect(res.body.data).toBeInstanceOf(Array);
  });
  it('error when using duplicate a phase with the same number', async () => {
    const errorPhase = await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/phases`)
      .send({
        number: 2,
        type: 'intento de test',
        anon: true,
        chat: false,
        prev_ans: 'test de integracion',
        activity_id: activityId
      })
      .set('Authorization', `Bearer ${professorToken}`);
    //console.log(errorPhase.body)
    expect(errorPhase.body.status).toBe('error')
    expect(errorPhase.body.message).toBe('Phase number already exists in the design')
  })
  it('Student can create a response and send', async () => {
    const responseData = {
      user_id: student.id,
      content: { answer: 'Spiderman' },
      type: 'choice',
      questionId: question_id
    };

    const res = await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/questions/${question_id}/responses`)
      .set('Authorization', `Bearer ${studentToken}`)
      .send(responseData)
      .expect(201);

    expect(res.body.status).toBe('success');
    expect(res.body.data).toHaveProperty('id');
  });
});
