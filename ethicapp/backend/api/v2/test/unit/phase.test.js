const { Phase, Activity, User, Design } = require('../../models');
const request = require('supertest');
const app = require('../../testApi');
const designData = require('../fixtures/designs.json')
const API_VERSION_PATH_PREFIX = process.env.API_VERSION_PATH_PREFIX || '/api/v2';

describe('Phase Model', () => {
    let activityId
    let userId
    let token;
    let designId
    function getRandomInt(min, max) {
      return Math.floor(Math.random() * (max - min + 1)) + min;
    }
    const random_number = getRandomInt(0,9999)
    beforeAll(async () => {
      const user = await User.create({
        name: `Test User for phase`,
        rut: `11222333-k`,
        pass: `passphase`,
        pass_confirmation: `passphase`,
        mail: `testuserphase@example.com`,
        sex: 'M',
        role: 'A',
    });

    // Asignar el id del usuario creado a la variable global userId
    userId = user.dataValues.id;

    // Login to get the token
    const loginRes = await request(app)
        .post(`${API_VERSION_PATH_PREFIX}/login_user`)
        .send({ mail: `testuserphase@example.com`, pass: `passphase` });

    token = loginRes.body.token;

    //console.log('token -->', token);
        activityId = await Activity.create({ design: 1, session: 1 });
    });
  
    it('should create a phase associated with an activity', async () => {
      const phase = await Phase.create({ number: random_number, type: `Test activity ${activityId.id}`, anon: true, chat: false, prev_ans: 'None', activity_id: activityId.id });
      expect(phase).toHaveProperty('id');
      expect(phase.activity_id).toBe(activityId.id);
    });
  
    it('should not create a phase without an activity', async () => {
      await expect(Phase.create({ number: random_number+1, type: `Test with not activity`, anon: true, chat: false, prev_ans: 'None' }))
        .rejects
        .toThrow();
    });
  
    // it('should not create a duplicate phase for the same activity', async () => {
    //     await request(app)
    //   .post(`${API_VERSION_PATH_PREFIX}/phases`)
    //   .send({ number: random_number+2, type: `Test activity duplicated${activityId.id-1}`, anon: true, chat: false, prev_ans: 'None', activity_id: activityId.id-1 })
    //   .set('Authorization', `Bearer ${token}`);

    //   const phaseRes = await request(app)
    //   .post(`${API_VERSION_PATH_PREFIX}/phases`)
    //   .send({ number: random_number+2, type: `Test activity duplicated${activityId.id-1}`, anon: true, chat: false, prev_ans: 'None', activity_id: activityId.id-1 })
    //   .set('Authorization', `Bearer ${token}`);

    //   expect(phaseRes.status).toBe(400);
    //   expect(phaseRes.body).toHaveProperty('status', 'error');
    

    // });
    it('should not create a duplicate phase for the same design', async () => {

      const resPhaseDesign = await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/phases/design`)
      .send({ number: 2, type: `Test activity duplicated${activityId.id-1}`, anon: true, chat: false, prev_ans: 'None', activity_id: 6 })
    
      console.log("resPhaseDesign", resPhaseDesign.body)
      expect(resPhaseDesign.status).toBe(400)
      expect(resPhaseDesign.body).toHaveProperty('status','error')
      expect(resPhaseDesign.body.message).toBe('phase number is exist in the design')
    
    })

  });