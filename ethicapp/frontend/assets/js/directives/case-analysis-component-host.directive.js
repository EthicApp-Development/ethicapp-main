// Compiles the component registered for an analysis tab (#651). The manifest
// names the component (`ui.component`), but only names in the allowlist of
// helpers/case-analyses.js are compiled, so the manifest cannot inject
// arbitrary markup. The component receives:
//   analysis           the analysis with its document (GET /cases/:id/analyses/:serviceId)
//   case-item          the case being viewed
//   on-analysis-updated  call with { analysis } after storing an edit
// The host renders nothing for unknown names; the panel shows its generic
// view instead.

import { resolveCaseAnalysisComponent } from "../helpers/case-analyses.js";

export function caseAnalysisComponentHostDirective($compile) {
    return {
        restrict: "E",
        scope:    {
            component:         "<",
            analysis:          "<",
            caseItem:          "<",
            onAnalysisUpdated: "&",
        },
        link(scope, element) {
            let childScope = null;

            function clear() {
                if (childScope) {
                    childScope.$destroy();
                    childScope = null;
                }
                element.empty();
            }

            scope.notifyUpdated = function(analysis) {
                scope.onAnalysisUpdated({ analysis });
            };

            scope.$watch("component", (componentName) => {
                clear();

                const elementName = resolveCaseAnalysisComponent(componentName);
                if (!elementName) {
                    return;
                }

                const node = element[0].ownerDocument.createElement(elementName);
                node.setAttribute("analysis", "analysis");
                node.setAttribute("case-item", "caseItem");
                node.setAttribute("on-analysis-updated", "notifyUpdated(analysis)");
                element.append(node);

                childScope = scope.$new();
                $compile(node)(childScope);
            });

            scope.$on("$destroy", clear);
        },
    };
}
