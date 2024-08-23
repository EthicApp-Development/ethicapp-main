const request = require('supertest');
const app = require('../../../app'); // Asegúrate de que la ruta es correcta

describe('API Tests with Supertest', () => {

    it('should get all users', async () => {
        const response = await request(app)
            .get('/users')
            .expect(200); // Espera que el código de estado sea 200

        // Puedes agregar más expectativas según lo que esperas que devuelva la API
        console.log(response.text); // Imprime la respuesta para ver qué devuelve
    }, 5000);
});
