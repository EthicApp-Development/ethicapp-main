const request = require('supertest');
const  app = require('../../testApi');  // Asegúrate de que importas tanto `app` como `server`
const server = require('../../testApi');  // Asegúrate de que importas tanto `app` como `server`\
const io = require('socket.io-client');
let testServer;

describe('Chatroom WebSocket API', () => {
    const PORT = process.env.PORT || 0;
    beforeAll((done) => {
        testServer = server.listen(PORT, () => {
            console.log('Test server listening on port 3001');
            done();
        });
    });

    afterAll((done) => {
        testServer.close(() => {
            done();
        });
    });

    it('should create a new chatroom and return 201', async () => {
        const response = await request(testServer)
            .post('/api/v2/create-chatroom')
            .send({ roomName: 'test-room' })
            .expect(201);

        expect(response.body.message).toBe("Chatroom 'test-room' creado con éxito");
        expect(response.body.namespace).toBe('/test-room');
        console.log('Chatroom creado:', response.body);
    });

    it('should allow clients to connect to the chatroom namespace and exchange messages', (done) => {
        const roomName = 'test-room2';
        
        // Crear el chatroom primero
        request(testServer)
            .post('/api/v2/create-chatroom')
            .send({ roomName })
            .expect(201)
            .then((response) => {
                console.log('Chatroom creado:');
                const namespace = response.body.namespace;
                console.log('namespace elegido: ', namespace);
                const clientSocket = io(`http://localhost:${PORT}${namespace}`);
                console.log('Cliente conectado al chatroom1');
                console.log(clientSocket);
                clientSocket.emit('message', 'Hello World!');
                

                clientSocket.on('message', (msg) => {
                    try {
                        expect(msg).toBe('Hello World!');
                        clientSocket.disconnect();
                        done();
                    } catch (error) {
                        done(error);
                    }
                });
            })
            .catch((error) => done(error));
    });
});