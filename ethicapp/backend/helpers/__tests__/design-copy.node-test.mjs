import assert from "node:assert/strict";
import test from "node:test";
import { buildDesignCopyDocument } from "../design-copy.js";

function sourceDesign() {
    return {
        id:         42,
        type:       "semantic_differential",
        public:     true,
        visibility: "public",
        locked:     true,
        metainfo:   { title: "Caso Sebastián", author: "Teacher" },
        phases:     [{
            mode:             "individual",
            externalServices: {
                enabledServiceIds: ["polyadic-devils-advocate"],
                configurations:    {
                    "polyadic-devils-advocate": {
                        pipeline_type: "devilsAdvocate",
                        llm_tier:      "basic",
                    },
                    "argumentation-tutor-system": { llm_tier: "advanced" },
                },
            },
        }],
    };
}

test("buildDesignCopyDocument keeps phase external service configurations (#729)", () => {
    const copy = buildDesignCopyDocument(sourceDesign(), {
        title:      "Caso Sebastián (copia)",
        visibility: "private",
    });

    assert.deepEqual(copy.phases, sourceDesign().phases);
});

test("buildDesignCopyDocument resets identity, sharing and title only", () => {
    const copy = buildDesignCopyDocument(sourceDesign(), {
        title:      "Caso Sebastián (copia)",
        visibility: "private",
    });

    assert.equal(Object.hasOwn(copy, "id"), false);
    assert.equal(copy.public, false);
    assert.equal(copy.visibility, "private");
    assert.equal(copy.locked, false);
    assert.deepEqual(copy.metainfo, { title: "Caso Sebastián (copia)", author: "Teacher" });
    assert.equal(copy.type, "semantic_differential");
});

test("buildDesignCopyDocument does not share or modify the source document", () => {
    const source = sourceDesign();
    const copy = buildDesignCopyDocument(source, { title: "Copy", visibility: "private" });

    const { configurations } = copy.phases[0].externalServices;
    configurations["polyadic-devils-advocate"].llm_tier = "advanced";

    assert.deepEqual(source, sourceDesign());
});

test("buildDesignCopyDocument tolerates designs without metainfo", () => {
    const source = sourceDesign();
    delete source.metainfo;

    const copy = buildDesignCopyDocument(source, { title: "Copy", visibility: "private" });

    assert.deepEqual(copy.metainfo, { title: "Copy" });
});

// Comparing modes in a study (#870): the copy keeps the phase's tutor mode,
// and changing it in the copy leaves the source as it was.
test("buildDesignCopyDocument keeps the tutor's evaluation mode, independently of the source", () => {
    const source = sourceDesign();
    source.phases[0].externalServices.enabledServiceIds.push("argumentation-tutor-system");
    source.phases[0].externalServices.configurations["argumentation-tutor-system"] = {
        llm_tier:        "advanced",
        evaluation_mode: "basic",
    };

    const copy = buildDesignCopyDocument(source, { title: "Copy", visibility: "private" });
    const tutorConfiguration = () => copy.phases[0].externalServices
        .configurations["argumentation-tutor-system"];

    assert.equal(tutorConfiguration().evaluation_mode, "basic");
    tutorConfiguration().evaluation_mode = "enhanced";
    assert.equal(source.phases[0].externalServices
        .configurations["argumentation-tutor-system"].evaluation_mode, "basic");
});
