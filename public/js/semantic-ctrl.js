"use strict";

let app = angular.module("Semantic", ['ui.tree', 'btford.socket-io', "timer", "ui-notification"]);

app.factory("$socket", ["socketFactory", function (socketFactory) {
    return socketFactory();
}]);

app.controller("SemanticController", ["$scope", "$http", "$timeout", "$socket", "Notification", function ($scope, $http, $timeout, $socket, Notification) {
    let self = $scope;

    self.iteration = 1;
    self.sesStatusses = ["Individual", "Grupal", "Reporte", "Evaluación de Pares", "Finalizada"];

    self.originalText = `No deberíamos pronunciar la marca, pero la marca es Benetton. Su campaña publicitaria a costa de una agonía bate el récord de atentados contra la conciencia universal y lleva a sus extremos más peligrosos la tendencia a reconciliarnos con la atrocidad, integrándola en nuestra vida cotidiana. Conviene estar atentos: si la recibimos, ya nunca podremos librarnos de ella. Y aquí no se trata de tabúes. Se trata de preservar desesperadamente los últimos restos de una ética que, por otro tiempo, justificó a nuestra civilización. Se trata, pura y simplemente, de negarnos a regresar a las cavernas.

En este caso, el objeto de la publicidad es un enfermo terminal de sida, como todo el mundo empieza a saber y algunos a criticar. Los voceros de la marca se defienden intentando convertir su miserable estrategia comercial en una campaña de alta filantropía. Según ellos, la visión de una imagen atroz nos hará meditar y, a la postre, reaccionar a su favor. Aseguran que ésta fue la última voluntad de la víctima y también la de sus familiares. La opción demuestra que las víctimas pueden equivocarse.

Es posible que no calculen en qué medida pueden ser manipuladas sus intenciones; hasta qué extremos puede ser trivializada su tragedia. Aun concediendo a la empresa Benetton el beneficio de la honestidad, el peligro de trivialización al difundir las imágenes del enfermo de sida debería tenerse en cuenta. El contexto va en contra de los propósitos. La atrocidad que, en el mejor de los casos, se pretende denunciar quedará ahogada por la abigarrada parafernalia que ha ido configurando nuestro mundo de sueños bastardos. La habitualidad del horror acabará por restarle importancia.

La víctima se convertirá en un compañero cotidiano, como doña Adelaida. Y, en el papel cuché de las revistas y dominicales, el sida podrá aparecer incluso elegante. Si se convierte en spot televisivo, la agonía lucirá divinamente entre fragmentos de una película de Martínez Soria, anuncios de refrescos tropicales y colonias para machos incontaminados. Después de todo, la foto no carece de estilo, y las expresiones de los familiares están muy conseguidas.

Es cierto que el medio es el mensaje, y, en esta ocasión, el medio es una empresa experta en colorines que decide promocionar el dolor para atraer nuestras miradas por una elemental maniobra de contraste. Así lo han declarado los persuasores en una conferencia de prensa: las masas ya no se impresionan con los anuncios de colores idílicos, abusados hasta la saciedad en la estupidez cotidiana. Para interesar es necesario recurrir al impacto. Mala cosa cuando, a su vez, el impacto recurre al dolor como pregonero y a la muerte como estrella invitada.`;

    self.sentences = self.originalText.match( /[^.!?\n]+[.!?\n]+/g );

    self.highlight = Array.from(self.sentences.length, () => false);

    self.countHightlight = () => {
        return self.highlight.reduce((val, elem) => (elem)? val + 1 : val, 0);
    };

}]);
