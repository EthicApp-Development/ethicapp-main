// The teacher socket's rooms are joined again after a reconnect (#1116).
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { trackSocketRooms } from "../socket-rooms.js";

function fakeSocket() {
    const handlers = {};
    const emitted = [];
    return {
        emitted,
        on(name, handler) {
            (handlers[name] ||= []).push(handler);
        },
        emit(name, payload) {
            emitted.push([name, payload]);
        },
        fire(name) {
            (handlers[name] || []).forEach(handler => handler());
        },
    };
}

describe("trackSocketRooms", () => {
    it("emits each join and leave at once", () => {
        const socket = fakeSocket();
        const rooms = trackSocketRooms(socket);

        rooms.join("joinSession", 10);
        rooms.leave("joinSession", 10, "leaveSession");

        assert.deepEqual(socket.emitted, [["joinSession", 10], ["leaveSession", 10]]);
        assert.deepEqual(rooms.rooms(), []);
    });

    it("does not rejoin on the first connect, which sends the buffered joins", () => {
        const socket = fakeSocket();
        const rooms = trackSocketRooms(socket);
        let reconnects = 0;
        rooms.onReconnect(() => reconnects++);

        rooms.join("joinSession", 10);
        socket.fire("connect");

        assert.deepEqual(socket.emitted, [["joinSession", 10]]);
        assert.equal(reconnects, 0);
    });

    it("rejoins the rooms not left on every reconnect, then calls the listeners", () => {
        const socket = fakeSocket();
        const rooms = trackSocketRooms(socket);
        const order = [];
        rooms.onReconnect(() => order.push(["listener", socket.emitted.length]));

        socket.fire("connect");
        rooms.join("joinSession", 10);
        rooms.join("joinSession", 11);
        rooms.join("joinGroupChat", 7);
        rooms.leave("joinSession", 11, "leaveSession");
        socket.emitted.length = 0;

        socket.fire("connect");
        assert.deepEqual(socket.emitted, [["joinSession", 10], ["joinGroupChat", 7]]);
        assert.deepEqual(order, [["listener", 2]], "after the rooms are joined again");

        socket.emitted.length = 0;
        socket.fire("connect");
        assert.deepEqual(socket.emitted, [["joinSession", 10], ["joinGroupChat", 7]]);
        assert.equal(order.length, 2);
    });

    it("keeps one entry for a room joined twice, and tells rooms by their join event", () => {
        const socket = fakeSocket();
        const rooms = trackSocketRooms(socket);

        rooms.join("joinSession", 7);
        rooms.join("joinSession", "7");
        rooms.join("joinGroupChat", 7);

        assert.deepEqual(rooms.rooms(), [
            { joinEvent: "joinSession", roomId: "7" },
            { joinEvent: "joinGroupChat", roomId: 7 },
        ]);
    });

    it("stops calling a listener once stopped, and survives a listener that throws", () => {
        const socket = fakeSocket();
        const rooms = trackSocketRooms(socket);
        let calls = 0;
        const stop = rooms.onReconnect(() => calls++);
        rooms.onReconnect(() => {
            throw new Error("boom");
        });
        const originalError = console.error;
        console.error = () => {};

        try {
            socket.fire("connect");
            socket.fire("connect");
            stop();
            socket.fire("connect");
        } finally {
            console.error = originalError;
        }
        assert.equal(calls, 1);
    });
});
