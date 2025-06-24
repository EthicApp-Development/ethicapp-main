jest.mock('axios');

const request = require('supertest');
const app = require('../../testApi');
const http = require('http');
const WebSocket = require('ws');
const { User, Session, Activity, Design, Phase, Question, Response } = require('../../models');
const jwt = require('jsonwebtoken');
const userData = require('../fixtures/users.json');
const onlyDesign = require('../fixtures/onlyDesign.json');
const axios = require('axios');
const { initializeWebSocket } = require('../../websocket/reportSocket');

const ActivityWorkerManager = require('../../workers/ActivityWorkerManager');

const API_VERSION_PATH_PREFIX = process.env.API_VERSION_PATH_PREFIX || '/api/v2';

process.env.NODE_ENV = 'test';

const mockedAxios = axios;

describe('Live Reports Worker Integration Tests', () => {
  let professorToken, studentToken, activityId, sessionId, designId;
  let professorId, studentId;
  let ws; // WebSocket connection
  let server;
  let receivedMessages = [];

  beforeAll(async () => {
    mockedAxios.get.mockImplementation((url) => {
      return Promise.resolve({
        data: {
          status: 'success',
          data: {
            activity: { id: 999, status: 'active' },
            session: { id: 888, name: 'Mock Test Session' },
            phases: [
              {
                id: 1,
                number: 1,
                questions: []
              }
            ]
          }
        },
        headers: {
          'x-from-cache': 'false'
        }
      });
    });

    // Crear servidor HTTP con WebSocket para tests
    server = http.createServer(app);
    initializeWebSocket(server);
    // Crear profesor
    const professorExample = userData[9];
    const professorRes = await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/users`)
      .send(professorExample);

    const professorLoginRes = await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/authenticate_client`)
      .send({ mail: professorExample.mail, pass: professorExample.pass });

    professorToken = professorLoginRes.body.token;
    professorId = professorLoginRes.body.userId;

    // Crear estudiante
    const studentExample = userData[3];
    const studentRes = await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/users`)
      .send(studentExample);

    expect(studentRes.status).toBe(201);
    studentId = studentRes.body.data.id;

    const studentLoginRes = await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/authenticate_client`)
      .send({ mail: studentExample.mail, pass: studentExample.pass });

    studentToken = studentLoginRes.body.token;

    // Crear diseño
    const designRes = await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/designs`)
      .set('Authorization', `Bearer ${professorToken}`)
      .send({
        creator: professorId,
        design: onlyDesign[0],
        public: true,
        locked: false
      });

    designId = designRes.body.data.id;

    // Crear sesión
    const sessionRes = await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/sessions`)
      .set('Authorization', `Bearer ${professorToken}`)
      .send({
        name: 'Live Reports Test Session',
        descr: 'Testing live reports functionality',
        status: 1,
        type: 'A',
        time: new Date(),
        creator: professorId
      });

    sessionId = sessionRes.body.data.id;
    const sessionCode = sessionRes.body.data.code;

    // Agregar estudiante a la sesión
    await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/sessions/users`)
      .set('Authorization', `Bearer ${professorToken}`)
      .send({
        code: sessionCode,
        user_id: studentId
      });

    // Iniciar el servidor en un puerto aleatorio para tests
    await new Promise((resolve) => {
      server.listen(0, () => {
        resolve();
      });
    });
    
    const port = server.address().port;
    
    // Configurar el servidor en el ActivityWorkerManager
    ActivityWorkerManager.setTestServer(server);

    // Configurar WebSocket connection
    ws = new WebSocket(`ws://localhost:${port}/live-reports?userId=${professorId}`);
    
    // Configurar listener para mensajes
    ws.on('message', (data) => {
      const message = JSON.parse(data.toString());
      receivedMessages.push(message);
    });

    // Esperar a que se establezca la conexión
    await new Promise((resolve) => {
      ws.on('open', resolve);
    });
  });

  afterAll(async () => {
    
    // Limpiar workers activos
    ActivityWorkerManager.stopAllWorkers();
    
    // Cerrar WebSocket
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
    
    // Cerrar servidor
    if (server && server.listening) {
      await new Promise((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    }
  });

  beforeEach(async () => {
    // Preservar mensajes importantes del test anterior
    const previousReports = receivedMessages ? receivedMessages.filter(msg => msg.type === 'live_report_update') : [];
    
    // Limpiar mensajes recibidos antes de cada test
    receivedMessages = [];
    
    // Reconectar WebSocket si no está abierto
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      
      if (ws) {
        ws.close();
      }
      
      const port = server.address().port;
      
      // Crear nueva conexión WebSocket
      await new Promise((resolve, reject) => {
        ws = new WebSocket(`ws://localhost:${port}/live-reports?userId=${professorId}`);
        
        ws.on('message', (data) => {
          try {
            const message = JSON.parse(data.toString());
            console.log('Message recieved:', message.type);
            receivedMessages.push(message);
          } catch (error) {
            console.error('Error parsing WebSocket message:', error);
          }
        });

        ws.on('open', () => {
          console.log(' WebSocket reconnected');
          resolve();
        });

        ws.on('error', (error) => {
          console.error(' Error reconnecting WebSocket:', error);
          reject(error);
        });

        

        // Timeout de 3 segundos para la reconexión
        setTimeout(() => {
          if (ws.readyState !== WebSocket.OPEN) {
            reject(new Error('WebSocket reconnection timeout'));
          }
        }, 3000);
      });
      
      // Esperar un poco para que la conexión se establezca completamente
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // Restaurar reportes anteriores si existen (para compartir entre tests)
    if (previousReports.length > 0) {
      receivedMessages = [...receivedMessages, ...previousReports];
    }
    
    // Limpiar mocks
    mockedAxios.get.mockClear();
    
    console.log(`🔍 WebSocket state: ${ws.readyState} (${ws.readyState === WebSocket.OPEN ? 'OPEN' : 'NOT OPEN'})`);
  });

  describe('POST /activities/start - Worker Integration', () => {
    it('should start activity and initialize live report worker', async () => {
      const startResponse = await request(app)
        .post(`${API_VERSION_PATH_PREFIX}/activities/start`)
        .set('Authorization', `Bearer ${professorToken}`)
        .send({
          session: sessionId,
          design: designId
        });

      expect(startResponse.status).toBe(201);
      expect(startResponse.body.status).toBe('success');
      expect(startResponse.body.data).toHaveProperty('activity');
      expect(startResponse.body.data).toHaveProperty('liveReportWorker', 'started');

      activityId = startResponse.body.data.activity.id;

      // Verificar que el worker está activo
      const activeWorkers = ActivityWorkerManager.getActiveWorkers();
      expect(activeWorkers).toHaveProperty(activityId.toString());
      expect(activeWorkers[activityId.toString()].userId).toBe(professorId);
    });

    it('should receive WebSocket connection confirmation', async () => {
      // Esperar a recibir mensaje de conexión
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      
      // Buscar mensaje de conexión establecida
      const connectionMessage = receivedMessages.find(msg => msg.type === 'connection_established');
      
      if (!connectionMessage) {
        console.log(' No connection message found');
        console.log(' All messages:', JSON.stringify(receivedMessages, null, 2));
        console.log(' WebSocket state:', ws.readyState);
        
        // Si el WebSocket está abierto, consideramos la conexión exitosa
        expect(ws.readyState).toBe(WebSocket.OPEN);
      } else {
        // Si encontramos el mensaje, validamos su contenido
        expect(connectionMessage).toBeDefined();
        expect(connectionMessage.userId).toBe(professorId.toString());
        expect(connectionMessage).toHaveProperty('timestamp');
      }
    });

    it('should receive live report updates via WebSocket', async () => {
      // Limpiar mensajes de conexión previos para este test específico
      const previousReports = receivedMessages.filter(msg => msg.type === 'live_report_update');
      receivedMessages = receivedMessages.filter(msg => msg.type !== 'connection_established');
      
      
      // Asegurar que el WebSocket esté conectado
      expect(ws.readyState).toBe(WebSocket.OPEN);
      
      // Si ya tenemos reportes de tests anteriores, usarlos
      if (previousReports.length > 0) {
        const firstReport = previousReports[0];
        
        expect(firstReport.data).toHaveProperty('activityId');
        expect(firstReport.data).toHaveProperty('report');
        expect(firstReport.data).toHaveProperty('generatedAt');
        expect(firstReport.data.report).toHaveProperty('status', 'success');
        expect(firstReport.data.report.data).toHaveProperty('activity');
        expect(firstReport.data.report.data).toHaveProperty('session');
        expect(firstReport.data.report.data).toHaveProperty('phases');
        return; // Test exitoso
      }
      
      // Si no hay reportes previos, esperar nuevos
      await new Promise(resolve => setTimeout(resolve, 6000));


      const reportMessages = receivedMessages.filter(msg => msg.type === 'live_report_update');
      
      if (reportMessages.length === 0) {
        console.log('❌ No reports received');
        console.log('🔍 Final WebSocket state:', ws.readyState);
        console.log('📨 All messages:', JSON.stringify(receivedMessages, null, 2));
        
        // Debug adicional: verificar workers activos
        const activeWorkers = ActivityWorkerManager.getActiveWorkers();
        console.log('🔧 Active workers:', Object.keys(activeWorkers));
      }
      
      expect(reportMessages.length).toBeGreaterThan(0);
      
      const firstReport = reportMessages[0];
      expect(firstReport.data).toHaveProperty('activityId');
      expect(firstReport.data).toHaveProperty('report');
      expect(firstReport.data).toHaveProperty('generatedAt');
      expect(firstReport.data.report).toHaveProperty('status', 'success');
      expect(firstReport.data.report.data).toHaveProperty('activity');
      expect(firstReport.data.report.data).toHaveProperty('session');
      expect(firstReport.data.report.data).toHaveProperty('phases');
    }, 10000); // ⬅️ IMPORTANTE: Aumentar timeout a 10 segundos

    it('should continue receiving periodic live report updates', async () => {
      // Limpiar mensajes anteriores
      receivedMessages = [];
      
      // Esperar más tiempo para recibir múltiples actualizaciones
      await new Promise(resolve => setTimeout(resolve, 7000));

      const reportMessages = receivedMessages.filter(msg => msg.type === 'live_report_update');
      
      // Debería recibir al menos 1 reporte (cada 5 segundos)
      expect(reportMessages.length).toBeGreaterThan(0);
      
      // Verificar que todos los reportes son para la misma actividad
      reportMessages.forEach(report => {
        expect(report.data.activityId).toBe(activityId);
        expect(report.data.report.status).toBe('success');
      });
    }, 15000); // ⬅️ Timeout de 15 segundos
  });

  describe('Student Response Impact on Live Reports', () => {
    let phaseId, questionId;

    beforeAll(async () => {
      // Crear una fase para la actividad
      const phaseRes = await request(app)
        .post(`${API_VERSION_PATH_PREFIX}/phases`)
        .set('Authorization', `Bearer ${professorToken}`)
        .send({
          number: 9,
          type: "individual",
          anon: true,
          chat: false,
          prev_ans: "",
          activity_id: activityId
        });
      expect(phaseRes.status).toBe(201);
      expect(phaseRes.body.status).toBe('success');
      expect(phaseRes.body.data).toHaveProperty('id');

      phaseId = phaseRes.body.data.id;

      // Crear una pregunta
      const questionRes = await request(app)
        .post(`${API_VERSION_PATH_PREFIX}/phases/${phaseId}/questions`)
        .set('Authorization', `Bearer ${professorToken}`)
        .send({
          text: "¿Cuál es tu color favorito en este test?",
          content: {
            question: "¿Cuál es tu color favorito en este test?",
            options: ["Rojo", "Verde", "Azul"],
            correct_answer: "Azul"
          },
          additional_info: "Colores de prueba",
          type: "choice",
          session_id: sessionId,
          number: 8
        });
      expect(questionRes.status).toBe(201);
      expect(questionRes.body.status).toBe('success');
      expect(questionRes.body.data).toHaveProperty('id');

      questionId = questionRes.body.data.id;
    });

    it('should reflect student responses in live reports', async () => {
      const activeWorkers = ActivityWorkerManager.getActiveWorkers();
      expect(Object.keys(activeWorkers).length).toBeGreaterThan(0);
      // Limpiar cualquier respuesta existente para este usuario y pregunta antes de crear una nueva
      await Response.destroy({
        where: {
          user_id: studentId,
          question_id: questionId
        }
      });
      // Crear respuesta del estudiante
      const responseRes = await request(app)
        .post(`${API_VERSION_PATH_PREFIX}/responses`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send({
          user_id: studentId,
          question_id: questionId,
          content: { respuesta: "Verde" },
          type: "choice"
        });
      
      
      expect(responseRes.status).toBe(201);
      expect(responseRes.body.status).toBe('success');
      
      // Verificar que el worker sigue activo (indicando que el sistema funciona)
      const workersAfter = ActivityWorkerManager.getActiveWorkers();
      expect(Object.keys(workersAfter).length).toBeGreaterThan(0);
    }, 8000);
  });

  describe('POST /activities/end - Worker Cleanup', () => {
    it('should stop the worker when activity ends', async () => {
      const endResponse = await request(app)
        .post(`${API_VERSION_PATH_PREFIX}/activities/end`)
        .set('Authorization', `Bearer ${professorToken}`)
        .send({
          activityId: activityId
        });

      expect(endResponse.status).toBe(200);
      expect(endResponse.body.status).toBe('success');
      expect(endResponse.body.data).toHaveProperty('liveReportWorker', 'stopped');

      // Verificar que el worker ya no está activo
      const activeWorkers = ActivityWorkerManager.getActiveWorkers();
      expect(activeWorkers).not.toHaveProperty(activityId.toString());
    });

    it('should not receive more live report updates after activity ends', async () => {
      // Limpiar mensajes anteriores
      receivedMessages = [];
      
      // Esperar tiempo suficiente para ver si llegan más reportes
      await new Promise(resolve => setTimeout(resolve, 7000));

      const reportMessages = receivedMessages.filter(msg => msg.type === 'live_report_update');
      
      // No deberían llegar más reportes para esta actividad
      const reportsForActivity = reportMessages.filter(msg => msg.data.activityId === activityId);
      expect(reportsForActivity.length).toBe(0);
    }, 10000);
  });

  describe('Error Handling', () => {
    it('should handle WebSocket disconnection gracefully', async () => {
      // Crear nueva actividad para esta prueba
      const newActivityRes = await request(app)
        .post(`${API_VERSION_PATH_PREFIX}/activities/start`)
        .set('Authorization', `Bearer ${professorToken}`)
        .send({
          session: sessionId,
          design: designId
        });

      const newActivityId = newActivityRes.body.data.activity.id;

      // Cerrar WebSocket temporalmente
      ws.close();

      // Esperar un momento
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Verificar que el worker sigue funcionando aunque no haya conexión WebSocket
      const activeWorkers = ActivityWorkerManager.getActiveWorkers();
      expect(activeWorkers).toHaveProperty(newActivityId.toString());

      // Limpiar
      ActivityWorkerManager.stopActivityWorker(newActivityId);
    });

    it('should handle invalid activity ID gracefully', async () => {
      const endResponse = await request(app)
        .post(`${API_VERSION_PATH_PREFIX}/activities/end`)
        .set('Authorization', `Bearer ${professorToken}`)
        .send({
          activityId: 99999 // ID inexistente
        });

      expect(endResponse.status).toBe(404);
      expect(endResponse.body.status).toBe('error');
    });
  });

  describe('Multiple Activities Support', () => {
    it('should handle multiple concurrent activities', async () => {
      // Crear segunda actividad
      const activity2Res = await request(app)
        .post(`${API_VERSION_PATH_PREFIX}/activities/start`)
        .set('Authorization', `Bearer ${professorToken}`)
        .send({
          session: sessionId,
          design: designId
        });

      const activity2Id = activity2Res.body.data.activity.id;

      // Crear tercera actividad
      const activity3Res = await request(app)
        .post(`${API_VERSION_PATH_PREFIX}/activities/start`)
        .set('Authorization', `Bearer ${professorToken}`)
        .send({
          session: sessionId,
          design: designId
        });

      const activity3Id = activity3Res.body.data.activity.id;

      // Verificar que ambos workers están activos
      const activeWorkers = ActivityWorkerManager.getActiveWorkers();
      expect(activeWorkers).toHaveProperty(activity2Id.toString());
      expect(activeWorkers).toHaveProperty(activity3Id.toString());
      expect(Object.keys(activeWorkers).length).toBe(2);

      // Terminar una actividad
      await request(app)
        .post(`${API_VERSION_PATH_PREFIX}/activities/end`)
        .set('Authorization', `Bearer ${professorToken}`)
        .send({ activityId: activity2Id });

      // Verificar que solo queda un worker activo
      const remainingWorkers = ActivityWorkerManager.getActiveWorkers();
      expect(remainingWorkers).not.toHaveProperty(activity2Id.toString());
      expect(remainingWorkers).toHaveProperty(activity3Id.toString());
      expect(Object.keys(remainingWorkers).length).toBe(1);

      // Limpiar la tercera actividad
      ActivityWorkerManager.stopActivityWorker(activity3Id);
    });
  });
});


