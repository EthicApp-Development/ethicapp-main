const { Phase, Activity, User, Design } = require('../../models');
const request = require('supertest');
const app = require('../../testApi');
const userOnlyDesign = require('../fixtures/onlyDesign.json')
const API_VERSION_PATH_PREFIX = process.env.API_VERSION_PATH_PREFIX || '/api/v2';

describe('Phase Model', () => {
  let activityId
  let userId
  let token;

  beforeAll(async () => {
    await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/users`)
      .send({
        name: `Test User for phase`,
        rut: `11222333-k`,
        pass: `passphase`,
        pass_confirmation: `passphase`,
        mail: `testuserphase@example.com`,
        sex: 'M',
        role: 'P',
      })


    // Asignar el id del usuario creado a la variable global userId


    // Login to get the token
    const loginRes = await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/authenticate_client`)
      .send({ mail: `testuserphase@example.com`, pass: `passphase` });

    token = loginRes.body.token;
    userId = loginRes.body.userId;
    //console.log('token -->', token);

    await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/designs`)
      .send({
        creator: userId,
        design: userOnlyDesign[0],
        public: true,
        locked: false
      })
      .set('Authorization', `Bearer ${token}`)

    const sessionRes = await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/sessions`)
      .send({
        name: "AAAAAAAAAAAAAAAAAAAAAA",
        descr: "lorem impsum |lorem impsum |lorem impsum",
        status: 1,
        time: new Date(),
        type: 'A',
        creator: userId
      })
      .set('Authorization', `Bearer ${token}`)
    //console.log(sessionRes.body.data)
    activityId = sessionRes.body.data.activity
  });

  it('should create a phase associated with an activity', async () => {
    const phase = await request(app)
    .post(`${API_VERSION_PATH_PREFIX}/phases`)
    .send({
      number: 999,
      type: `Test activity ${activityId.id}`,
      anon: true,
      chat: false,
      prev_ans: 'None',
      activity_id: activityId.id
    })
    .set('Authorization', `Bearer ${token}`)

    // console.log(phase.body)
    // console.log(activityId.id)
    expect(phase.body).toHaveProperty('status', 'success')
  });

  it('should not create a phase without an activity', async () => {
    await expect(Phase.create({ number: 999 + 1, type: `Test with not activity`, anon: true, chat: false, prev_ans: 'None' }))
      .rejects
      .toThrow();
  });

  it('should not create a duplicate phase for the same design', async () => {

    const resPhaseDesign = await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/designs/${1}/phases`)
      .send({
        number: 2,
        type: `Test activity duplicated${activityId.id - 1}`,
        anon: true,
        chat: false,
        prev_ans: 'None',
        activity_id: activityId.id
      })

    //console.log("resPhaseDesign", resPhaseDesign.body)
    expect(resPhaseDesign.status).toBe(400)
    expect(resPhaseDesign.body).toHaveProperty('status', 'error')
    expect(resPhaseDesign.body.message).toBe('phase number is exist in the design')

  })
  it('should create phase for different number', async () => {

    const resPhaseDesign = await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/designs/${1}/phases`)
      .send({
        number: 3,
        type: `Test activity duplicated${activityId.id - 1}`,
        anon: true,
        chat: false,
        prev_ans: 'None',
        activity_id: activityId.id
      })

    //console.log("resPhaseDesign", resPhaseDesign.body)
    expect(resPhaseDesign.status).toBe(201)
    expect(resPhaseDesign.body).toHaveProperty('status', 'success')
  });
  it('should get the activity with its phases via API', async () => {
    const res = await request(app)
      .get(`${API_VERSION_PATH_PREFIX}/activities/${activityId.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.status).toBe('success');
    expect(Array.isArray(res.body.data.phases)).toBe(true);
    expect(res.body.data.phases.length).toBeGreaterThan(0);

    res.body.data.phases.forEach(phase => {
      expect(phase).toHaveProperty('id');
      expect(phase).toHaveProperty('number');
      expect(phase).toHaveProperty('status');
      expect(['inprogress', 'done']).toContain(phase.status);//aqui dejar solo inprogress y done
    });
  });
});