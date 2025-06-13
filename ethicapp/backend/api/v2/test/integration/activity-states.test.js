const request = require('supertest');
const {app} = require('../../testApi');
const { User, Session, Activity, Design, Phase, Question, Response } = require('../../models');
const jwt = require('jsonwebtoken');
const userData = require('../fixtures/users.json');
const onlyDesign = require('../fixtures/onlyDesign.json');
const API_VERSION_PATH_PREFIX = process.env.API_VERSION_PATH_PREFIX || '/api/v2';

const CACHE_TTL = 30;
const TEACHER_CACHE_PREFIX = 'teacher_activity_state:';
const STUDENT_CACHE_PREFIX = 'student_activity_state:';

const mockRedis = {
    get: jest.fn(),
    setex: jest.fn()
};

app.locals.redisClient = mockRedis;

describe('Activity States API', () => {
    let teacherToken, studentToken, activityId, sessionId, designId;
    let teacherId, studentId;

    beforeAll(async () => {
        // Limpiar los mocks antes de cada test
        mockRedis.get.mockClear();
        mockRedis.setex.mockClear();
        
        
        // Crear profesor
        const professorExample = userData[9];
        const teacherRes = await request(app)
            .post(`${API_VERSION_PATH_PREFIX}/users`)
            .send(professorExample);

        const teacherLoginRes = await request(app)
            .post(`${API_VERSION_PATH_PREFIX}/authenticate_client`)
            .send({ mail: professorExample.mail, pass: professorExample.pass });

        teacherToken = teacherLoginRes.body.token;
        teacherId = teacherLoginRes.body.userId;
        
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
            .set('Authorization', `Bearer ${teacherToken}`)
            .send({
                creator: teacherId,
                design: onlyDesign[0],
                public: true,
                locked: false
            });

        designId = designRes.body.data.id;
        
        // Crear sesión
        const sessionRes = await request(app)
            .post(`${API_VERSION_PATH_PREFIX}/sessions`)
            .set('Authorization', `Bearer ${teacherToken}`)
            .send({
                name: 'Test Session',
                descr: 'Description',
                status: 1,
                type: 'A',
                time: new Date(),
                creator: teacherId
            });

        sessionId = sessionRes.body.data.id;
        activityId = sessionRes.body.data.activity.id;
        const sessionCode = sessionRes.body.data.code;
        

        // Verificar que la actividad existe
        const verifyActivity = await Activity.findByPk(activityId);
        

        // Agregar estudiante a la sesión
        const addStudentRes = await request(app)
            .post(`${API_VERSION_PATH_PREFIX}/sessions/users`)
            .set('Authorization', `Bearer ${teacherToken}`)
            .send({
                code: sessionCode,
                user_id: studentId
            });

        // Crear fase
        const phaseRes = await request(app)
            .post(`${API_VERSION_PATH_PREFIX}/phases`)
            .set('Authorization', `Bearer ${teacherToken}`)
            .send({
                number: 999,
                type: "Phase in Test",
                anon: true,
                chat: false,
                prev_ans: "somethings",
                activity_id: activityId
            });

        expect(phaseRes.status).toBe(201);
        const phaseId = phaseRes.body.data.id;

        // Crear pregunta
        const questionRes = await request(app)
            .post(`${API_VERSION_PATH_PREFIX}/phases/${phaseId}/questions`)
            .set('Authorization', `Bearer ${teacherToken}`)
            .send({
                text: "¿Cuál es tu color favorito?",
                content: {
                    question: "¿Cuál es tu color favorito?",
                    options: ["Violeta", "Negro", "Azul"],
                    correct_answer: "Azul"
                },
                additional_info: "Colores",
                type: "choice",
                session_id: sessionId,
                number: 999
            });

        expect(questionRes.status).toBe(201);
        const questionId = questionRes.body.data.id;

        // Crear respuesta
        const responseRes = await request(app)
            .post(`${API_VERSION_PATH_PREFIX}/responses`)
            .set('Authorization', `Bearer ${studentToken}`)
            .send({
                user_id: studentId,
                question_id: questionId,
                content: { respuesta: "Esta es la respuesta a la pregunta" },
                type: "Example"
            });

        expect(responseRes.status).toBe(201);
    });


    describe('GET /teacher/activities/:activityId/state', () => {
        it('should return complete activity state for teacher', async () => {

            try {
                const cacheKey = `${TEACHER_CACHE_PREFIX}${activityId}_${teacherId}`;
                const cachedData = await mockRedis.get(cacheKey);
                
                if (cachedData) {
                    return res.status(200).json(JSON.parse(cachedData));
                }

                const response = await request(app)
                    .get(`${API_VERSION_PATH_PREFIX}/teacher/activities/${activityId}/state`)
                    .set('Authorization', `Bearer ${teacherToken}`);

               

                if (response.status !== 200) {
                    console.error("Error en la respuesta:", response.body);
                }

                expect(response.status).toBe(200);
                expect(response.body.status).toBe('success');
                expect(response.body.data).toHaveProperty('activity');
                expect(response.body.data).toHaveProperty('session');
                expect(response.body.data).toHaveProperty('phases');
                expect(response.body.data.phases[0]).toHaveProperty('questions');

                await mockRedis.setex(cacheKey, CACHE_TTL, JSON.stringify(response.body));
            } catch (error) {
                console.error("Error en el test:", error);
                throw error;
            }
        });
        
        it('should return 403 for unauthorized teacher', async () => {
            // Usar el profesor falso del índice 5
            const falseProfessor = userData[5];
           
            const falseTeacherRes = await request(app)
                .post(`${API_VERSION_PATH_PREFIX}/users`)
                .send(falseProfessor);
 
 
            const falseTeacherLoginRes = await request(app)
                .post(`${API_VERSION_PATH_PREFIX}/authenticate_client`)
                .send({ mail: falseProfessor.mail, pass: falseProfessor.pass });
 
 
            const response = await request(app)
                .get(`${API_VERSION_PATH_PREFIX}/teacher/activities/${activityId}/state`)
                .set('Authorization', `Bearer ${falseTeacherLoginRes.body.token}`)
                .expect(403);
           
        });
 
 
        it('should return 401 without token', async () => {
           
            const response = await request(app)
                .get(`${API_VERSION_PATH_PREFIX}/teacher/activities/${activityId}/state`)
                .expect(401);
           
        });
    });
 
 
    describe('GET /student/activities/:activityId/state', () => {
        it('should return activity state for student', async () => {
            
 
 
            const response = await request(app)
                .get(`${API_VERSION_PATH_PREFIX}/student/activities/${activityId}/state`)
                .set('Authorization', `Bearer ${studentToken}`)
                .expect(200);
 
 
 
 
            expect(response.body.status).toBe('success');
            expect(response.body.data).toHaveProperty('activity');
            expect(response.body.data).toHaveProperty('current_phase');
            expect(response.body.data).toHaveProperty('my_responses');
        });
 
 
        it('should return 404 for student not in session', async () => {
            // Usar el estudiante del índice 4 (un estudiante diferente)
            const otherStudent = userData[4];
           
            const otherStudentRes = await request(app)
                .post(`${API_VERSION_PATH_PREFIX}/users`)
                .send(otherStudent);

            const otherStudentLoginRes = await request(app)
                .post(`${API_VERSION_PATH_PREFIX}/authenticate_client`)
                .send({ mail: otherStudent.mail, pass: otherStudent.pass });

            const response = await request(app)
                .get(`${API_VERSION_PATH_PREFIX}/student/activities/${activityId}/state`)
                .set('Authorization', `Bearer ${otherStudentLoginRes.body.token}`)
                .expect(404);
           
        });
 
 
        it('should return 401 without token', async () => {
           
            const response = await request(app)
                .get(`${API_VERSION_PATH_PREFIX}/student/activities/${activityId}/state`)
                .expect(401);
           
        });
    });
 

 
    describe('Cache behavior', () => {
        it('should store and return correct cached data for teacher', async () => {
            // Limpiar los mocks antes del test
            mockRedis.get.mockClear();
            mockRedis.setex.mockClear();

            // Primera petición - no hay caché
            mockRedis.get.mockImplementationOnce(() => null);

            const firstResponse = await request(app)
                .get(`${API_VERSION_PATH_PREFIX}/teacher/activities/${activityId}/state`)
                .set('Authorization', `Bearer ${teacherToken}`)
                .expect(200);

            // Verificar que se guardó en caché
            expect(mockRedis.setex).toHaveBeenCalledWith(
                `${TEACHER_CACHE_PREFIX}${activityId}_${teacherId}`,
                CACHE_TTL,
                expect.any(String)
            );

            // Guardar la respuesta para simular el caché
            const cachedData = firstResponse.body;
            mockRedis.get.mockImplementationOnce(() => JSON.stringify(cachedData));

            // Segunda petición - debería usar el caché
            const secondResponse = await request(app)
                .get(`${API_VERSION_PATH_PREFIX}/teacher/activities/${activityId}/state`)
                .set('Authorization', `Bearer ${teacherToken}`)
                .expect(200);

            // Verificar que se usó el caché
            expect(mockRedis.get).toHaveBeenCalledWith(
                `${TEACHER_CACHE_PREFIX}${activityId}_${teacherId}`
            );

            // Verificar que la respuesta es exactamente la misma que la primera
            expect(secondResponse.body).toEqual(cachedData);

            // Verificar que no se volvió a guardar en caché
            expect(mockRedis.setex).toHaveBeenCalledTimes(1);
        });

        it('should store and return correct cached data for student', async () => {
            // Limpiar los mocks antes del test
            mockRedis.get.mockClear();
            mockRedis.setex.mockClear();

            // Primera petición - no hay caché
            mockRedis.get.mockImplementationOnce(() => null);

            const firstResponse = await request(app)
                .get(`${API_VERSION_PATH_PREFIX}/student/activities/${activityId}/state`)
                .set('Authorization', `Bearer ${studentToken}`)
                .expect(200);

            // Verificar que se guardó en caché
            expect(mockRedis.setex).toHaveBeenCalledWith(
                `${STUDENT_CACHE_PREFIX}${activityId}_${studentId}`,
                CACHE_TTL,
                expect.any(String)
            );

            // Guardar la respuesta para simular el caché
            const cachedData = firstResponse.body;
            mockRedis.get.mockImplementationOnce(() => JSON.stringify(cachedData));

            // Segunda petición - debería usar el caché
            const secondResponse = await request(app)
                .get(`${API_VERSION_PATH_PREFIX}/student/activities/${activityId}/state`)
                .set('Authorization', `Bearer ${studentToken}`)
                .expect(200);

            // Verificar que se usó el caché
            expect(mockRedis.get).toHaveBeenCalledWith(
                `${STUDENT_CACHE_PREFIX}${activityId}_${studentId}`
            );

            // Verificar que la respuesta es exactamente la misma que la primera
            expect(secondResponse.body).toEqual(cachedData);

            // Verificar que no se volvió a guardar en caché
            expect(mockRedis.setex).toHaveBeenCalledTimes(1);
        });


        it('should have different cache keys for teacher and student', async () => {
            // Limpiar los mocks antes del test
            mockRedis.get.mockClear();
            mockRedis.setex.mockClear();

            // Configurar el mock para simular diferentes respuestas
            mockRedis.get.mockImplementation(() => null);

            // Hacer peticiones para profesor y estudiante
            await request(app)
                .get(`${API_VERSION_PATH_PREFIX}/teacher/activities/${activityId}/state`)
                .set('Authorization', `Bearer ${teacherToken}`)
                .expect(200);

            await request(app)
                .get(`${API_VERSION_PATH_PREFIX}/student/activities/${activityId}/state`)
                .set('Authorization', `Bearer ${studentToken}`)
                .expect(200);

            // Verificar que se usaron diferentes claves de caché
            const cacheKeys = mockRedis.setex.mock.calls.map(call => call[0]);
            expect(cacheKeys).toContain(`${TEACHER_CACHE_PREFIX}${activityId}_${teacherId}`);
            expect(cacheKeys).toContain(`${STUDENT_CACHE_PREFIX}${activityId}_${studentId}`);
            expect(cacheKeys[0]).not.toBe(cacheKeys[1]);
        });
    });
}); 