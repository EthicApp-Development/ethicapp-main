const { Phase, Question, Activity  } = require('../../backend/api/v2/models');

describe('Question Model', () => {
    function getRandomInt(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }
    let asdasd
    let sdfsdf
    let phaseQuestion
    const random_phase = getRandomInt(1, 999999999)
  beforeAll(async () => {
    sdfsdf  = await Phase.count();
    phaseQuestion = await Phase.findByPk(sdfsdf-1)
  });
  console.log(sdfsdf)

  it('should create a question associated with a phase', async () => {
    //console.log(sdfsdf)
    const question = await Question.create({ number_phase: phaseQuestion.id, content: { text: 'Test Question' }, additional_info: `Info -phase id -> ${phaseQuestion.id}`, type: 'MCQ', text: 'What is 2+2?', phases_id: phaseQuestion.id});
    expect(question).toHaveProperty('id');
    expect(question.phases_id).toBe(phaseQuestion.id);
  });

  

  it('should not create a duplicate question for the same phase', async () => {
    await Question.create({ number_phase:random_phase, content: { text: 'Test Question' }, additional_info: `Info ${random_phase}`, type: 'MCQ', text: 'What is 2+2?', phases_id: phaseQuestion.id });
    await expect(Question.create({ number_phase: random_phase, content: { text: 'Test Question' }, additional_info: `Info ${random_phase} duplicado`, type: 'MCQ', text: 'What is 2+2?', phases_id: phaseQuestion.id }))
      .rejects
      .toThrow();
  });

  afterAll(async () => {
    await Question.destroy({
      where: {
        number_phase: random_phase,
        phases_id: phaseQuestion.id
      }
    });
  });
});
