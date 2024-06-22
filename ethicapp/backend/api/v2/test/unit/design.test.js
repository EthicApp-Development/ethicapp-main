const request = require('supertest');
const app = require('../../testApi');
const API_VERSION_PATH_PREFIX = process.env.API_VERSION_PATH_PREFIX || '/api/v2';

const designsData = require('../fixtures/designs.json');
describe('CRUD Operations for Designs API', () => {
  let createdDesignId, token, userId
  //console.log("--- CRUD testing Design ---")
  // Test Create Operation
  beforeAll(async () => {
    await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/users`)
      .send({
        name: `profesor Token Design`,
        rut: `99888777-4`,
        pass: `tokenProfesor`,
        pass_confirmation: `tokenProfesor`,
        mail: `tokenProfesor@example.com`,
        sex: 'M',
        role: 'P',
      })


    // Asignar el id del usuario creado a la variable global userId


    // Login to get the token
    const loginRes = await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/authenticate_client`)
      .send({ mail: `tokenProfesor@example.com`, pass: `tokenProfesor` });

    token = loginRes.body.token;
    userId = loginRes.body.userId;
    //console.log('token -->', token);
  });

  it('should create a new design', async () => {
    const newDesignData = designsData[0]
    //console.log(designsData[1].design.phase[1])
    const response = await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/designs`)
      .send(newDesignData)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    createdDesignId = response.body.data.id;

  });

  // Test Read Operation
  it('should retrieve all designs', async () => {
    await request(app)
      .get(`${API_VERSION_PATH_PREFIX}/designs`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });

  // Test Update Operation
  it('should update an existing design', async () => {
    const updatedDesignData = designsData[1]

    await request(app)
      .put(`${API_VERSION_PATH_PREFIX}/designs/${createdDesignId}`)
      .send(updatedDesignData)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });

  // Test Delete Operation
  it('should delete an existing design', async () => {
    await request(app)
      .delete(`${API_VERSION_PATH_PREFIX}/designs/${createdDesignId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);
  });

  // Test Error Delete Operation
  it('should error in design', async () => {
    await request(app)
      .delete(`${API_VERSION_PATH_PREFIX}/designs/9999999`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });
});
