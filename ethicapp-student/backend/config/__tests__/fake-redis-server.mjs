import net from 'node:net';

const CRLF = '\r\n';

// Parses one RESP array of bulk strings, the only shape node-redis sends.
function parseCommand(buffer) {
  let lineEnd = buffer.indexOf(CRLF);
  if (lineEnd < 0) {
    return null;
  }

  const count = Number(buffer.subarray(1, lineEnd).toString());
  const args = [];
  let position = lineEnd + 2;

  for (let index = 0; index < count; index += 1) {
    lineEnd = buffer.indexOf(CRLF, position);
    if (lineEnd < 0) {
      return null;
    }
    const length = Number(buffer.subarray(position + 1, lineEnd).toString());
    const start = lineEnd + 2;
    if (start + length + 2 > buffer.length) {
      return null;
    }
    args.push(buffer.subarray(start, start + length).toString());
    position = start + length + 2;
  }

  return { args, length: position };
}

/**
 * Minimal Redis stand-in for GET/SET/EXPIRE/DEL/PUBLISH. `stall()` keeps every
 * connection open but stops replying, like a Redis process paused with
 * SIGSTOP; `resume()` then applies and answers the held commands in order.
 */
export async function startFakeRedisServer() {
  const data = new Map();
  const published = [];
  const sockets = new Set();
  let held = [];
  let stalled = false;

  const execute = ([name, ...args]) => {
    switch (name.toUpperCase()) {
      case 'GET': {
        const value = data.get(args[0]);
        return value === undefined ? `$-1${CRLF}` : `$${Buffer.byteLength(value)}${CRLF}${value}${CRLF}`;
      }
      case 'PUBLISH':
        published.push({ channel: args[0], message: args[1] });
        return `:1${CRLF}`;
      case 'SET':
        data.set(args[0], args[1]);
        return `+OK${CRLF}`;
      case 'EXPIRE':
        return `:${data.has(args[0]) ? 1 : 0}${CRLF}`;
      case 'DEL':
        return `:${args.filter((key) => data.delete(key)).length}${CRLF}`;
      default:
        return `+OK${CRLF}`;
    }
  };

  const server = net.createServer((socket) => {
    sockets.add(socket);
    let buffer = Buffer.alloc(0);

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      let parsed = parseCommand(buffer);
      while (parsed) {
        buffer = buffer.subarray(parsed.length);
        if (stalled) {
          held.push({ socket, args: parsed.args });
        } else {
          socket.write(execute(parsed.args));
        }
        parsed = parseCommand(buffer);
      }
    });
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  return {
    port: server.address().port,
    published,
    stall() {
      stalled = true;
    },
    resume() {
      stalled = false;
      const pending = held;
      held = [];
      for (const { socket, args } of pending) {
        const reply = execute(args);
        if (!socket.destroyed) {
          socket.write(reply);
        }
      }
    },
    /** Commands held while stalled on connections the client still keeps open. */
    heldOnOpenConnections() {
      return held.filter(({ socket }) => !socket.destroyed).length;
    },
    async close() {
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise((resolve) => server.close(resolve));
    }
  };
}
