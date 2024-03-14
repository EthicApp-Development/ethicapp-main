import * as rankingPlugin from "./ranking_design_editor_plugin.js";
import * as semanticDifferentialPlugin from "./semantic_differential_design_editor_plugin.js";

export let designEditorPluginRegistry = () => {
    return {
        "ranking":               rankingPlugin,
        "semantic_differential": semanticDifferentialPlugin
    };
};