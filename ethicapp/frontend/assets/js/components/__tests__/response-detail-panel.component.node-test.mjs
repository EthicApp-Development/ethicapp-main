// The response detail panel and its contents (#896, epic #892): the panel's
// keys, focus and layout, a student's answers, and a group's answers and live
// chat, which load, subscribe and send as the group modal did.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import responseDetailPanelComponent from "../response-detail-panel.component.js";
import sdGroupResponseDetailComponent from "../sd-group-response-detail.component.js";
import sdStudentResponseDetailComponent from "../sd-student-response-detail.component.js";
import { phaseNavigatorTemplateUrl } from "../phase-navigator.component.js";
import { fakeResizeWindow } from "../../helpers/__tests__/fake-windows.mjs";

// The controller is the last entry of each component's annotated array.
const PanelController = responseDetailPanelComponent.controller.at(-1);
const GroupController = sdGroupResponseDetailComponent.controller.at(-1);
const StudentController = sdStudentResponseDetailComponent.controller.at(-1);

const readAsset = path => readFileSync(new URL(path, import.meta.url), "utf8");
const locale = name => JSON.parse(readAsset(`../../../locales/${name}.json`));
const FRAGMENTS = "../../../static/views/teacher/fragments";

// Lets pending promises and the digests they queue run.
const settle = () => new Promise(resolve => setImmediate(resolve));

function groupPhaseData(state) {
    return {
        descriptor: {
            id:        41,
            number:    2,
            mode:      "team",
            chat:      true,
            questions: [
                { id: 90, number: 1, text: "¿Avisar?", range: 4, justify: true },
                { id: 91, number: 2, text: "¿Cuánto pesa?", range: 6, justify: false },
            ],
        },
        state,
    };
}

function groupState() {
    return [
        { userId: 1, userName: "Ana", groupId: 7, groupNumber: 1, r1: 2, r2: 3 },
        { userId: 2, userName: "Beto", groupId: 7, groupNumber: 1, r1: null, r2: null },
        {
            groupStatistics: true,
            groupId:         7,
            groupNumber:     1,
            groupName:       "Grupo 1",
            totalChatCount:  2,
        },
    ];
}

function createPanel(bindings = {}, { innerHeight = 1080, rows = {} } = {}) {
    const timeouts = [];
    const focused = [];
    const calls = { navigate: [], close: 0, openGroup: [] };
    const heading = { focus: () => focused.push("heading") };
    const element = {
        querySelector: selector => (selector === ".response-detail-heading" ? heading : null),
    };
    const $window = fakeResizeWindow(1920);
    $window.innerHeight = innerHeight;
    $window.document = {
        querySelector: selector => {
            const key = /data-detail-key="([^"]+)"/.exec(selector)?.[1];
            return rows[key] ? { focus: () => focused.push(key) } : null;
        },
    };
    const $scope = { $applyAsync: fn => fn() };
    const $timeout = (fn, delay, invokeApply) => timeouts.push({ fn, delay, invokeApply });
    const vm = new PanelController($scope, [element], $timeout, $window);
    Object.assign(vm, {
        onNavigate: locals => calls.navigate.push(locals.step),
        onClose:    () => {
            calls.close += 1;
        },
        onOpenGroup: locals => calls.openGroup.push(locals.group),
    }, bindings);
    const flush = () => {
        while (timeouts.length > 0) {
            timeouts.shift().fn();
        }
    };
    return { vm, $window, timeouts, focused, calls, flush };
}

const change = (currentValue, first = false) => ({ currentValue, isFirstChange: () => first });

describe("response detail panel", () => {
    it("focuses its heading on open and whenever it shows another row", () => {
        const selection = { kind: "student", key: "student:1" };
        const { vm, focused, flush, timeouts } = createPanel({ selection });
        vm.$onInit();
        vm.$onChanges({ selection: change(selection, true) });
        assert.deepEqual(vm.contents, [selection]);
        assert.equal(timeouts.length, 0, "the heading is not linked yet");

        vm.$postLink();
        assert.equal(timeouts[0].invokeApply, false);
        flush();
        assert.deepEqual(focused, ["heading"]);

        const next = { kind: "group", key: "group:7" };
        vm.selection = next;
        vm.$onChanges({ selection: change(next) });
        flush();
        assert.deepEqual(vm.contents, [next]);
        assert.deepEqual(focused, ["heading", "heading"]);
    });

    it("keeps its content while the same row is selected again", () => {
        const selection = { kind: "group", key: "group:7" };
        const { vm } = createPanel({ selection });
        vm.$onChanges({ selection: change(selection, true) });
        const contents = vm.contents;

        vm.$onChanges({ selection: change({ ...selection }) });
        assert.equal(vm.contents, contents, "the group's chat stays subscribed");
    });

    it("closes on Escape and on ×, and gives the focus back to the row", () => {
        const selection = { kind: "student", key: "student:3" };
        const rows = { "student:3": true };
        const { vm, calls, focused, flush } = createPanel({ selection }, { rows });
        let prevented = 0;

        vm.onKeydown({ key: "Escape", target: {}, preventDefault: () => prevented++ });
        flush();
        assert.equal(calls.close, 1);
        assert.equal(prevented, 1);
        assert.deepEqual(focused, ["student:3"]);

        vm.close();
        flush();
        assert.equal(calls.close, 2);
    });

    it("moves to the previous and next rows with ‹ › and ↑ ↓, not past either end", () => {
        const { vm, calls } = createPanel({
            selection: { kind: "student", key: "student:3" }, hasPrevious: true, hasNext: false,
        });
        const target = { tagName: "H3", getAttribute: () => null };

        vm.onKeydown({ key: "ArrowUp", target, preventDefault() {} });
        vm.onKeydown({ key: "ArrowDown", target, preventDefault() {} });
        vm.navigate(-1);
        vm.navigate(1);
        vm.onKeydown({ key: "ArrowDown", target: { tagName: "INPUT" }, preventDefault() {} });
        assert.deepEqual(calls.navigate, [-1, -1]);
    });

    it("shows a group as tabs in a short window and follows the window's height", () => {
        const { vm, $window } = createPanel({}, { innerHeight: 768 });
        vm.$onInit();
        assert.equal(vm.useTabs, true);

        $window.innerHeight = 1080;
        $window.resize(1920);
        assert.equal(vm.useTabs, false);

        vm.$onDestroy();
        assert.equal($window.listeners.size, 0);
    });

    it("links a student of a group phase to the group, and counts a group's members", () => {
        const phaseData = groupPhaseData(groupState());
        const { vm, calls } = createPanel({
            selection: { kind: "student", key: "student:1", userId: 1 },
            row:       phaseData.state[0],
            phaseData,
        });
        assert.equal(vm.studentGroup(), phaseData.state[2]);
        vm.openStudentGroup();
        assert.deepEqual(calls.openGroup, [phaseData.state[2]]);

        vm.selection = { kind: "group", key: "group:7", groupId: 7 };
        vm.row = phaseData.state[2];
        assert.equal(vm.studentGroup(), null);
        assert.deepEqual(vm.groupCounts(), { answered: 1, participants: 2 });
        assert.equal(vm.isChatPhase(), true);
    });

    it("has no group link outside a group", () => {
        const phaseData = { descriptor: { id: 40, mode: "individual" }, state: [{ userId: 5 }] };
        const { vm, calls } = createPanel({
            selection: { kind: "student", key: "student:5" }, row: phaseData.state[0], phaseData,
        });
        vm.openStudentGroup();
        assert.equal(vm.studentGroup(), null);
        assert.deepEqual(calls.openGroup, []);
        assert.equal(vm.phaseModeKey(), "activity_bar_phase_mode_individual");
    });
});

describe("student response detail", () => {
    it("shows the student's live answers and justifications", () => {
        const vm = new StudentController();
        vm.phaseData = groupPhaseData([]);
        vm.response = { userId: 1, r1: 3, commentR1: "Porque sí" };
        vm.$onChanges({ phaseData: change(vm.phaseData, true) });

        assert.deepEqual(vm.questions.map(question => question.number), [1, 2]);
        assert.equal(vm.getResponseValue(vm.questions[0]), 3);
        assert.equal(vm.getResponseComment(vm.questions[0]), "Porque sí");
        assert.equal(vm.getResponseValue(vm.questions[1]), null);
        assert.equal(vm.getResponseComment(vm.questions[1]), "");
        assert.deepEqual(vm.buildScaleOptions(vm.questions[0]), [1, 2, 3, 4]);

        vm.response = { userId: 1, r1: 4 };
        assert.equal(vm.getResponseValue(vm.questions[0]), 4, "a new answer shows at once");
    });
});

describe("group response detail", () => {
    function createGroup(bindings = {}, { responses = [], messages = [], loadError = null } = {}) {
        const calls = { responses: [], loads: [], subscribed: [], unsubscribed: 0, sent: [] };
        let onLiveMessage = null;
        const ActivityStateService = {
            getGroupResponses: async (groupId, phaseId) => {
                calls.responses.push([groupId, phaseId]);
                return responses;
            },
        };
        const TeacherGroupChatService = {
            loadMessages: async (groupId, questionId) => {
                calls.loads.push([groupId, questionId]);
                if (loadError) {
                    throw loadError;
                }
                return messages;
            },
            subscribeToGroup: (groupId, onMessage) => {
                calls.subscribed.push(groupId);
                onLiveMessage = onMessage;
                return () => {
                    calls.unsubscribed += 1;
                };
            },
            sendMessage: async payload => {
                calls.sent.push(payload);
                return { id: 100, uid: 50, authorRole: "P", content: payload.content };
            },
        };
        const labels = { teacher_chat_author_label: "Docente" };
        const $translate = { instant: key => labels[key] ?? key };
        const $scope = { $applyAsync: fn => fn() };
        const element = [{ querySelector: () => null }];
        const vm = new GroupController($scope, $translate, fakeResizeWindow(1920), element,
            ActivityStateService, TeacherGroupChatService);
        const state = groupState();
        Object.assign(vm, {
            group:          state[2],
            phaseData:      groupPhaseData(state),
            canUseLiveChat: true,
            useTabs:        false,
            initialTab:     "answers",
        }, bindings);
        vm.$onChanges({ phaseData: change(vm.phaseData, true) });
        vm.$onInit();
        vm.$doCheck();
        return { vm, calls, live: message => onLiveMessage(message) };
    }

    const RESPONSES = [
        { userId: 1, userName: "Ana", questionId: 90, questionOrder: 1, value: 2, comment: "Sí" },
        { userId: 1, userName: "Ana", questionId: 91, questionOrder: 2, value: 3 },
    ];
    const MESSAGES = [
        { id: 1, uid: 1, authorRole: "A", content: "Hola" },
        { id: 2, uid: 50, authorRole: "P", content: "¿Por qué?" },
    ];

    it("loads the group's answers and chat, and follows its live chat until it goes", async () => {
        const { vm, calls, live } = createGroup({}, { responses: RESPONSES, messages: MESSAGES });
        await settle();

        assert.deepEqual(calls.responses, [[7, 41]]);
        assert.deepEqual(calls.loads, [[7, 90]]);
        assert.deepEqual(calls.subscribed, [7]);
        assert.equal(vm.getQuestionResponses(vm.questions[0]).length, 1);
        assert.deepEqual(vm.chatMessages.map(message => message.id), [1, 2]);

        live({ id: 3, uid: 2, authorRole: "A", content: "Nuevo" });
        live({ id: 3, uid: 2, authorRole: "A", content: "Nuevo" });
        assert.deepEqual(vm.chatMessages.map(message => message.id), [1, 2, 3]);

        vm.$onDestroy();
        assert.equal(calls.unsubscribed, 1);
    });

    it("names the teacher \"Docente\" and the students by name", async () => {
        const { vm } = createGroup({}, { responses: RESPONSES, messages: MESSAGES });
        await settle();
        assert.equal(vm.getChatAuthorName(MESSAGES[1]), "Docente");
        assert.equal(vm.getChatAuthorName(MESSAGES[0]), "Ana");
        assert.equal(vm.getChatAuthorName({ uid: 2 }), "Beto", "a member who has not answered yet");
        assert.equal(vm.isTeacherMessage(MESSAGES[1]), true);
    });

    it("sends the teacher's messages and replies to the group's chat", async () => {
        const { vm, calls } = createGroup({}, { messages: MESSAGES });
        await settle();

        await vm.sendChatMessage("Buen punto", 1);
        await settle();
        assert.deepEqual(calls.sent, [
            { phaseId: 41, questionId: 90, groupId: 7, content: "Buen punto", parentId: 1 },
        ]);
        assert.deepEqual(vm.chatMessages.map(message => message.id), [1, 2, 100]);
        assert.equal(vm.chatSending, false);
    });

    it("keeps an earlier phase's chat read-only: no subscription, nothing sent", async () => {
        const { vm, calls } = createGroup({ canUseLiveChat: false }, { messages: MESSAGES });
        await settle();
        await vm.sendChatMessage("Hola");

        assert.deepEqual(calls.subscribed, []);
        assert.deepEqual(calls.sent, []);
        assert.deepEqual(vm.chatMessages.map(message => message.id), [1, 2]);
    });

    it("opens its tabs on the answers and counts the messages that arrive meanwhile", async () => {
        const { vm, live } = createGroup({ useTabs: true }, { messages: MESSAGES });
        await settle();
        vm.$doCheck();
        assert.equal(vm.isTabSelected("answers"), true);
        assert.equal(vm.unreadCount(), 0, "the transcript it opened with counts as seen");

        live({ id: 3, uid: 1, authorRole: "A", content: "¿Y ahora?" });
        live({ id: 4, uid: 50, authorRole: "P", content: "Mío" });
        vm.$doCheck();
        assert.equal(vm.unreadCount(), 1, "the teacher's own message is not counted");

        vm.selectTab("chat");
        vm.$doCheck();
        assert.equal(vm.unreadCount(), 0);
        vm.selectTab("answers");
        assert.equal(vm.unreadCount(), 0, "seen once shown");
    });

    it("opens on the chat when the teacher came from a student's link", () => {
        const { vm } = createGroup({ useTabs: true, initialTab: "chat" });
        assert.equal(vm.isTabSelected("chat"), true);
        assert.equal(vm.isChatVisible(), true);
    });

    it("sums up the group's values and reads the answers again when one changes", async () => {
        const { vm, calls } = createGroup({}, { responses: RESPONSES });
        await settle();
        assert.deepEqual(vm.digest.map(item => item.text), ["2 · —", "3 · —"]);

        vm.$doCheck();
        assert.equal(calls.responses.length, 1, "nothing changed");

        const state = groupState();
        state[1].r1 = 4;
        vm.phaseData = groupPhaseData(state);
        vm.$onChanges({ phaseData: change(vm.phaseData) });
        vm.$doCheck();
        await settle();
        assert.equal(calls.responses.length, 2);
        assert.deepEqual(vm.digest.map(item => item.text), ["2 · 4", "3 · —"]);
    });

    it("says so when the chat cannot load, in the teacher's language", async () => {
        const { vm } = createGroup({}, { loadError: new Error("offline") });
        const originalError = console.error;
        console.error = () => {};
        try {
            await settle();
        } finally {
            console.error = originalError;
        }
        assert.equal(vm.chatLoading, false);
        assert.equal(vm.chatError, "Unable to load chat messages.");
    });

    it("ignores what arrives after it closed", async () => {
        const { vm, live } = createGroup({}, { responses: RESPONSES, messages: MESSAGES });
        vm.$onDestroy();
        await settle();
        live({ id: 3, uid: 1, authorRole: "A", content: "Tarde" });
        assert.deepEqual(vm.responses, []);
        assert.deepEqual(vm.chatMessages, []);
    });

    it("moves the splitter with the arrow keys, leaving room for both parts", () => {
        const elements = {
            ".response-detail-group":    { clientHeight: 612 },
            ".response-detail-answers":  { offsetHeight: 300 },
            ".response-detail-splitter": { offsetHeight: 12 },
        };
        const vm = new GroupController({ $applyAsync: fn => fn() }, {}, fakeResizeWindow(1920),
            [{ querySelector: selector => elements[selector] || null }], {}, {});
        let prevented = 0;
        const key = name => ({ key: name, preventDefault: () => prevented++ });

        vm.onSplitterKeydown(key("ArrowDown"));
        assert.equal(vm.answersHeight, 324);
        assert.deepEqual(vm.answersStyle(), { flex: "0 1 324px" });
        for (let i = 0; i < 20; i++) {
            vm.onSplitterKeydown(key("ArrowUp"));
        }
        assert.equal(vm.answersHeight, 140);
        vm.onSplitterKeydown(key("Home"));
        assert.equal(prevented, 21);

        vm.useTabs = true;
        assert.deepEqual(vm.answersStyle(), {});
    });
});

describe("response detail templates", () => {
    it("folds the rail into phase dots with layout=\"dots\"", () => {
        assert.match(phaseNavigatorTemplateUrl("dots"), /\/phase-dots\.template\.html$/);
        assert.match(phaseNavigatorTemplateUrl("other"), /\/phase-navigator\.template\.html$/);
    });

    it("reuses the chat unchanged and has every key in both locales", () => {
        const panel = readAsset(`${FRAGMENTS}/response-detail-panel.template.html`);
        const group = readAsset(`${FRAGMENTS}/sd-group-response-detail.template.html`);
        const sources = [
            panel,
            group,
            readAsset(`${FRAGMENTS}/sd-student-response-detail.template.html`),
            readAsset(`${FRAGMENTS}/phase-dots.template.html`),
            readAsset("../response-detail-panel.component.js"),
            readAsset("../sd-group-response-detail.component.js"),
        ].join("\n");
        // Every quoted identifier with an underscore is a translation key.
        const keys = new Set([...sources.matchAll(/["']([a-z][a-z0-9]*_[a-z0-9_]+)["']/g)]
            .map(match => match[1]));
        keys.add("answerOf");

        assert.match(group, /<teacher-group-chat/);
        assert.ok(keys.has("response_detail_close"));
        assert.ok(keys.has("response_detail_unread_messages"));
        assert.ok(keys.has("response_detail_chat_load_error"));
        for (const name of ["es_CL", "en_US"]) {
            const catalog = locale(name);
            for (const key of keys) {
                assert.equal(typeof catalog[key], "string", `${name} has ${key}`);
            }
        }
    });
});
