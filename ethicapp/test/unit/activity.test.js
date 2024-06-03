const { Activity, Design } = require('../../backend/api/v2/models');
const designs = require('../fixtures/designs.json')

describe('Activity Model', () => {
    const designActivity = designs[0]
    let designId
    beforeAll(async () => {
        designId = await Design.create(designActivity);
    });

    it('should create an activity associated with a design', async () => {
        const activity = await Activity.create({ design: designId.id, session: 1});
        expect(activity).toHaveProperty('id');
        expect(activity.design).toBe(designId.id);
    });

    it('should not create an activity without a design', async () => {
        await expect(Activity.create({ name: 'Test Activity' }))
            .rejects
            .toThrow();
    });
});
