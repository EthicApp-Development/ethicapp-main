// The design card (#979, epic #966): only the design view and the activity
// dashboard use it, so it declares the bindings they pass and nothing else.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import designItemComponent from "../design-item.component.js";

const VIEWS_URL = new URL("../../../static/views/teacher/", import.meta.url);

function readView(path) {
    return readFileSync(new URL(path, VIEWS_URL), "utf8");
}

function kebabToCamel(name) {
    return name.replace(/-([a-z])/gu, (_match, letter) => letter.toUpperCase());
}

// The attributes of every `<design-item>` element in a template.
function designItemAttributes(html) {
    return [...html.matchAll(/<design-item\b([^>]*)>/gu)]
        .flatMap(([, attributes]) => [...attributes.matchAll(/([a-z-]+)="/gu)])
        .map(([, name]) => kebabToCamel(name));
}

describe("design-item", () => {
    const users = ["design.view.html", "activity.view.html"];

    it("declares every binding its templates pass", () => {
        const bindings = Object.keys(designItemComponent.bindings);
        for (const view of users) {
            const attributes = designItemAttributes(readView(view));
            assert.ok(attributes.length > 0, `${view} uses design-item`);
            for (const attribute of attributes) {
                assert.ok(bindings.includes(attribute), `${view} passes ${attribute}`);
            }
        }
    });

    it("keeps no binding that no template passes", () => {
        const passed = new Set(users.flatMap(view => designItemAttributes(readView(view))));
        const unused = Object.keys(designItemComponent.bindings).filter(name => !passed.has(name));
        assert.deepEqual(unused, []);
    });

    it("offers launch, edit and sharing, and none of the old pages' actions", () => {
        const template = readView("fragments/design-item.template.html");
        assert.match(template, /\$ctrl\.onLaunch\(/u);
        assert.match(template, /\$ctrl\.onEdit\(/u);
        assert.match(template, /\$ctrl\.onTogglePublic\(/u);
        assert.doesNotMatch(template,
            /onSelect|onDelete|onDuplicate|onArchive|onImport|onView|selectedDesignId/u);
    });
});
