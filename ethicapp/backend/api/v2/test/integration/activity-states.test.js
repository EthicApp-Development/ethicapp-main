const request = require('supertest');
const app = require('../../testApi');
const { User, Session, Activity, Design, Phase, Question, Response } = require('../../models');
const jwt = require('jsonwebtoken');
const userData = require('../fixtures/users.json');
const onlyDesign = require('../fixtures/onlyDesign.json');
const API_VERSION_PATH_PREFIX = process.env.API_VERSION_PATH_PREFIX || '/api/v2';

// Mock Redis para pruebas
const mockRedis = {
    get: jest.fn(),
    setex: jest.fn()
};

// Configurar el mock de Redis en la app
app.locals.redisClient = mockRedis;

describe('Activity States API', () => {
    let teacherToken, studentToken, activityId, sessionId, designId;
    let teacherId, studentId;

    beforeAll(async () => {
        // Limpiar los mocks antes de cada test
        mockRedis.get.mockClear();
        mockRedis.setex.mockClear();
        
        console.log("=== Iniciando configuración del test ===");
        
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
        console.log("\n=== Creando sesión ===");
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
        console.log("\n=== Verificando actividad creada ===");
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
        console.log("=== Configuración del test completada ===");
    });


    describe('GET /teacher/activities/:activityId/state', () => {
        it('should return complete activity state for teacher', async () => {
            console.log("\n=== Test: Estado completo para profesor ===");

            try {
                const response = await request(app)
                    .get(`${API_VERSION_PATH_PREFIX}/teacher/activities/${activityId}/state`)
                    .set('Authorization', `Bearer ${teacherToken}`);

                console.log("Status code:", response.status);
                console.log("Headers:", response.headers);
                console.log("Respuesta completa:", JSON.stringify(response.body, null, 2));

                if (response.status !== 200) {
                    console.error("Error en la respuesta:", response.body);
                }

                expect(response.status).toBe(200);
                expect(response.body.status).toBe('success');
                expect(response.body.data).toHaveProperty('activity');
                expect(response.body.data).toHaveProperty('session');
                expect(response.body.data).toHaveProperty('phases');
                expect(response.body.data.phases[0]).toHaveProperty('questions');
            } catch (error) {
                console.error("Error en el test:", error);
                throw error;
            }
        });
        
        it('should return 403 for unauthorized teacher', async () => {
            console.log("\n=== Test: Profesor no autorizado ===");
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
            console.log("\n=== Test: Acceso sin token ===");
           
            const response = await request(app)
                .get(`${API_VERSION_PATH_PREFIX}/teacher/activities/${activityId}/state`)
                .expect(401);
           
        });
    });
 
 
    describe('GET /student/activities/:activityId/state', () => {
        it('should return activity state for student', async () => {
            console.log("\n=== Test: Estado para estudiante ===");
            
 
 
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
            console.log("\n=== Test: Estudiante no en sesión ===");
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
            console.log("\n=== Test: Acceso sin token (estudiante) ===");
           
            const response = await request(app)
                .get(`${API_VERSION_PATH_PREFIX}/student/activities/${activityId}/state`)
                .expect(401);
           
        });
    });
 
 
    describe('Cache behavior', () => {
        it('should return cached data for subsequent requests', async () => {
            // Limpiar los mocks antes del test
            mockRedis.get.mockClear();
            mockRedis.setex.mockClear();

            // Configurar el mock para simular caché
            mockRedis.get.mockImplementationOnce(() => null) // Primera llamada: no hay caché
                .mockImplementationOnce(() => JSON.stringify({ status: 'success', data: { cached: true } })); // Segunda llamada: hay caché

            // Primera petición
            const firstResponse = await request(app)
                .get(`${API_VERSION_PATH_PREFIX}/student/activities/${activityId}/state`)
                .set('Authorization', `Bearer ${studentToken}`)
                .expect(200);

            // Verificar que se intentó guardar en caché
            expect(mockRedis.setex).toHaveBeenCalledTimes(1);

            // Segunda petición inmediata
            const secondResponse = await request(app)
                .get(`${API_VERSION_PATH_PREFIX}/student/activities/${activityId}/state`)
                .set('Authorization', `Bearer ${studentToken}`)
                .expect(200);

            // Verificar que se intentó obtener del caché
            expect(mockRedis.get).toHaveBeenCalledTimes(2);
        });

        it('should have different cache for teacher and student', async () => {
            // Configurar el mock para simular diferentes respuestas
            mockRedis.get.mockImplementation(() => null); // No hay caché para ninguna petición

            const teacherResponse = await request(app)
                .get(`${API_VERSION_PATH_PREFIX}/teacher/activities/${activityId}/state`)
                .set('Authorization', `Bearer ${teacherToken}`)
                .expect(200);

            const studentResponse = await request(app)
                .get(`${API_VERSION_PATH_PREFIX}/student/activities/${activityId}/state`)
                .set('Authorization', `Bearer ${studentToken}`)
                .expect(200);

            expect(teacherResponse.body).not.toEqual(studentResponse.body);
        });
    });
}); 