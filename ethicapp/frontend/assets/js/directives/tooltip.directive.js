const tooltipDirective = function() {
    return {
        restrict: 'A',
        scope: {
            tooltip: '@', // Text for the tooltip
        },
        link: function(scope, element) {
            console.log("[tooltipDirective] link");
            
            // Create the tooltip element
            const tooltipElement = angular.element('<span class="tooltip"></span>');
            tooltipElement.text(scope.tooltip);
            document.body.appendChild(tooltipElement[0]); // Append to the body for positioning

            // Show the tooltip on hover or focus
            element.on('mouseenter focus', () => {
                console.log("[tooltipDirective] mouseenter focus");
                const rect = element[0].getBoundingClientRect();
                tooltipElement.css({
                    top: `${rect.top - tooltipElement[0].offsetHeight - 5}px`,
                    left: `${rect.left + rect.width / 2 - tooltipElement[0].offsetWidth / 2}px`,
                    display: 'block',
                });
            });

            // Hide the tooltip on mouseleave or blur
            element.on('mouseleave blur', () => {
                tooltipElement.css('display', 'none');
            });

            // Remove tooltip when scope is destroyed
            scope.$on('$destroy', () => tooltipElement.remove());
        },
    };
};

export default tooltipDirective;
