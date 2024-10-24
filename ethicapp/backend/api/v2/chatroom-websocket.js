const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const router = express.Router();

// Crear el servidor HTTP y el servidor WebSocket
const app = express();
//const  app = require('./testApi');
const server = http.createServer(app);
const io = new Server(server);

// Objeto para almacenar las salas de chat dinámicamente
const chatRooms = {};

// Definir la lógica de WebSocket a nivel global
io.on('connection', (socket) => {
    console.log('Nuevo cliente conectado al espacio global');

    socket.on('disconnect', () => {
        console.log('Cliente desconectado del espacio global');
    });
});

// Endpoint para crear un nuevo chatroom
router.post('/create-chatroom', (req, res) => {
    console.log('Petición para crear un chatroom', req.body);
    const { roomName } = req.body;
    console.log('roomName: ', roomName);
    if (!roomName) {
        return res.status(400).send('Falta el nombre del chatroom');
    }

    // Verifica si la sala ya existe
    if (chatRooms[roomName]) {
        console.log('El chatroom ya existe');
        return res.status(400).send('El chatroom ya existe');
    }

    // Crear un namespace para el nuevo chatroom
    const namespace = io.of(`/${roomName}`);
    
    chatRooms[roomName] = namespace;

    // Configurar eventos dentro del namespace
    namespace.on('connection', (socket) => {
        console.log(`Cliente conectado a la sala: ${roomName}`);

        // Escuchar mensajes en la sala de chat
        socket.on('message', (msg) => {
            console.log(`Mensaje en sala ${roomName}: ${msg}`);
            // Reenviar el mensaje a todos los clientes en la sala
            namespace.emit('message', msg);
        });

        socket.on('disconnect', () => {
            console.log(`Cliente desconectado de la sala: ${roomName}`);
        });
    });

    console.log(`Chatroom creado: ${roomName}`);
    res.status(201).send({ message: `Chatroom '${roomName}' creado con éxito`, namespace: `/${roomName}` });
});

// Hacer que el servidor escuche en un puerto
//const PORT = process.env.PORT || 3001; // Usa el puerto 3001 por defecto
//server.listen(PORT, () => {
//    console.log(`Servidor escuchando en el puerto ${PORT}`);
//});


module.exports = { router, server };
