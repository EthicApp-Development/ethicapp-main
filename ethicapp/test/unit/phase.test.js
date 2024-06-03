const { Phase, Activity } = require('../../backend/api/v2/models');

describe('Phase Model', () => {
    let activityId
    beforeAll(async () => {
        activityId = await Activity.create({ design: 1, session: 1 });
    });
  
    it('should create a phase associated with an activity', async () => {
      const phase = await Phase.create({ number: 10, type: `Test activity ${activityId.id}`, anon: true, chat: false, prev_ans: 'None', activity_id: activityId.id });
      expect(phase).toHaveProperty('id');
      expect(phase.activity_id).toBe(activityId.id);
    });
  
    it('should not create a phase without an activity', async () => {
      await expect(Phase.create({ number: 11, type: `Test with not activity`, anon: true, chat: false, prev_ans: 'None' }))
        .rejects
        .toThrow();
    });
  
    it('should not create a duplicate phase for the same activity', async () => {
      await Phase.create({ number: 12, type: `Test activity duplicated${activityId.id-2}`, anon: true, chat: false, prev_ans: 'None', activity_id: activityId.id-2 });
      await expect(Phase.create({ number: 12, type: `Test activity duplicateds${activityId.id-2}`, anon: true, chat: false, prev_ans: 'None', activity_id: activityId.id-2 }))
        .rejects
        .toThrow();
    });
  });