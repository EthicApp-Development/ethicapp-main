const request = require('supertest');
const app = require('../../testApi'); // Ajusta según tu configuración
const { User, Session, SessionsUsers } = require('../../models');
const jwt = require('jsonwebtoken');
const addUser = require('../fixtures/users.json');
const API_VERSION_PATH_PREFIX = process.env.API_VERSION_PATH_PREFIX || '/api/v2';

describe('GET /sessions/:sessionId/users', () => {
  let adminToken, professorToken, studentToken, sessionId, professorFalseToken;

  beforeAll(async () => {
    // Crea un usuario administrador

    const adminUser = addUser[0];
    const admin = await request(app)
    .post(`${API_VERSION_PATH_PREFIX}/users`)
    .send(adminUser);
    //console.log(admin.body.data)
    // Crea un usuario profesor
    const profesorUser = addUser[4];
    //console.log(adminUser)
    //console.log(profesorUser)
    const professor = await request(app)
    .post(`${API_VERSION_PATH_PREFIX}/users`)
    .send(profesorUser)
    //console.log(professor.body)
    // profesor falso
    const ProfesorUserFalse = addUser[5];
    const professorFalso = await request(app)
    .post(`${API_VERSION_PATH_PREFIX}/users`)
    .send(ProfesorUserFalse)

    // Crea un usuario estudiante
    const estudentUser = addUser[3];
    const student = await request(app)
    .post(`${API_VERSION_PATH_PREFIX}/users`)
    .send(estudentUser)

    // login para cada usuario
    const loginResAdmin =await request(app)
    .post(`${API_VERSION_PATH_PREFIX}/authenticate_client`)
    .send({ mail: addUser[0].mail, pass: addUser[0].pass });

    const loginResProfessor =await request(app)
    .post(`${API_VERSION_PATH_PREFIX}/authenticate_client`)
    .send({ mail: addUser[4].mail, pass: addUser[4].pass });

    const loginResProfessorFalso =await request(app)
    .post(`${API_VERSION_PATH_PREFIX}/authenticate_client`)
    .send({ mail: addUser[5].mail, pass: addUser[5].pass });

    const loginResStudent =await request(app)
    .post(`${API_VERSION_PATH_PREFIX}/authenticate_client`)
    .send({ mail: addUser[3].mail, pass: addUser[3].pass });
    // Genera tokens para cada usuario
    adminToken = loginResAdmin.body.token
    professorToken = loginResProfessor.body.token
    professorFalseToken = loginResProfessorFalso.body.token
    studentToken = loginResStudent.body.token
    //console.log(adminToken)
    await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/designs`)
      .send({
        creator: professor.body.data.id,
        design: {
          "phase": [{
            "number": 1,
            "question": [{
              "content": {
                "question": "¿Cuantos oceanos hay actualmente",
                "options": ["5", "7", "10", "11", "1"],
                "correct_answer": "5"
              },
              "additional_info": "Geografia",
              "type": "choice",
              "text": "preguntas sobre el oceano",
              "session_id": 1,
              "number": 1
            }]
          }]
        },
        public: true,
        locked: false
      })
      .set('Authorization', `Bearer ${professorToken}`)

    // Crea una sesión y asigna al profesor como creador
    const session = await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/sessions`)
      .set('Authorization', `Bearer ${professorToken}`)
      .send({ name: `Test Session Read ${professor.body.data.name}-${professor.body.data.id}`, descr: 'A session for testing Read', time: new Date(), creator: professor.body.data.id, type: 'A', status: 1 });

    sessionId = session.body.data.id;
    //console.log(professor.body.data.id )
    //console.log(student.body.data)
    // Añade al profesor y al estudiante a la sesión
    const sessionuser =await SessionsUsers.bulkCreate([
      { session_id: sessionId, user_id: professor.body.data.id },
      { session_id: sessionId, user_id: student.body.data.id },
    ]);
    //console.log(sessionuser)
  });

  it('should return 401 if no token is provided', async () => {
    const res = await request(app)
    .get(`${API_VERSION_PATH_PREFIX}/sessions/${sessionId}/users`)
    //console.log(res)
    //console.log('should return 401 if no token is provided')
    expect(res.status).toBe(401);
  });

  it('should allow admin to access the session users', async () => {
    // Verificar que adminToken esté definido
    if (!adminToken) {
      throw new Error('Admin token is not defined');
    }
  
    // Imprimir adminToken para debugging
    //console.log('Admin Token:', adminToken);
  
    // Ejecutar la petición de prueba
    const res = await request(app)
      .get(`${API_VERSION_PATH_PREFIX}/sessions/${sessionId}/users`)
      .set('Authorization', `Bearer ${adminToken}`);
  
    // Imprimir el estado de la respuesta y el cuerpo de la respuesta para debugging
    //console.log('Response Status:', res.status);
    //console.log('Response Body:', res.body);
  
    // Validar la respuesta
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2); // Profesor y estudiante
  });
  it('should allow the creator professor to access the session users', async () => {
    
    const res = await request(app)
      .get(`${API_VERSION_PATH_PREFIX}/sessions/${sessionId}/users`)
      .set('Authorization', `Bearer ${professorToken}`);
    //console.log('should allow the creator professor to access the session users')
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2); // Profesor y estudiante
  });

  it('should return 403 for a student trying to access session users', async () => {
    const res = await request(app)
      .get(`${API_VERSION_PATH_PREFIX}/sessions/${sessionId}/users`)
      .set('Authorization', `Bearer ${studentToken}`);
    //console.log('should return 403 for a student trying to access session users')
    expect(res.status).toBe(403);
  });

  it('should not allow the teacher who is not from this session to access the users of the session', async () => {
    const res = await request(app)
      .get(`${API_VERSION_PATH_PREFIX}/sessions/${sessionId}/users`)
      .set('Authorization', `Bearer ${professorFalseToken}`);
    //console.log('should not allow the teacher who is not from this session to access the users of the session')
    expect(res.status).toBe(403);
  });
});
