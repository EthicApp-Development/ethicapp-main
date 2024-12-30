const copyToClipboardDirective = function($translate) {
    return {
        restrict: 'A',
        scope: {},
        link: function(scope, element) {
            const copyIcon = angular.element('<i class="fa fa-copy" style="margin-left: 8px; cursor: pointer; position: relative;"></i>');
            const tooltipElement = angular.element('<span class="custom-tooltip"></span>');
            element.append(copyIcon);
            element.append(tooltipElement);
        
            let tooltipText = '';
            let copiedText = '';
            let errorText = '';
        
            // Resolve translations on init
            $translate('copy_tooltip_click_to_copy').then(translatedText => {
                tooltipText = translatedText;
                tooltipElement.text(tooltipText);
            });
            $translate('copy_tooltip_copied').then(translatedText => {
                copiedText = translatedText;
            });
            $translate('copy_tooltip_error').then(translatedText => {
                errorText = translatedText;
            });
        
            // Mostrar el tooltip correctamente posicionado
            copyIcon.on('mouseenter', () => {
                const parentRect = element[0].getBoundingClientRect();
                tooltipElement.css({
                    display: 'block',
                    top: "2em",
                    left: "6em",
                });
            });
        
            // Ocultar el tooltip
            copyIcon.on('mouseleave', () => {
                tooltipElement.css('display', 'none');
            });
        
            // Cambiar el contenido del tooltip dinámicamente
            copyIcon.on('click', async function () {
                try {
                    // Extract only the text from the first child node
                    const textToCopy = Array.from(element[0].childNodes)
                        .filter(node => node.nodeType === Node.TEXT_NODE) // Only text nodes
                        .map(node => node.nodeValue.trim()) // Trim whitespace
                        .join(''); // Join all text nodes together
                    await navigator.clipboard.writeText(textToCopy);
        
                    tooltipElement.text(copiedText);
        
                    // Restaurar el texto original después de 2 segundos
                    setTimeout(() => {
                        tooltipElement.text(tooltipText);
                    }, 2000);
                } catch (err) {
                    console.error('Failed to copy text:', err);
                    tooltipElement.text(errorText);
                }
            });
        }        
    };
};

export default copyToClipboardDirective;