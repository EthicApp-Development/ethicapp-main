const request = require('supertest');
const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const { Session } = require('../../backend/api/v2/models');
const sessionRouter = require('../../backend/api/v2/sessions'); // Adjust the path according to your directory structure.
const API_VERSION_PATH_PREFIX = process.env.API_VERSION_PATH_PREFIX || '/api/v2';

const app = express();
app.use(bodyParser.json());
app.use(`${API_VERSION_PATH_PREFIX}`, sessionRouter);

// Mock of the Session model
// jest.mock('../../backend/api/v2/models', () => ({
//     Session: {
//         create: jest.fn(),
//         findAll: jest.fn(),
//         findByPk: jest.fn()
//     }
// }));


describe('Session Creation', () => {
    it('should create a session and return the session descriptor with a 6-character hex code', async () => {
        const generatedCode = crypto.randomBytes(3).toString('hex'); 

        // Adjust the mock to reflect actual behaviour

        // Session.create.mockImplementation(async (sessionData) => ({
        //     id: 1,
        //     ...sessionData,
        //     code: generatedCode,
        //     status: 1
        // }));

        const res = await request(app)
            .post(`${API_VERSION_PATH_PREFIX}/sessions`)
            .send({
                name: 'Test Session',
                descr: 'A test session',
                time: new Date(),
                creator: 1,
                type: 'A',
                status: 1
            });

        expect(res.statusCode).toEqual(201);
        expect(res.body.data).toHaveProperty('code');
        expect(res.body.data.code).toHaveLength(6);
        expect(/^[a-f0-9]{6}$/.test(res.body.data.code)).toBe(true); // Validate that the code is a 6-character hexadecimal value
        //expect(res.body.data).toHaveProperty('id', 1);
        expect(res.body.data).toHaveProperty('status', 1);
    });
    it('should create 10 sessions with unique 6-character hex codes', async () => {
        const createdSessions = new Set();
        const listCode = []
        const iteration = 10
        for (let i = 0; i < iteration; i++) {
            const generatedCode = crypto.randomBytes(3).toString('hex');

            // Adjust the mock to reflect actual behaviour

            // Session.create.mockImplementationOnce(async (sessionData) => ({
            //     id: i + 1,
            //     ...sessionData,
            //     code: generatedCode,
            //     status: 1
            // }));

            const res = await request(app)
                .post(`${API_VERSION_PATH_PREFIX}/sessions`)
                .send({
                    name: `Test Session ${i + 1}`,
                    descr: `A test session ${generatedCode}`,
                    time: new Date(),
                    creator: 1,
                    type: 'A',
                    status: 1
                });
            
            expect(res.statusCode).toEqual(201);
            expect(res.body.data).toHaveProperty('code');
            expect(res.body.data.code).toHaveLength(6);
            expect(/^[a-f0-9]{6}$/.test(res.body.data.code)).toBe(true); // Validate that the code is a 6-character hexadecimal value
            //expect(res.body.data).toHaveProperty('id', 1);
            
            // Verify that the code is unique
            expect(createdSessions.has(res.body.data.code)).toBe(false);
            createdSessions.add(res.body.data.code);
            listCode.push(res.body.data.code)
            expect(res.body.data).toHaveProperty('status', 1);
        }
        // if (createdSessions.size === listCode.length){
        //     console.log(createdSessions)
        //     console.log("todos distintos")
        // }
        // Verify that 10 sessions have been created with unique codes
        expect(createdSessions.size).toBe(iteration);
    });
});