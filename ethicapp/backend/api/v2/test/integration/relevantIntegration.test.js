const request = require('supertest');
const app = require('../../testApi'); // Asegúrate de que apunta a tu aplicación Express
const { User, Session } = require('../../models');
const jwt = require('jsonwebtoken');
const API_VERSION_PATH_PREFIX = process.env.API_VERSION_PATH_PREFIX || '/api/v2';

// fixtures
const userData = require('../fixtures/users.json')
describe('Integration Test', () => {
  let professorToken;
  let studentToken;
  let activityId;
  let phaseId;
  let student;
  let profesorId;
  let question_id

  beforeAll(async () => {
    // Create a user
    const professorExample = userData[7]
    const professorId = await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/users`)
      .send(professorExample)
    //await User.create(professorExample);

    //console.log(professorId.body.data)
    profesorId = professorId.body.data.id
    // Login to get the token Professor
    const loginResProfessor = await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/login_user`)
      .send({ mail: professorExample.mail, pass: professorExample.pass });

    professorToken = loginResProfessor.body.token;


    const studentExample = userData[8]
    const userId = await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/users`)
      .send(studentExample)

    student = userId.body.data

    // Login to get the token Student
    const loginResStudent = await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/login_user`)
      .send({ mail: studentExample.mail, pass: studentExample.pass });

    studentToken = loginResStudent.body.token;

    //console.log('token studentToken-->', studentToken);
    //console.log('token Professor-->', professorToken);

    // Create an activity
    const sessionId = await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/sessions`)
      .send({
        name: 'Session de integracion relevante',
        descr: 'ejemplo de una session en el siguiente flujo',
        status: 1,
        creator: profesorId,
        type: 'E',
        time: new Date(),
      })
      .set('Authorization', `Bearer ${professorToken}`)




    const designId = await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/designs`)
      .send({
        creator: profesorId,
        question_id: 1,
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
              }]
          }, {
            number: 2,
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

    const activity = await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/activity`)
      .send({ design: designId.body.data.id, session: sessionId.body.data.id })
      .set('Authorization', `Bearer ${professorToken}`)
    activityId = activity.body.data.id


    //create phase
    const phase = await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/phases`)
      .send({
        number: 1,
        type: 'intento de test',
        anon: true,
        chat: false,
        prev_ans: 'test de integracion',
        activity_id: activityId
      })
      .set('Authorization', `Bearer ${professorToken}`)

    phaseId = phase.body.data.id
    // Create Question
    const questionId = await request(app)
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
        session_id: sessionId.body.data.id,
        number: 1,
        phase_id: phaseId
      })
      .expect(201);
    question_id = questionId.body.data.id
  });


  it('Professor can go to the next phase', async () => {
    // const res = await request(app)
    //   .post(`${API_VERSION_PATH_PREFIX}/phases`)
    //   .set('Authorization', `Bearer ${professorToken}`)
    //   .send({ number: 2, type: 'discussion', anon: false, chat: true, prev_ans: 'Lorem Impusm', activity_id: activityId });

    // expect(res.status).toBe(201);
    // expect(res.body.status).toBe('success');

    const res = await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/activities/${activityId}/init_next_phase`)
      .set('Authorization', `Bearer ${professorToken}`)
      .expect(201);

    expect(res.body.status).toBe('success');
    expect(res.body.data).toHaveProperty('id');
    phaseId = res.body.data.id;
  });

  it('Student can get the current phase and question', async () => {
    console.log("question_id ->", question_id)
    const dataDesign = {
      creator: profesorId,
      question_id: question_id,
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
            }]
        }, {
          number: 2,
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
      locked: true
    }
    // const response = await request(app)
    //   .post(`${API_VERSION_PATH_PREFIX}/designs`)
    //   .send(dataDesign)
    //   .expect(201);

    // const createdDesignId = response.body.data
    // //console.log(createdDesignId)
    // const designRes = await request(app)
    //   .get(`${API_VERSION_PATH_PREFIX}/designs/${profesorId}/${1}/${1}`)

    // expect(designRes.status).toBe(200);
    // expect(designRes.body.status).toBe('success');
    const res = await request(app)
      .get(`${API_VERSION_PATH_PREFIX}/phases/${phaseId}/questions`)
      .set('Authorization', `Bearer ${professorToken}`)
      .expect(200);

    expect(res.body.status).toBe('success');
    expect(res.body.data).toBeInstanceOf(Array);
  });

  it('Student can create a response and send', async () => {
    console.log(student.id)
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
    // const responseByUser = await request(app)
    //   .post(`${API_VERSION_PATH_PREFIX}/responses`)
    //   .send({
    //     user_id: student.id,
    //     content: { autor: student.name, responses: "A" },
    //     type: "Choice",
    //     question_id: question_id
    //   })
    //   .expect(201);

    // expect(responseByUser.status).toBe(201);
    // expect(responseByUser.body.status).toBe('success');
  });
});
