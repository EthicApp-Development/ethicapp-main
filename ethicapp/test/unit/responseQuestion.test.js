const request = require('supertest');
const { Response, Phase } = require('../../backend/api/v2/models');
const app = require('../../backend/api/v2/testApi'); 
const API_VERSION_PATH_PREFIX = process.env.API_VERSION_PATH_PREFIX || '/api/v2';

describe('Response API', () => {
    function getRandomInt(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }
  let phaseId;
  let userId;
  const random_phase = getRandomInt(1, 999999999)
  beforeAll(async () => {
    // Crear una fase para asociar la respuesta
    const phase = await Phase.create({
      number: random_phase,
      type: 'Test',
      anon: false,
      chat: true,
      prev_ans: 'None',
      activity_id: 1 // ID de la actividad asociada a esta fase
    });
    phaseId = phase.id;

    // Supongamos que tenemos un usuario en la base de datos con ID 1
    userId = 1;
  });


  it('should create a new response for a question by a user', async () => {
    const responseContent = { answer: 'Test answer' };

    const response = await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/responses`)
      .send({ user_id: userId, content: responseContent, type: 'Text', phase_id: phaseId })
      .expect(201);

    expect(response.body).toHaveProperty('status', 'success');
    expect(response.body).toHaveProperty('data');
    expect(response.body.data).toHaveProperty('id');
    expect(response.body.data.user_id).toBe(userId);
    expect(response.body.data.phase_id).toBe(phaseId);

    // Verificar si la respuesta se creó correctamente en la base de datos
    const createdResponse = await Response.findByPk(response.body.data.id);
    expect(createdResponse).toBeTruthy();
    expect(createdResponse.content).toEqual(responseContent);
  });

  it('should not allow creating more than one response for the same user and question', async () => {
    // Crear una respuesta para la misma fase y usuario
    await Response.create({ user_id: userId, content: { answer: 'Previous answer' }, type: 'Text', phase_id: phaseId });

    // Intentar crear otra respuesta para la misma fase y usuario
    const response = await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/responses`)
      .send({ user_id: userId, content: { answer: 'New answer' }, type: 'Text', phase_id: phaseId })
      .expect(400);

    expect(response.body).toHaveProperty('status', 'error');
    expect(response.body).toHaveProperty('message', 'Only one response allowed per user and phase');
  });

  it('should allow updating an existing response', async () => {
    const existingResponse = await Response.create({ user_id: userId, content: { answer: 'Previous answer' }, type: 'Text', phase_id: phaseId });

    const updatedContent = { answer: 'Updated answer' };
    const response = await request(app)
      .put(`${API_VERSION_PATH_PREFIX}/responses/${existingResponse.id}`)
      .send({ content: updatedContent })
      .expect(200);

    expect(response.body).toHaveProperty('status', 'success');
    expect(response.body).toHaveProperty('data');
    expect(response.body.data).toHaveProperty('id', existingResponse.id);
    expect(response.body.data.content).toEqual(updatedContent);
  });
});
