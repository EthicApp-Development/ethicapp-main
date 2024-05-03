// test/question.test.js
const { sequelize } = require('../../backend/api/v2/models');
const { Question } = require('../../backend/api/v2/models');

describe('Question Model', () => {
  beforeAll(async () => {
    // Antes de ejecutar los tests, sincroniza el modelo con la base de datos
    await sequelize.sync({ force: true });
  });

  it('Debería crear un diseño en la base de datos', async () => {
    // Cargar los datos de prueba desde questions.json
    const questionsData = require('../fixtures/questions.json');

    // Iterar sobre los datos de prueba y crear instancias de Question
    for (const questionData of questionsData) {
      await Question.create(questionData);
    }

    // Verificar que se han creado los datos de prueba en la base de datos
    const questionsCount = await Question.count();
    expect(questionsCount).toBe(questionsData.length);

    // Otras aserciones según sea necesario para verificar los datos insertados
    // Por ejemplo, puedes hacer una consulta para verificar si los datos insertados coinciden con los datos de prueba.
  });
});
