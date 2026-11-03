// A case a launched activity uses keeps its share switch: the lock covers
// only its content and its deletion (#1014).
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import caseCardComponent from "../case-card.component.js";

function createCard(caseItem) {
    const ctrl = new caseCardComponent.controller();
    ctrl.caseItem = caseItem;
    ctrl.onTogglePublic = () => {};
    ctrl.onEdit = () => {};
    ctrl.onDelete = () => {};
    return ctrl;
}

describe("case-card and a case in use", () => {
    it("offers the share switch for a case in use", () => {
        const card = createCard({ id: 41, hasLaunchedDesignActivity: true });

        assert.equal(card.canToggleVisibility(), true);
    });

    it("still hides the edit and delete buttons of a case in use", () => {
        const card = createCard({ id: 41, hasLaunchedDesignActivity: true });

        assert.equal(card.canEdit(), false);
        assert.equal(card.canDelete(), false);
    });

    it("hides the share switch of an archived case", () => {
        const card = createCard({ id: 41, archived: true });

        assert.equal(card.canToggleVisibility(), false);
    });

    it("hides the share switch without a toggle handler", () => {
        const card = createCard({ id: 41 });
        card.onTogglePublic = undefined;

        assert.equal(card.canToggleVisibility(), false);
    });
});
