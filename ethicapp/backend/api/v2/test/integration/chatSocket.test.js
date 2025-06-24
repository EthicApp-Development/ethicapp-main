// tests/chatSocket.test.js
const request = require('supertest');
const http = require('http');
const socketClient = require('socket.io-client');
const app = require('../../testApi');
const { configSocket } = require('../../config/socket.config');
const { Group } = require('../../models');
const userData = require('../fixtures/users.json');
const API = process.env.API_VERSION_PATH_PREFIX || '/api/v2';

let server, port;
let studentSocket1, studentSocket2;
let token1, token2;
let studentId1, studentId2, professorId;
let chatRoomId, groupId;

jest.mock('../../config/socket.config.js', () => {
  const actual = jest.requireActual('../../config/socket.config.js');
  return {
    ...actual,
    studentNotifications: {
      ...actual.studentNotifications,
      phaseTransition: jest.fn()
    }
  };
});

beforeAll(async () => {
  server = http.createServer(app);
  configSocket(server);
  await new Promise((res) => server.listen(0, res));
  port = server.address().port;
});

afterAll(async () => {
  if (studentSocket1) studentSocket1.close();
  if (studentSocket2) studentSocket2.close();
  await new Promise((res) => server.close(res));
});

describe('Chat socket integration', () => {
  it('should allow two students in the same group to exchange messages via socket', async () => {
    // 1. Crear profesor
    const prof = userData[0];
    await request(app).post(`${API}/users`).send({ ...prof, pass_confirmation: prof.pass, role: prof.role });
    const login = await request(app).post(`${API}/authenticate_client`).send({ mail: prof.mail, pass: prof.pass });
    const profToken = login.body.token;
    professorId = login.body.userId;

    // 4. Crear diseño con fase grupal y pregunta embebida
    const dRes = await request(app).post(`${API}/designs`)
      .set('Authorization', `Bearer ${profToken}`)
      .send({
        creator: professorId,
        design: {
          phases: [
            {
              number: 1,
              mode: 'group',
              anonymous: false,
              chat: true,
              prevPhasesResponse: [],
              stdntAmount: 2,
              grouping_algorithm: 'random',
              heteroQuestionIndex: null,
              question: [
                {
                  text: '¿Qué opinas?',
                  type: 'open',
                  number: 1,
                  content: { question: '¿Qué opinas?', options: [], correct_answer: null },
                  additional_info: ''
                }
              ]
            }
          ]
        },
        public: true,
        locked: false
      });
    const designId = dRes.body.data.id;

    //await new Promise(resolve => setTimeout(resolve, 5000)); // 100 ms
    // 2. Crear sesión
    const sessionRes = await request(app).post(`${API}/sessions`)
      .set('Authorization', `Bearer ${profToken}`)
      .send({ name: 'Session socket chat', descr: 'Test chat', status: 1, type: 'A', time: new Date(), creator: professorId });
    const sessionId = sessionRes.body.data.id;

    // 3. Crear estudiantes y agregarlos
    const students = [userData[3], userData[4]];
    const tokens = [];
    const ids = [];

    for (const stu of students) {
      await request(app).post(`${API}/users`).send({ ...stu, pass_confirmation: stu.pass });
      const res = await request(app).post(`${API}/authenticate_client`).send({ mail: stu.mail, pass: stu.pass });
      const stuId = res.body.userId;
      await request(app).post(`${API}/sessions/${sessionId}/users`).send({ user_id: stuId });
      tokens.push(res.body.token);
      ids.push(stuId);
    }
    [token1, token2] = tokens;
    [studentId1, studentId2] = ids;

    

    // 5. Iniciar la actividad y avanzar a fase 1
    const aRes = await request(app).post(`${API}/activities/start`)
      .set('Authorization', `Bearer ${profToken}`)
      .send({ session: sessionId, design: designId });
    const activityId = aRes.body.data.id;

    const phaseRes = await request(app).post(`${API}/activities/${activityId}/init_next_phase`)
      .set('Authorization', `Bearer ${profToken}`);
    const phaseId = phaseRes.body.data.id;

    // 6. Crear pregunta manualmente
    const qRes = await request(app)
      .post(`${API}/phases/${phaseId}/questions`)
      .set('Authorization', `Bearer ${profToken}`)
      .send({
        text: '¿Cuál es tu película favorita?',
        content: { question: '¿Cuál es tu película favorita?', options: ['Dune', 'Alien', 'Thor'], correct_answer: 'Thor' },
        additional_info: 'Películas',
        type: 'choice',
        session_id: sessionId,
        number: 3,
        phase_id: phaseId
      });
    const questionId = qRes.body.data.id;

    // 7. Buscar grupo en BD
    const allGroups = await Group.findAll({ where: { session_id: sessionId } });
    expect(allGroups.length).toBeGreaterThan(0);
    groupId = allGroups[0].id;
    
    // 8. Crear sala de chat
    const roomRes = await request(app)
      .post(`${API}/activities/${activityId}/phases/${phaseId}/questions/${questionId}/groups/${groupId}/chatrooms`)
      .set('Authorization', `Bearer ${profToken}`);
    //console.log('chatroom response:', roomRes.body);
    chatRoomId = roomRes.body.data.id;
    //console.log('Chat room created with ID:', chatRoomId);
    // 9. Conectar sockets
    studentSocket1 = socketClient(`http://localhost:${port}/student`, {
      transports: ['websocket'],
      extraHeaders: { Authorization: `Bearer ${token1}` }
    });
    //console.log('Connecting studentSocket1 with token:', token1);
    studentSocket2 = socketClient(`http://localhost:${port}/student`, {
      transports: ['websocket'],
      extraHeaders: { Authorization: `Bearer ${token2}` }
    });
    //console.log('Connecting studentSocket2 with token:', token2);

    await Promise.all([
      new Promise(res => studentSocket1.on('connect', res)),
      new Promise(res => studentSocket2.on('connect', res))
    ]);
    //console.log('Both student sockets connected successfully');
    studentSocket1.emit('joinGroup', groupId);
    studentSocket2.emit('joinGroup', groupId);
    //console.log('Both students joined the group:', groupId);
    const testMessage = {
      header: {
        userId: studentId1,
        chatRoomId,
        groupId
      },
      payload: {
        content: "Hola grupo",
        parentId: null
      }
    };

    //console.log('[socket] sending messageToGroup:', testMessage);
    //agregar tiempo de espera para asegurar que los sockets estén listos
    await new Promise(resolve => setTimeout(resolve, 1000));
    //Hasta aca llegue
    const received = new Promise((resolve) => {
      studentSocket2.on('onGroupMessage', (data) => {
        //console.log('[socket] received onGroupMessage:', data);
        resolve(data);
      });
    });

    studentSocket1.emit('messageToGroup', testMessage);

    const result = await received;
    expect(result.payload.content).toBe("Hola grupo");
    expect(result.header.groupId).toBe(groupId);
  }, 30000);
});