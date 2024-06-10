const request = require('supertest');
const app = require('../../backend/api/v2/testApi'); // Asegúrate de que apunta a tu aplicación Express
const { User, Session  } = require('../../backend/api/v2/models');
const addUser = require('../fixtures/users.json');
const jwt = require('jsonwebtoken');
const API_VERSION_PATH_PREFIX = process.env.API_VERSION_PATH_PREFIX || '/api/v2';

describe('POST /api-v2/sessions/users', () => {
    let token;
    let userId; 
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

    function getRandomString(length) {
        let result = '';
        const charactersLength = characters.length;
        for (let i = 0; i < length; i++) {
            result += characters.charAt(Math.floor(Math.random() * charactersLength));
        }
        return result;
    }
    function getRandomInt(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }
    
    function calculateCheckDigit(rutBase) {
        let sum = 0;
        let multiplier = 2;
        const rutArray = rutBase.toString().split('').reverse();
    
        for (let i = 0; i < rutArray.length; i++) {
            sum += parseInt(rutArray[i]) * multiplier;
            multiplier = multiplier === 7 ? 2 : multiplier + 1;
        }
    
        const remainder = 11 - (sum % 11);
        if (remainder === 11) return '0';
        if (remainder === 10) return 'K';
        return remainder.toString();
    }
    
    function generateRandomRut() {
        // Generar un número base entre 1 y 99,999,999
        const rutBase = getRandomInt(1, 99999999);
        const checkDigit = calculateCheckDigit(rutBase);
    
        return `${rutBase}-${checkDigit}`;
    }
    const randomString = getRandomString(10);
    const randomStringShort = getRandomString(5);

    beforeAll(async () => {
        // Create a user
        const user = await User.create({
            name: `Test User ${randomString}`,
            rut: `${generateRandomRut()}`,
            pass: `pass${randomStringShort}`,
            pass_confirmation: `pass${randomStringShort}`,
            mail: `testuser${randomString}@example.com`,
            sex: 'M',
            role: 'A',
        });

        // Asignar el id del usuario creado a la variable global userId
        userId = user.dataValues.id;

        // Login to get the token
        const loginRes = await request(app)
            .post(`${API_VERSION_PATH_PREFIX}/login/user_session`)
            .send({ mail: `testuser${randomString}@example.com`, pass: `pass${randomStringShort}` });

        token = loginRes.body.token;

        //console.log('token -->', token); // Ensure the token is obtained correctly
    });

    it('should add a user to a session', async () => {
        // Create a session first
        const sessionRes = await request(app)
            .post(`${API_VERSION_PATH_PREFIX}/sessions`)
            .send({ name: 'Test Session', descr: 'A session for testing',time: new Date(), creator: 1, type: 'A', status: 1 });

        const sessionCode = sessionRes.body.data.code;
        // Add a user to the session
        const userRes = await request(app)
            .post(`${API_VERSION_PATH_PREFIX}/sessions/users`)
            .send({ code: sessionCode, user_id: userId})
            .set('Authorization', `Bearer ${token}`);
        
        expect(userRes.status).toBe(201);
        expect(userRes.body.data).toHaveProperty('session_id');
        expect(userRes.body.data).toHaveProperty('user_id');

        // Verify the user is in the session
        //console.log( "userRes.body.data.session_id ->", userRes.body.data.session_id)
        const usersRes = await request(app)
            .get(`${API_VERSION_PATH_PREFIX}/sessionsUsers/${userRes.body.data.session_id}/users`)
            .set('Authorization', `Bearer ${token}`);

        expect(usersRes.status).toBe(200);
        expect(usersRes.body.data).toContain(userId);
    });
});

describe('POST /sessions/users with invalid session code', () => {
    let token, userId;

    beforeAll(async () => {
        // Crea un usuario y genera un token
        const user = await User.create(addUser[0]);
        userId = user.id;
        token = jwt.sign({ id: user.id, role: user.role }, 'your_secret_key');

        // Crea una sesión válida
        await request(app)
            .post(`${API_VERSION_PATH_PREFIX}/sessions`)
            .send({ name: 'Valid Test Session', descr: 'A valid session for testing', time: new Date(), creator: user.id, type: 'A', status: 1 })
            .set('Authorization', `Bearer ${token}`);
    });

    it('should return 404 for invalid session code', async () => {
        const invalidSessionCode = 'INVALID_CODE';

        // Intenta añadir un usuario a la sesión con un código inválido
        const userRes = await request(app)
            .post(`${API_VERSION_PATH_PREFIX}/sessions/users`)
            .send({ code: invalidSessionCode, user_id: userId })
            .set('Authorization', `Bearer ${token}`);

        expect(userRes.status).toBe(404);
        expect(userRes.body).toHaveProperty('status', 'error');
        expect(userRes.body).toHaveProperty('message', 'Invalid session code');
    });
});