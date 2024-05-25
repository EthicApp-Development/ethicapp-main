const request = require('supertest');
const express = require('express');
const bodyParser = require('body-parser');
const { User } = require('../../backend/api/v2/models');
const registerUserRouter = require('../../backend/api/v2/register-user');
const userData = require('../fixtures/user.json')

const app = express();
app.use(bodyParser.json());
app.use('/', registerUserRouter);

// Mock the User model
jest.mock('../../backend/api/v2/models', () => ({
    User: {
        create: jest.fn(),
        findAll: jest.fn()
    }
}));

describe('User Registration', () => {
    it('should register a user successfully with valid password and password confirmation', async () => {
        const sucessfullUser = userData[0]
        User.create.mockResolvedValue({
            id: 1,
            name: 'John Doe',
            rut: '12345678-9',
            pass: '$2a$10$...',
            mail: 'john.doe@example.com',
            sex: 'M',
            role: 'U'
        });
        console.log("should register a user successfully with valid password and password confirmation")
        const res = await request(app)
            .post('/register/users')
            .send(sucessfullUser)

        expect(res.statusCode).toEqual(201);
        expect(res.body).toHaveProperty('data');
    });

    it('should fail if password and password confirmation do not match', async () => {
        console.log("should fail if password and password confirmation do not match")
        const differentPasswordUser = userData[1]
        const res = await request(app)
            .post('/register/users')
            .send(differentPasswordUser)

        expect(res.statusCode).toEqual(400);
        expect(res.body).toHaveProperty('message', 'Passwords do not match');
    });

    it('should fail if the password is less than 8 characters', async () => {
        console.log("should fail if the password is less than 8 characters")
        const lessCharacters = userData[2]
        const res = await request(app)
            .post('/register/users')
            .send(lessCharacters)

        expect(res.statusCode).toEqual(400);
        expect(res.body).toHaveProperty('message', 'Password must be at least 8 characters long');
    });
});
