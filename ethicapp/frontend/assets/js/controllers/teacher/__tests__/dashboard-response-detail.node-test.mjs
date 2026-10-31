// The dashboard's response detail panel (#896, epic #892): a row opens it,
// another row replaces it, ‹ › follow the table's order, and it closes when
// the teacher starts the next phase, selects another phase or leaves the
// responses. Ranking designs have no detail.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DashboardController } from "../dashboard.controller.js";

function createDashboard({ designType = "semantic_differential" } = {}) {
    const handlers = {};
    const $scope = {
        navigateTo() {},
        $on(name, handler) {
            (handlers[name] ||= []).push(handler);
        },
        $applyAsync: fn => fn(),
    };
    const vm = {};
    DashboardController.call(vm, $scope, {}, null, null, () => {}, {},
        { takeLaunchNotice: () => [] }, null, null, null, { innerWidth: 1920 });

    const questions = [{ number: 1, q_text: "¿Avisar?", ans_format: { values: 4 } }];
    vm.designObj = {
        type:   designType,
        phases: [{ number: 1, chat: false, questions }, { number: 2, chat: true, questions }],
    };
    vm.activityState = {
        descriptor: { status: "in_progress", currentPhase: { id: 41, number: 2 } },
    };
    vm.dashboardPhaseData = [
        {
            descriptor: {
                id: 40, number: 1, mode: "individual", questions: [{ id: 80, number: 1 }],
            },
            state: [{ userId: 1, userName: "Ana", r1: 2 }, { userId: 2, userName: "Beto", r1: 3 }],
        },
        {
            descriptor: { id: 41, number: 2, mode: "team", questions: [{ id: 90, number: 1 }] },
            state:      [
                { userId: 1, userName: "Ana", groupId: 7, groupNumber: 1, r1: 2 },
                { userId: 2, userName: "Beto", groupId: 7, groupNumber: 1, r1: null },
                { groupStatistics: true, groupId: 7, groupNumber: 1, groupName: "Grupo 1" },
                { userId: 3, userName: "Carla", groupId: 8, groupNumber: 2, r1: 1 },
                { groupStatistics: true, groupId: 8, groupNumber: 2, groupName: "Grupo 2" },
            ],
        },
    ];
    vm.selectPhaseById(41);
    const emit = (name, data) => (handlers[name] || []).forEach(handler => handler({}, data));
    return { vm, emit, group: vm.dashboardPhaseData[1], individual: vm.dashboardPhaseData[0] };
}

describe("DashboardController response detail", () => {
    it("opens a group's detail on its live row, its questions merged with the design's", () => {
        const { vm, group } = createDashboard();
        vm.openResponseDetail(group.state[2], group);

        assert.equal(vm.isResponseDetailOpen(), true);
        assert.equal(vm.detail.kind, "group");
        assert.equal(vm.detailRow(), group.state[2]);
        assert.equal(vm.detailPhaseData().descriptor.questions[0].range, 4);
        assert.equal(vm.detailPhaseData(), vm.detailPhaseData(), "the same object on every digest");

        group.state[2] = { ...group.state[2], totalChatCount: 5 };
        assert.equal(vm.detailRow(), group.state[2], "the table's new row");
    });

    it("replaces the content when another row is clicked", () => {
        const { vm, group } = createDashboard();
        vm.openResponseDetail(group.state[2], group);
        vm.openResponseDetail(group.state[3], group);
        assert.equal(vm.detail.key, "student:3");
        assert.equal(vm.detailRow().userName, "Carla");
    });

    it("moves through the rows in the table's order, within the search", () => {
        const { vm, group } = createDashboard();
        vm.openResponseDetail(group.state[1], group);

        assert.equal(vm.detailHasAdjacent(-1), true);
        vm.navigateResponseDetail(1);
        assert.equal(vm.detail.key, "group:7");
        vm.navigateResponseDetail(1);
        assert.equal(vm.detail.key, "student:3");
        vm.navigateResponseDetail(1);
        vm.navigateResponseDetail(1);
        assert.equal(vm.detail.key, "group:8");
        assert.equal(vm.detailHasAdjacent(1), false);

        vm.participantQuery = "ana";
        vm.openResponseDetail(group.state[0], group);
        assert.equal(vm.detailHasAdjacent(-1), false);
        vm.navigateResponseDetail(1);
        assert.equal(vm.detail.key, "group:7");
    });

    it("lets the teacher write only in the current phase's chat", () => {
        const { vm, group, individual } = createDashboard();
        vm.openResponseDetail(group.state[2], group);
        assert.equal(vm.detailCanUseLiveChat(), true);

        vm.activityState.descriptor.status = "finished";
        assert.equal(vm.detailCanUseLiveChat(), false);

        vm.activityState.descriptor.status = "in_progress";
        vm.selectPhaseById(40);
        vm.openResponseDetail(individual.state[0], individual);
        assert.equal(vm.detailCanUseLiveChat(), false);
    });

    it("goes from a student to the student's group, on its chat", () => {
        const { vm, group } = createDashboard();
        vm.openResponseDetail(group.state[0], group);
        vm.openGroupResponseDetail(group.state[2]);
        assert.equal(vm.detail.key, "group:7");
        assert.equal(vm.detail.initialTab, "chat");
    });

    it("closes when another phase is selected, and stays open on the same one", () => {
        const { vm, group } = createDashboard();
        vm.openResponseDetail(group.state[2], group);
        vm.selectPhaseById(41);
        assert.equal(vm.isResponseDetailOpen(), true);

        vm.selectPhaseById(40);
        assert.equal(vm.detail, null);
        assert.equal(vm.isResponseDetailOpen(), false);
    });

    it("closes when the next phase starts", () => {
        const { vm, group, emit } = createDashboard();
        vm.openResponseDetail(group.state[2], group);
        emit("activity:phase-advanced", { phaseId: 41 });
        assert.equal(vm.detail, null);
    });

    it("closes when the teacher leaves the responses", () => {
        const { vm, group } = createDashboard();
        vm.openResponseDetail(group.state[2], group);
        vm.selectMainTab("responses");
        assert.notEqual(vm.detail, null);
        vm.selectMainTab("case");
        assert.equal(vm.detail, null);

        vm.openResponseDetail(group.state[2], group);
        vm.closeResponseDetail();
        assert.equal(vm.isResponseDetailOpen(), false);
    });

    it("opens nothing for a ranking design", () => {
        const { vm, group } = createDashboard({ designType: "ranking" });
        vm.openResponseDetail(group.state[0], group);
        assert.equal(vm.detail, null);
        assert.equal(vm.isResponseDetailOpen(), false);
    });
});
