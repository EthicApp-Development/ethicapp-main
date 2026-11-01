// "Hide names" on the activity dashboard (#897, epic #892): the switch
// starts off and is not remembered; while it is on, the selected phase's
// table, its search, the response detail panel and the Participants tab show
// pseudonyms; the numbers are read when it turns on and when a student joins.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { DashboardController } from "../dashboard.controller.js";
import {
    ConnectedUsersDirectiveController,
} from "../../../directives/connected-users.directive.js";

const readAsset = path => readFileSync(new URL(path, import.meta.url), "utf8");
const locale = name => JSON.parse(readAsset(`../../../../locales/${name}.json`));
const TEACHER_VIEWS = "../../../../static/views/teacher";

const SESSION_ID = 10;
const REAL_NAMES = ["Ana", "Beto", "Carla", "Diego"];

// Lets pending promises and the digests they queue run.
const settle = () => new Promise(resolve => setImmediate(resolve));

function fakeTranslate(name = "es_CL") {
    const catalog = locale(name);
    return {
        instant: (key, params = {}) => String(catalog[key] ?? key)
            .replace(/\{\{\s*(\w+)\s*\}\}/gu, (_, param) => params[param] ?? ""),
        use: () => name,
    };
}

// A window that records which of its properties the dashboard reads.
function recordingWindow() {
    const read = new Set();
    const target = { innerWidth: 1920, innerHeight: 1080 };
    return {
        read,
        $window: new Proxy(target, {
            get(object, property) {
                read.add(String(property));
                return object[property];
            },
        }),
    };
}

function assertNoRealName(value) {
    const text = JSON.stringify(value);
    for (const name of REAL_NAMES) {
        assert.equal(text.includes(name), false, `"${name}" is not shown`);
    }
}

function createDashboard({ pseudonyms = [], failRead = false } = {}) {
    const handlers = {};
    const $scope = {
        navigateTo() {},
        $on(name, handler) {
            (handlers[name] ||= []).push(handler);
        },
        $applyAsync: fn => fn(),
    };
    const reads = [];
    const ActivityStateService = {
        getParticipantPseudonyms: async sessionId => {
            reads.push(sessionId);
            if (failRead) {
                throw new Error("offline");
            }
            return typeof pseudonyms === "function" ? pseudonyms() : pseudonyms;
        },
    };
    const { $window, read } = recordingWindow();
    const vm = {};
    DashboardController.call(vm, $scope, {}, null, fakeTranslate(), () => {}, ActivityStateService,
        { takeLaunchNotice: () => [] }, null, null, null, $window);

    vm.sessionId = SESSION_ID;
    const questions = [{ number: 1, q_text: "¿Avisar?", ans_format: { values: 4 } }];
    vm.designObj = {
        type:   "semantic_differential",
        phases: [{ number: 1, chat: false, questions }, { number: 2, chat: true, questions }],
    };
    vm.activityState = {
        users:      [],
        descriptor: { status: "in_progress", currentPhase: { id: 41, number: 2 } },
    };
    vm.dashboardPhaseData = [
        {
            descriptor: {
                id: 40, number: 1, mode: "individual", questions: [{ id: 80, number: 1 }],
            },
            state: [
                { userId: 1, userName: "Ana", r1: 2 },
                { userId: 2, userName: "Beto", r1: 3 },
                { userId: 3, userName: "Carla", r1: 1 },
            ],
        },
        {
            descriptor: { id: 41, number: 2, mode: "team", questions: [{ id: 90, number: 1 }] },
            state:      [
                { userId: 1, userName: "Ana", groupId: 7, groupNumber: 1, groupLetter: "B", r1: 2 },
                { userId: 2, userName: "Beto", groupId: 7, groupNumber: 1, groupLetter: "A" },
                { groupStatistics: true, groupId: 7, groupNumber: 1, groupName: "Grupo 1" },
                { userId: 3, userName: "Carla", groupId: 8, groupNumber: 2, groupLetter: "A" },
                { groupStatistics: true, groupId: 8, groupNumber: 2, groupName: "Grupo 2" },
                { userId: 4, userName: "Diego", groupId: null, groupNumber: null, r1: 4 },
            ],
        },
    ];
    vm.selectPhaseById(41);
    const emit = (name, data) => (handlers[name] || []).forEach(handler => handler({}, data));
    return {
        vm, reads, read, emit,
        individual: vm.dashboardPhaseData[0],
        group:      vm.dashboardPhaseData[1],
    };
}

const NUMBERS = [
    { userId: 1, number: 37 },
    { userId: 2, number: 4 },
    { userId: 3, number: 12 },
    { userId: 4, number: 81 },
];

async function hideNames(vm) {
    vm.namesHidden = true;
    vm.onNamesHiddenChange();
    await settle();
}

describe("DashboardController hide names", () => {
    it("starts off and shows the phases as they are", () => {
        const { vm, reads, group } = createDashboard({ pseudonyms: NUMBERS });
        assert.equal(vm.namesHidden, false);
        assert.equal(vm.displayPhase(group), group);
        assert.equal(vm.selectedPhase(), group);
        assert.deepEqual(reads, [], "no numbers are read while names show");
    });

    it("is not remembered: it keeps nothing in the browser's storage", async () => {
        const { vm, read } = createDashboard({ pseudonyms: NUMBERS });
        await hideNames(vm);
        vm.namesHidden = false;
        vm.onNamesHiddenChange();
        for (const storage of ["localStorage", "sessionStorage", "indexedDB", "document"]) {
            assert.equal(read.has(storage), false, `no $window.${storage}`);
        }

        const source = readAsset("../dashboard.controller.js");
        assert.doesNotMatch(source, /localStorage|sessionStorage|\$cookies/u);
    });

    it("reads the numbers when it turns on, and names a group phase by letter", async () => {
        const { vm, reads, group } = createDashboard({ pseudonyms: NUMBERS });
        await hideNames(vm);

        assert.deepEqual(reads, [SESSION_ID]);
        const phase = vm.selectedPhase();
        assert.notEqual(phase, group);
        assert.equal(vm.selectedPhase(), phase, "the same object on every digest");
        assert.deepEqual(phase.state.map(row => row.userName ?? row.groupName), [
            "Integrante A", "Integrante B", "Grupo 1", "Integrante A", "Grupo 2", "Participante 81",
        ]);
        assertNoRealName(phase);
        assert.equal(group.state[0].userName, "Ana", "the live table keeps the names");
    });

    it("names a phase without groups by number, ordered by number", async () => {
        const { vm } = createDashboard({ pseudonyms: NUMBERS });
        await hideNames(vm);
        vm.selectPhaseById(40);
        assert.deepEqual(vm.selectedPhase().state.map(row => row.userName),
            ["Participante 04", "Participante 12", "Participante 37"]);
    });

    it("searches the pseudonyms, not the names", async () => {
        const { vm } = createDashboard({ pseudonyms: NUMBERS });
        await hideNames(vm);
        vm.participantQuery = "ana";
        assert.equal(vm.selectedPhaseMatchCount(), 0);
        vm.participantQuery = "integrante a";
        assert.equal(vm.selectedPhaseMatchCount(), 2);
        vm.participantQuery = "81";
        assert.equal(vm.selectedPhaseMatchCount(), 1);
    });

    it("shows the detail with pseudonyms, moving through the rows by pseudonym", async () => {
        const { vm } = createDashboard({ pseudonyms: NUMBERS });
        await hideNames(vm);
        const phase = vm.selectedPhase();
        vm.openResponseDetail(phase.state[0], phase);

        assert.equal(vm.detailRow().userName, "Integrante A");
        assert.equal(vm.detailRow().userId, 2);
        assertNoRealName(vm.detailRow());
        assertNoRealName(vm.detailPhaseData().state);

        vm.navigateResponseDetail(1);
        assert.equal(vm.detail.key, "student:1");
        assert.equal(vm.detailRow().userName, "Integrante B");
    });

    it("keeps the panel on the same student when it turns off, with the name back", async () => {
        const { vm } = createDashboard({ pseudonyms: NUMBERS });
        await hideNames(vm);
        vm.openResponseDetail(vm.selectedPhase().state[0], vm.selectedPhase());

        vm.namesHidden = false;
        vm.onNamesHiddenChange();
        assert.equal(vm.detailRow().userName, "Beto");
    });

    it("reads the numbers again when a student joins while it is on, not off", async () => {
        let numbers = NUMBERS.slice(0, 3);
        const { vm, reads } = createDashboard({ pseudonyms: () => numbers });
        // The tables' refresh after a join is not under test here.
        vm.updateDashboardPhaseData = async () => {};
        vm.studentJoinHandler();
        await settle();
        assert.deepEqual(reads, []);

        await hideNames(vm);
        assert.equal(vm.selectedPhase().state.at(-1).userName, "Participante …");

        numbers = NUMBERS;
        vm.studentJoinHandler();
        await settle();
        assert.deepEqual(reads, [SESSION_ID, SESSION_ID]);
        assert.equal(vm.selectedPhase().state.at(-1).userName, "Participante 81");
        assert.equal(vm.pseudonymNumbers().get(4), 81);
    });

    it("keeps names hidden when the numbers cannot be read", async () => {
        const { vm } = createDashboard({ failRead: true });
        const errors = [];
        const consoleError = console.error;
        console.error = (...args) => errors.push(args);
        try {
            await hideNames(vm);
        } finally {
            console.error = consoleError;
        }
        assert.equal(errors.length, 1);
        vm.selectPhaseById(40);
        assert.deepEqual(vm.selectedPhase().state.map(row => row.userName),
            ["Participante …", "Participante …", "Participante …"]);
    });

    it("turns off on a reload: a new dashboard starts with names showing", async () => {
        const first = createDashboard({ pseudonyms: NUMBERS });
        await hideNames(first.vm);
        const second = createDashboard({ pseudonyms: NUMBERS });
        assert.equal(second.vm.namesHidden, false);
    });
});

describe("Participants tab with hidden names", () => {
    const USERS = [
        { id: 2, name: "Beto", mail: "beto@example.org", role: "A" },
        { id: 9, name: "Prof. Rojas", mail: "rojas@example.org", role: "P" },
        { id: 1, name: "Ana", mail: "ana@example.org", role: "A" },
    ];

    async function createList(scope) {
        const $scope = { sessionId: String(SESSION_ID), $applyAsync() {}, ...scope };
        const ActivityStateService = { getSessionUsers: async () => USERS };
        const ctrl = new ConnectedUsersDirectiveController($scope, ActivityStateService,
            fakeTranslate());
        await settle();
        return { ctrl, $scope };
    }

    it("shows the users as they are while names show", async () => {
        const { ctrl } = await createList({ hideNames: false });
        assert.equal(ctrl.displayUsers(), USERS);
        assert.equal(ctrl.orderField(), "name");
    });

    it("names the students by number, without email, and orders the names by number", async () => {
        const numbers = new Map([[1, 37], [2, 4]]);
        const { ctrl, $scope } = await createList({ hideNames: true, pseudonymNumbers: numbers });

        const users = ctrl.displayUsers();
        assert.equal(ctrl.displayUsers(), users, "the same list on every digest");
        assert.deepEqual(users.map(user => user.name),
            ["Prof. Rojas", "Participante 04", "Participante 37"]);
        assertNoRealName(users.filter(user => user.role === "A"));
        assert.ok(users.filter(user => user.role === "A").every(user => user.mail === null));
        assert.equal(ctrl.orderField(), "hiddenOrder");
        ctrl.sortBy("role");
        assert.equal(ctrl.orderField(), "role");

        $scope.pseudonymNumbers = new Map([[1, 3], [2, 4]]);
        assert.deepEqual(ctrl.displayUsers().map(user => user.name),
            ["Prof. Rojas", "Participante 03", "Participante 04"]);
    });
});

describe("hide names templates", () => {
    const view = readAsset(`${TEACHER_VIEWS}/activity.view.html`);
    const participants = readAsset(`${TEACHER_VIEWS}/connected-users.html`);
    const panel = readAsset(`${TEACHER_VIEWS}/fragments/response-detail-panel.template.html`);

    it("puts the switch in the responses toolbar, off by default and kept nowhere", () => {
        const toolbar = view.slice(view.indexOf("dashboard-responses-tools"),
            view.indexOf("dashboard-search-empty"));
        assert.match(toolbar, /<input type="checkbox" role="switch"/u);
        assert.match(toolbar, /ng-model="dc\.namesHidden"/u);
        assert.match(toolbar, /ng-change="dc\.onNamesHiddenChange\(\)"/u);
        assert.doesNotMatch(toolbar, /ng-checked|checked="/u);
    });

    it("feeds the tables, the panel and the Participants tab through the switch", () => {
        assert.match(view, /phase-data="dc\.displayPhase\(phase\)"/u);
        assert.match(view, /hide-names="dc\.namesHidden"\s+case-videos/u);
        assert.match(view, /pseudonym-numbers="dc\.pseudonymNumbers\(\)"/u);
        assert.match(panel, /\$ctrl\.hideNames && \$ctrl\.studentGroup\(\)/u);
        assert.match(participants, /ctrl\.displayUsers\(\) \| orderBy:ctrl\.orderField\(\)/u);
        assert.match(participants, /<td ng-if="!ctrl\.hidesNames\(\)">\{\{ user\.mail \}\}<\/td>/u);
    });

    it("has every key in both locales", () => {
        const keys = new Set([...[view, participants, panel].join("\n")
            .matchAll(/["']([a-z][a-z0-9]*_[a-z0-9_]+)["']/gu)].map(match => match[1]));
        assert.ok(keys.has("dashboard_hide_names"));
        assert.ok(keys.has("dashboard_participant_search_label_hidden"));
        for (const name of ["es_CL", "en_US"]) {
            const catalog = locale(name);
            for (const key of keys) {
                assert.equal(typeof catalog[key], "string", `${name} has ${key}`);
            }
        }
        assert.equal(locale("es_CL").dashboard_hide_names, "Ocultar nombres");
    });
});
