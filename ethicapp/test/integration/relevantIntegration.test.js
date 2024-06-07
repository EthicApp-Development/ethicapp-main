const request = require('supertest');
const app = require('../../backend/api/v2/testApi'); // Asegúrate de que apunta a tu aplicación Express
const { User, Session  } = require('../../backend/api/v2/models');
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

  beforeAll(async () => {
        // Create a user
        const professorExample = userData[7]
        await User.create(professorExample);

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

        console.log('token studentToken-->', studentToken);
        console.log('token Professor-->', professorToken);

    // Create an activity
    const activity = await request(app)
    .post(`${API_VERSION_PATH_PREFIX}/activity`)
    .send({ design: 4, session: 4})
    .set('Authorization', `Bearer ${professorToken}`)
    activityId = activity.body.data.id


    //create phase
    const phase = await request(app)
    .post(`${API_VERSION_PATH_PREFIX}/phases`)
    .send({ number: 1, 
        type: 'intento de test', 
        anon: true, 
        chat: false,
        prev_ans: 'test de integracion',
        activity_id: activityId
    })
    .set('Authorization', `Bearer ${professorToken}`)

    phaseId = phase.body.data.id

    // Create Question
    await request(app)
        .post(`${API_VERSION_PATH_PREFIX}/questions`)
        .send({ content: {
            question: "¿Cuantos oceanos hay actualmente",
            options: ["5", "7", "10","11","1"],
            correct_answer: "5"
        },
        additional_info: "Geografia",
        type: "choice",
        text: "preguntas sobre el oceano",
        sesion_id: 1,
        number_phase: 1,
        phases_id:phaseId})
        .expect(201);

  });
//   afterAll(async () => {
//     // Close database connection
//     await sequelize.close();
//   });

  it('Professor can go to the next phase', async () => {
    const res = await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/phases`)
      .set('Authorization', `Bearer ${professorToken}`)
      .send({ number: 2, type: 'discussion', anon: false, chat: true, prev_ans: 'Lorem Impusm', activity_id: activityId });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('success');
  });

  it('Student can get the current phase and question', async () => {
    const phaseRes = await request(app)
      .get(`${API_VERSION_PATH_PREFIX}/phases/${phaseId}`)

    expect(phaseRes.status).toBe(200);
    expect(phaseRes.body.status).toBe('success');

    const questionRes = await request(app)
      .get(`${API_VERSION_PATH_PREFIX}/questions/${phaseRes.body.data.id}`)

    console.log("questionRes ->",questionRes.body.data.content)
    expect(questionRes.status).toBe(201);
    expect(questionRes.body.status).toBe('success');
  });

   it('Student can create a response and send', async () => {

    const responseByUser = await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/responses`)
      .send({user_id: student.id,
         content:{ autor: student.name, responses: "A"},
         type: "Choice",
         phase_id: phaseId})
      .expect(201);

    expect(responseByUser.status).toBe(201);
    expect(responseByUser.body.status).toBe('success');
  });
});
