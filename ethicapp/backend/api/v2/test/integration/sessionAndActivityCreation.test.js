const request = require('supertest');
const app = require('../../testApi');
const { User, Session, Activity, Design } = require('../../models');
const jwt = require('jsonwebtoken');
const API_VERSION_PATH_PREFIX = process.env.API_VERSION_PATH_PREFIX || '/api/v2';

describe('Integration Tests for Session and Activity Creation', () => {
  let professorToken, studentToken, sessionId;
  let profesorId, studentId;
  let countDesign 
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
    const professor = await User.create({
        name: `New profesor ${randomString}`,
        rut: `${generateRandomRut()}`,
        pass: `NewProfesor${randomStringShort}`,
        pass_confirmation: `NewProfesor${randomStringShort}`,
        mail: `NewProfesor${randomString}@example.com`,
        sex: 'M',
        role: 'P',
    });
    const student = await User.create({
        name: `New User ${randomString}`,
        rut: `${generateRandomRut()}`,
        pass: `New${randomStringShort}`,
        pass_confirmation: `New${randomStringShort}`,
        mail: `NewUser${randomString}@example.com`,
        sex: 'M',
        role: 'A',
    });

    professorToken = jwt.sign({ id: professor.id, role: professor.role }, 'your_secret_key');
    studentToken = jwt.sign({ id: student.id, role: student.role }, 'your_secret_key');
    profesorId = professor
    studentId = student
    countDesign = await Design.count();
    
});

  it('should create a session and automatically create the first activity', async () => {
    const sessionRes = await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/sessions/creator/${2}`)
      .set('Authorization', `Bearer ${professorToken}`)
      .send({ name: `Session 1 by ${profesorId.name}`, descr: `Test session by ${profesorId.name} `, status:1, time: new Date(), creator: profesorId.id, type: "A"});

    expect(sessionRes.status).toBe(201);
    expect(sessionRes.body.data).toHaveProperty('id');
    expect(sessionRes.body.data).toHaveProperty('code');

    sessionId = sessionRes.body.data.id;
    console.log("countDesign ->", countDesign)
    console.log("sessionRes.body", sessionRes.body)

  });

  it('should not allow a non-professor to create a session', async () => {
    const sessionRes = await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/sessions/creator/${2}`)
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ name: `Session 1 by ${studentId.name}`, descr: `Test session by ${studentId.name} `, status:1, time: new Date(), creator: studentId.id, type: "A" });

    expect(sessionRes.status).toBe(403);
    expect(sessionRes.body).toHaveProperty('status', 'error');
  });

  it('should allow the owner professor to create an activity in their session', async () => {
    const activityRes = await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/activity/postsession`)
      .set('Authorization', `Bearer ${professorToken}`)
      .send({ design: 2, session: sessionId });

    expect(activityRes.status).toBe(201);
    expect(activityRes.body.data).toHaveProperty('id');
    expect(activityRes.body.data).toHaveProperty('session', sessionId);
  });

  it('should not allow a professor to create an activity in a session they do not own', async () => {
    const anotherProfessor = await User.create({ name: 'Professor Other',
        rut: "87654123-k",
        pass: "ProfessorOther",
        pass_confirmation: "ProfessorOther",
        mail: 'ProfessorOther@example.com',
        sex: 'M',
        role: 'P' });
    const anotherProfessorToken = jwt.sign({ id: anotherProfessor.id, role: anotherProfessor.role }, 'your_secret_key');

    const activityRes = await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/activity/postsession`)
      .set('Authorization', `Bearer ${anotherProfessorToken}`)
      .send({ design: 2, session: sessionId });

    expect(activityRes.status).toBe(403);
    expect(activityRes.body).toHaveProperty('status', 'error');
  });
});
