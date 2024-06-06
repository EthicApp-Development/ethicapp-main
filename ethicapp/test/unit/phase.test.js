const { Phase, Activity } = require('../../backend/api/v2/models');
const request = require('supertest');
const app = require('../../backend/api/v2/testApi');
const API_VERSION_PATH_PREFIX = process.env.API_VERSION_PATH_PREFIX || '/api/v2';

describe('Phase Model', () => {
    let activityId
    function getRandomInt(min, max) {
      return Math.floor(Math.random() * (max - min + 1)) + min;
    }
    const random_number = getRandomInt(0,9999)
    beforeAll(async () => {
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
  
    it('should not create a duplicate phase for the same activity', async () => {
        await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/phasesTesting`)
      .send({ number: random_number+2, type: `Test activity duplicated${activityId.id-2}`, anon: true, chat: false, prev_ans: 'None', activity_id: activityId.id-2 })

      const phaseRes = await request(app)
      .post(`${API_VERSION_PATH_PREFIX}/phasesTesting`)
      .send({ number: random_number+2, type: `Test activity duplicated${activityId.id-2}`, anon: true, chat: false, prev_ans: 'None', activity_id: activityId.id-2 })

      expect(phaseRes.status).toBe(400);
      expect(phaseRes.body).toHaveProperty('status', 'error');
    

    });
  });