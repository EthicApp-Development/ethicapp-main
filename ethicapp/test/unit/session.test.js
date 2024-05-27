const request = require('supertest');
const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const { Session } = require('../../backend/api/v2/models');
const sessionRouter = require('../../backend/api/v2/sessions'); // Ajusta el path según tu estructura de directorios

const app = express();
app.use(bodyParser.json());
app.use('/', sessionRouter);

// Mock del modelo Session
jest.mock('../../backend/api/v2/models', () => ({
    Session: {
        create: jest.fn(),
        findAll: jest.fn(),
        findByPk: jest.fn()
    }
}));

describe('Session Creation', () => {
    it('should create a session and return the session descriptor with a 6-character hex code', async () => {
        const generatedCode = crypto.randomBytes(3).toString('hex'); // Generar el código dinámico

        // Ajustar el mock para reflejar el comportamiento real
        Session.create.mockImplementation(async (sessionData) => ({
            id: 1,
            ...sessionData,
            code: generatedCode,
            status: 1
        }));

        const res = await request(app)
            .post('/sessions')
            .send({
                name: 'Test Session',
                descr: 'A test session',
                time: new Date(),
                creator: 1,
                type: 'A'
            });

        expect(res.statusCode).toEqual(201);
        expect(res.body.data).toHaveProperty('id', 1);
        expect(res.body.data).toHaveProperty('code');
        expect(res.body.data.code).toHaveLength(6);
        expect(/^[a-f0-9]{6}$/.test(res.body.data.code)).toBe(true); // Validar que el código es un valor hexadecimal de 6 caracteres
        expect(res.body.data.code).toEqual(generatedCode); // Asegurarse de que el código es el mismo
        expect(res.body.data).toHaveProperty('status', 1);
    });
    it('should create 10 sessions with unique 6-character hex codes', async () => {
        const createdSessions = new Set();
        const listCode = []
        const iteration = 10
        for (let i = 0; i < iteration; i++) {
            const generatedCode = crypto.randomBytes(3).toString('hex'); // Generar el código dinámico

            // Ajustar el mock para reflejar el comportamiento real
            Session.create.mockImplementationOnce(async (sessionData) => ({
                id: i + 1,
                ...sessionData,
                code: generatedCode,
                status: 1
            }));

            const res = await request(app)
                .post('/sessions')
                .send({
                    name: `Test Session ${i + 1}`,
                    descr: 'A test session',
                    time: new Date(),
                    creator: 1,
                    type: 'A'
                });
            
            expect(res.statusCode).toEqual(201);
            expect(res.body.data).toHaveProperty('id', i + 1);
            expect(res.body.data).toHaveProperty('code');
            expect(res.body.data.code).toHaveLength(6);
            expect(/^[a-f0-9]{6}$/.test(res.body.data.code)).toBe(true); // Validar que el código es un valor hexadecimal de 6 caracteres
            
            // Verificar que el código sea único
            expect(createdSessions.has(res.body.data.code)).toBe(false);
            createdSessions.add(res.body.data.code);
            listCode.push(res.body.data.code)
            expect(res.body.data).toHaveProperty('status', 1);
        }
        if (createdSessions.size === listCode.length){
            console.log(createdSessions)
            console.log("todos distintos")
        }
        // Verificar que se han creado 10 sesiones con códigos únicos
        expect(createdSessions.size).toBe(iteration);
    });
});