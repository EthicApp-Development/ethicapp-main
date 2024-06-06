const request = require('supertest');
const app = require('../../testApi');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = process.env;
const API_VERSION_PATH_PREFIX = process.env.API_VERSION_PATH_PREFIX || '/api/v2';

describe('POST /authenticate_client', () => {
    let user;

    beforeAll(async () => {
        // Crear un usuario de prueba
        user = await request(app)
            .post(`${API_VERSION_PATH_PREFIX}/users`)
            .send({
                name: 'Test User in authenticate_client',
                mail: 'uthenticateclient@example.com',
                pass: 'Userinauthenticateclient',
                pass_confirmation: 'Userinauthenticateclient',
                rut: '12345678-3',
                sex: 'F',
                role: 'S'
            })

    });

    afterAll(async () => {
        // Eliminar el usuario de prueba
        await user.destroy();
    });

    it('should authenticate a user with valid credentials', async () => {
        const response = await request(app)
            .post(`${API_VERSION_PATH_PREFIX}/authenticate_client`)
            .send({
                mail: 'uthenticateclient@example.com',
                pass: 'Userinauthenticateclient',
            });

        expect(response.status).toBe(200);
        expect(response.body.status).toBe('success');
        expect(response.body).toHaveProperty('token');
        expect(response.body).toHaveProperty('userId');
    });

    it('should return an error if the user is not found', async () => {
        const response = await request(app)
            .post(`${API_VERSION_PATH_PREFIX}/authenticate_client`)
            .send({
                mail: 'invalidAndNotExistClien_t@example.com',
                pass: 'Userinauthenticateclient',
            });

        expect(response.status).toBe(401);
        expect(response.body.status).toBe('error');
        expect(response.body.message).toBe('User not found');
    });

    it('should return an error if the password is invalid', async () => {
        const response = await request(app)
            .post(`${API_VERSION_PATH_PREFIX}/authenticate_client`)
            .send({
                mail: 'uthenticateclient@example.com',
                pass: 'wrongpassword',
            });

        expect(response.status).toBe(401);
        expect(response.body.status).toBe('error');
        expect(response.body.message).toBe('Invalid password');
    });


});
