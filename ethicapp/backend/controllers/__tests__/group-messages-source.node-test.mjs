// The chat-message-received hook names the saved message as its `source`, so
// each of its jobs records the message it processed (#946, epic #620).
// saveChatMessage() returns the inserted row of differential_chat (or chat for
// ranking), or `true` when the insert returned no row.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { chatMessageSource } from "../group-messages.js";

describe("chatMessageSource", () => {
    it("names the saved message by its id", () => {
        assert.deepEqual(chatMessageSource({ id: 77, uid: 9, content: "Hello" }),
            { kind: "chat_message", id: 77 });
        assert.deepEqual(chatMessageSource({ id: "78" }), { kind: "chat_message", id: 78 });
    });

    it("names no source when the saved message has no usable id", () => {
        for (const savedMessage of [true, null, undefined, {}, { id: 0 }, { id: "x" }]) {
            assert.equal(chatMessageSource(savedMessage), null);
        }
    });
});
