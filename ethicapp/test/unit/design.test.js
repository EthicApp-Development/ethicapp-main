// test/design.test.js
const { sequelize } = require('../../backend/api/v2/models');
const { Design } = require('../../backend/api/v2/models');

describe('Design Model', () => {
  beforeAll(async () => {
    // Antes de ejecutar los tests, sincroniza el modelo con la base de datos
    await sequelize.sync({ force: true });
  });

  it('Debería crear un diseño en la base de datos', async () => {
    // Cargar los datos de prueba desde designs.json
    const designsData = require('../fixtures/designs.json');

    // Iterar sobre los datos de prueba y crear instancias de Design
    for (const designData of designsData) {
      await Design.create(designData);
    }

    // Verificar que se han creado los datos de prueba en la base de datos
    const designsCount = await Design.count();
    expect(designsCount).toBe(designsData.length);

    // Otras aserciones según sea necesario para verificar los datos insertados
    // Por ejemplo, puedes hacer una consulta para verificar si los datos insertados coinciden con los datos de prueba.
  });
});
