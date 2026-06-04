let holdToConfirmDirective = function($timeout) {
    return {
        restrict: "A",
        scope: {
            onConfirm: "&",
            holdMs: "@"
        },
        link: function(scope, element) {
            const button = element[0];
            const progress = button.querySelector(".hold-progress");
            const holdMs = Number.parseInt(scope.holdMs || "2500", 10);
            const durationMs = Number.isFinite(holdMs) && holdMs > 0 ? holdMs : 2500;

            let timer = null;

            function resetProgress() {
                element.removeClass("holding");
                if (progress) {
                    progress.style.transitionDuration = "";
                }
            }

            function cancel(event) {
                if (event) {
                    event.preventDefault();
                }
                if (timer) {
                    $timeout.cancel(timer);
                    timer = null;
                }
                resetProgress();
            }

            function start(event) {
                if (button.disabled) {
                    return;
                }
                if (event) {
                    event.preventDefault();
                }
                if (timer) {
                    $timeout.cancel(timer);
                }

                if (progress) {
                    progress.style.transitionDuration = `${durationMs}ms`;
                }
                element.addClass("holding");

                timer = $timeout(function() {
                    timer = null;
                    resetProgress();
                    scope.onConfirm();
                }, durationMs);
            }

            function preventClick(event) {
                event.preventDefault();
                event.stopPropagation();
                if (event.stopImmediatePropagation) {
                    event.stopImmediatePropagation();
                }
            }

            function handleKeydown(event) {
                if ((event.key === " " || event.key === "Enter") && !timer) {
                    start(event);
                }
            }

            function handleKeyup(event) {
                if (event.key === " " || event.key === "Enter") {
                    cancel(event);
                }
            }

            element.on("mousedown touchstart", start);
            element.on("mouseup mouseleave touchend touchcancel", cancel);
            element.on("keydown", handleKeydown);
            element.on("keyup blur", handleKeyup);
            element.on("click", preventClick);

            scope.$on("$destroy", function() {
                cancel();
                element.off("mousedown touchstart", start);
                element.off("mouseup mouseleave touchend touchcancel", cancel);
                element.off("keydown", handleKeydown);
                element.off("keyup blur", handleKeyup);
                element.off("click", preventClick);
            });
        }
    };
};

export default holdToConfirmDirective;
