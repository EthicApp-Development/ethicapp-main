// The teacher's socket service joins its rooms again after a reconnect and
// then tells its listeners (#1116).
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import SocketService from "../socket.service.js";

function fakeSocket() {
    const handlers = {};
    const emitted = [];
    return {
        emitted,
        id: "socket-1",
        on(name, handler) {
            (handlers[name] ||= []).push(handler);
        },
        off(name, handler) {
            handlers[name] = (handlers[name] || []).filter(existing => existing !== handler);
        },
        onAny() {},
        emit(name, payload) {
            emitted.push([name, payload]);
        },
        fire(name, payload) {
            (handlers[name] || []).forEach(handler => handler(payload));
        },
    };
}

function createService() {
    const socket = fakeSocket();
    const urls = [];
    const service = SocketService("teacher", {
        connect: (url) => {
            urls.push(url);
            return socket;
        },
        location: { protocol: "https:", hostname: "ethicapp.test", port: "" },
    });
    return { service, socket, urls };
}

function quietly(run) {
    const originalDebug = console.debug;
    console.debug = () => {};
    try {
        return run();
    } finally {
        console.debug = originalDebug;
    }
}

describe("SocketService rooms", () => {
    it("connects to the namespace on the page's host", () => {
        const { urls } = createService();
        assert.deepEqual(urls, ["https://ethicapp.test/teacher"]);
    });

    it("rejoins the session and group chat rooms after a reconnect, then calls the listeners", () => {
        const { service, socket } = createService();
        const seen = [];
        service.onReconnect(() => seen.push(socket.emitted.length));

        quietly(() => {
            socket.fire("connect");
            service.joinSession(10);
            service.joinGroupChat(7);
            service.joinGroupChat(8);
            service.leaveGroupChat(8);
            socket.emitted.length = 0;

            socket.fire("disconnect", "transport close");
            socket.fire("connect");
        });

        assert.deepEqual(socket.emitted, [["joinSession", 10], ["joinGroupChat", 7]]);
        assert.deepEqual(seen, [2]);
    });

    it("does not rejoin a session it left", () => {
        const { service, socket } = createService();

        quietly(() => {
            socket.fire("connect");
            service.joinSession(10);
            service.leaveSession(10);
            socket.emitted.length = 0;
            socket.fire("connect");
        });

        assert.deepEqual(socket.emitted, []);
    });

    it("still delivers events to subscribers after a reconnect", () => {
        const { service, socket } = createService();
        const received = [];
        const subscription = service.fromEvent("onPhaseClock").subscribe({
            next: data => received.push(data),
        });

        quietly(() => {
            socket.fire("connect");
            socket.fire("connect");
            socket.fire("onPhaseClock", { sessionId: 10 });
        });
        subscription.unsubscribe();
        socket.fire("onPhaseClock", { sessionId: 10 });

        assert.deepEqual(received, [{ sessionId: 10 }]);
    });

    it("tells whether the socket is connected now", () => {
        const { service, socket } = createService();
        assert.equal(service.isConnected(), false);
        socket.connected = true;
        assert.equal(service.isConnected(), true);
        socket.connected = false;
        assert.equal(service.isConnected(), false);
    });
});
