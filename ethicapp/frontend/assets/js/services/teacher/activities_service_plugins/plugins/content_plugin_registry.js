import * as rankingPlugin from "./ranking_content_plugin.js";
import * as semanticDifferentialPlugin from "./semantic_differential_content_plugin.js";

export let contentPluginRegistry = () => {
    return {
        "ranking":               rankingPlugin,
        "semantic_differential": semanticDifferentialPlugin
    };
};