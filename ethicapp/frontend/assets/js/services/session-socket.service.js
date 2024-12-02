let SessionSocketService = function(sessionId) {
    const socket = socketFactory({
        ioSocket: io.connect('/session/' + sessionId)
    });
    return socket;
};

export { SessionSocketService };