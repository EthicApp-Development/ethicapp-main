// The teacher's group chat sends the teacher's composing signal (epic #601,
// #1200) through the teacher socket: on edits, blur, submit, a change of
// group or question, and when it goes away. It listens to no composing
// notice. The timing itself is tested in helpers/__tests__.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import teacherGroupChatComponent from "../teacher-group-chat.component.js";

// The controller is the last entry of the component's annotated array.
const TeacherGroupChatController = teacherGroupChatComponent.controller.at(-1);

const readAsset = path => readFileSync(new URL(path, import.meta.url), "utf8");
const FRAGMENTS = "../../../static/views/teacher/fragments";

function createFakeSocketService({ connected = true } = {}) {
    const emitted = [];
    const listened = [];
    return {
        connected,
        emitted,
        listened,
        isConnected() {
            return this.connected;
        },
        emitEvent: (eventName, payload) => emitted.push({ eventName, payload }),
        onEvent:   eventName => listened.push(eventName),
        fromEvent: (eventName) => {
            listened.push(eventName);
            return { subscribe: () => ({ unsubscribe() {} }) };
        },
    };
}

const BINDINGS = Object.freeze({ phaseId: 20, questionId: 30, groupId: 9, canUseLiveChat: true });

// A chat as AngularJS builds it: bindings, the first $onChanges, $onInit.
function createChat({ socketService = createFakeSocketService(), bindings = {} } = {}) {
    const sent = [];
    const $timeout = () => {};
    const $element = [{ querySelector: () => null }];
    const vm = new TeacherGroupChatController($timeout, $element, socketService);
    Object.assign(vm, BINDINGS, bindings, {
        messages: [],
        onSend:   (locals) => {
            sent.push({ ...locals, signals: socketService.emitted.length });
            return Promise.resolve();
        },
    });
    const initial = {};
    for (const name of Object.keys(BINDINGS)) {
        initial[name] = { currentValue: vm[name], isFirstChange: () => true };
    }
    vm.$onChanges(initial);
    vm.$onInit();
    return { vm, socketService, sent };
}

function change(vm, values) {
    const changes = {};
    for (const [name, value] of Object.entries(values)) {
        changes[name] = { previousValue: vm[name], currentValue: value, isFirstChange: () => false };
        vm[name] = value;
    }
    vm.$onChanges(changes);
}

function signals(socketService) {
    return socketService.emitted.map(({ eventName, payload }) =>
        [eventName, payload.groupId, payload.questionId, payload.kind]);
}

describe("the teacher's group chat composing signal", () => {
    it("sends composing on the draft's first edit with the chat's ids, never the draft", () => {
        const { vm, socketService } = createChat();
        vm.draftMessage = "Recuerden justificar";
        vm.onDraftChange();
        vm.onDraftChange();
        vm.$onDestroy();

        assert.deepEqual(socketService.emitted[0], {
            eventName: "chatComposing",
            payload:   { phaseId: 20, questionId: 30, groupId: 9, kind: "composing" },
        });
        assert.doesNotMatch(JSON.stringify(socketService.emitted), /Recuerden/u);
    });

    it("sends stopped on blur", () => {
        const { vm, socketService } = createChat();
        vm.onDraftChange();
        vm.onDraftBlur();
        assert.deepEqual(signals(socketService), [
            ["chatComposing", 9, 30, "composing"],
            ["chatComposing", 9, 30, "stopped"],
        ]);
        vm.$onDestroy();
    });

    it("sends stopped on submit, before the message is posted", () => {
        const { vm, socketService, sent } = createChat();
        vm.draftMessage = "Hola";
        vm.onDraftChange();
        vm.sendMessage();

        assert.deepEqual(signals(socketService).map(signal => signal[3]), ["composing", "stopped"]);
        assert.deepEqual(sent, [{ content: "Hola", parentId: null, signals: 2 }]);
        vm.$onDestroy();
    });

    it("sends stopped to the previous group or question when they change", () => {
        const { vm, socketService } = createChat();
        vm.onDraftChange();
        change(vm, { groupId: 10 });
        vm.onDraftChange();
        change(vm, { questionId: 31 });
        vm.$onDestroy();

        assert.deepEqual(signals(socketService), [
            ["chatComposing", 9, 30, "composing"],
            ["chatComposing", 9, 30, "stopped"],
            ["chatComposing", 10, 30, "composing"],
            ["chatComposing", 10, 30, "stopped"],
        ]);
    });

    it("sends stopped when the chat becomes read-only, and nothing while it is", () => {
        const { vm, socketService } = createChat();
        vm.onDraftChange();
        change(vm, { canUseLiveChat: false });
        vm.onDraftChange();
        vm.$onDestroy();
        assert.deepEqual(signals(socketService).map(signal => signal[3]), ["composing", "stopped"]);
    });

    it("sends stopped when the chat goes away", () => {
        const { vm, socketService } = createChat();
        vm.onDraftChange();
        vm.$onDestroy();
        vm.onDraftChange();
        assert.deepEqual(signals(socketService).map(signal => signal[3]), ["composing", "stopped"]);
    });

    it("sends nothing while the teacher socket is disconnected", () => {
        const socketService = createFakeSocketService({ connected: false });
        const { vm } = createChat({ socketService });
        vm.onDraftChange();
        vm.onDraftBlur();
        vm.$onDestroy();
        assert.deepEqual(socketService.emitted, []);
    });

    it("sends nothing without the chat's ids", () => {
        const { vm, socketService } = createChat({ bindings: { questionId: undefined } });
        vm.onDraftChange();
        vm.$onDestroy();
        assert.deepEqual(socketService.emitted, []);
    });

    it("keeps the chat working when the socket fails", () => {
        const socketService = createFakeSocketService();
        socketService.emitEvent = () => {
            throw new Error("socket closed");
        };
        const { vm, sent } = createChat({ socketService });
        vm.draftMessage = "Hola";
        assert.doesNotThrow(() => vm.onDraftChange());
        vm.sendMessage();
        vm.$onDestroy();
        assert.equal(sent.length, 1);
    });

    it("listens to no composing notice", () => {
        const { vm, socketService } = createChat();
        vm.onDraftChange();
        vm.$onDestroy();
        assert.deepEqual(socketService.listened, []);
    });

    it("is wired to the draft's input and to the chat's ids in the templates", () => {
        const chat = readAsset(`${FRAGMENTS}/teacher-group-chat.template.html`);
        assert.match(chat, /ng-change="\$ctrl\.onDraftChange\(\)"/u);
        assert.match(chat, /ng-blur="\$ctrl\.onDraftBlur\(\)"/u);

        const group = readAsset(`${FRAGMENTS}/sd-group-response-detail.template.html`);
        assert.match(group, /phase-id="\$ctrl\.phaseData\.descriptor\.id"/u);
        assert.match(group, /question-id="\$ctrl\.questions\[0\]\.id"/u);
        assert.match(group, /group-id="\$ctrl\.group\.groupId"/u);
        assert.deepEqual(
            ["phaseId", "questionId", "groupId"].map(name => teacherGroupChatComponent.bindings[name]),
            ["<", "<", "<"]
        );
    });
});
