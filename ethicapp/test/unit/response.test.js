// test/response.test.js
const { sequelize } = require('../../backend/api/v2/models');
const { Response } = require('../../backend/api/v2/models');

describe('Response Model', () => {
  beforeAll(async () => {
    // Antes de ejecutar los tests, sincroniza el modelo con la base de datos
    await sequelize.sync({ force: true });
  });

  it('Debería crear un diseño en la base de datos', async () => {
    // Cargar los datos de prueba desde responses.json
    const responsesData = require('../fixtures/responses.json');

    // Iterar sobre los datos de prueba y crear instancias de Response
    for (const responseData of responsesData) {
      await Response.create(responseData);
    }

    // Verificar que se han creado los datos de prueba en la base de datos
    const responsesCount = await Response.count();
    expect(responsesCount).toBe(responsesData.length);

    // Otras aserciones según sea necesario para verificar los datos insertados
    // Por ejemplo, puedes hacer una consulta para verificar si los datos insertados coinciden con los datos de prueba.
  });
});
