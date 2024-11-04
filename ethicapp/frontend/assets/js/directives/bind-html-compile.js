
function BindHTMLCompile($compile) {
    return {
        restrict: "A",
        link:     function link(scope, element, attrs) {
            scope.$watch(function () {
                return scope.$eval(attrs.bindHtmlCompile);
            }, function (value) {
                element.html(value && value.toString());
                let compileScope = scope;
                if (attrs.bindHtmlScope) {
                    compileScope = scope.$eval(attrs.bindHtmlScope);
                }
                $compile(element.contents())(compileScope);
            });
        }
    };
};

export { BindHTMLCompile };