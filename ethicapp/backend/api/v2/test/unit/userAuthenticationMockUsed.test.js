const request = require('supertest');
const express = require('express');
const bodyParser = require('body-parser');
const { User } = require('../../models');
const loginRouter =  require('../../login-user');
const bcrypt = require('bcryptjs');
const loginData = require('../fixtures/logins.json')
const API_VERSION_PATH_PREFIX = process.env.API_VERSION_PATH_PREFIX || '/api/v2';

const app = express();
app.use(bodyParser.json());
app.use(`${API_VERSION_PATH_PREFIX}`, loginRouter);

// Mock the User model
jest.mock('../../models', () => ({
    User: {
        findOne: jest.fn()
    }
}));

describe('User Authentication', () => {
    it('should fail if user does not exist', async () => {
        User.findOne.mockResolvedValue(null);   
        const userNotExist = loginData[0]
        const res = await request(app)
            .post(`${API_VERSION_PATH_PREFIX}/authenticate_client`)
            .send(userNotExist)

        expect(res.statusCode).toEqual(401);
        expect(res.body).toHaveProperty('message', 'User not found');
    });

    it('should fail if password is invalid', async () => {
        const hashedPassword = bcrypt.hashSync('password123', 10);
        const invalidPassword = loginData[1]
        User.findOne.mockResolvedValue({
            id: 1,
            name: 'John Doe',
            rut: '12345678-9',
            pass: hashedPassword, // hashed password
            mail: 'john.doe@example.com',
            sex: 'M',
            role: 'U',
            validPassword: jest.fn().mockReturnValue(false) // Mock the validPassword method
        });

        const res = await request(app)
            .post(`${API_VERSION_PATH_PREFIX}/authenticate_client`)
            .send(invalidPassword)

        expect(res.statusCode).toEqual(401);
        expect(res.body).toHaveProperty('status', 'error');
        expect(res.body).toHaveProperty('message', 'Invalid password');
    });

    it('should succeed if password is valid', async () => {
        const hashedPassword = bcrypt.hashSync('password123', 10);
        const successUser = loginData[2]
        User.findOne.mockResolvedValue({
            id: 1,
            name: 'John Doe',
            rut: '12345678-9',
            pass: hashedPassword, // hashed password
            mail: 'john.doe@example.com',
            sex: 'M',
            role: 'U',
            validPassword: jest.fn().mockReturnValue(true) // Mock the validPassword method
        });

        const res = await request(app)
            .post(`${API_VERSION_PATH_PREFIX}/authenticate_client`)
            .send(successUser)
        expect(res.statusCode).toEqual(200);
        expect(res.body).toHaveProperty('token');
    });
});
