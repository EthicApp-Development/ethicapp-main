const { Phase, Question, Activity  } = require('../../backend/api/v2/models');

describe('Question Model', () => {
    function getRandomInt(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }
    let idPhase
    const random_phase = getRandomInt(1, 999999999)
    const randomPhaseQuestion = getRandomInt(1, 99999)
    let randomPhase
  beforeAll(async () => {
    idPhase  = await Phase.count();
    //phaseQuestion = await Phase.findByPk(idPhase-1)
    randomPhase = getRandomInt(1, idPhase)
  });
  console.log(idPhase)

  it('should create a question associated with a phase', async () => {
    const question = await Question.create({ number_phase: randomPhaseQuestion, content: { text: 'Test Question' }, additional_info: `Info -phase id -> ${randomPhase}`, type: 'MCQ', text: 'What is 2+2?', phases_id: 2});
    expect(question).toHaveProperty('id');
    expect(question.phases_id).toBe(2);
  });



  it('should not create a duplicate question for the same phase', async () => {
    await Question.create({ number_phase:random_phase, content: { text: 'Test Question' }, additional_info: `Info ${random_phase}`, type: 'MCQ', text: 'What is 2+2?', phases_id: 2 });
    await expect(Question.create({ number_phase: random_phase, content: { text: 'Test Question' }, additional_info: `Info ${random_phase} duplicado`, type: 'MCQ', text: 'What is 2+2?', phases_id: 2}))
      .rejects
      .toThrow();
  });

  afterAll(async () => {
    await Question.destroy({
      where: {
        number_phase: random_phase,
        phases_id: 2
      }
    });
  });

});
