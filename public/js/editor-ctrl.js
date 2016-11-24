"use strict";

let app = angular.module("Editor", []);

app.controller("EditorController", function($scope, $http){
    let self = $scope;

    self.pdfBinary = null;
    self.scale = 1.5;

    self.init = () => {
        $http({url: "get-pdf", method: "post"}).success((data) => {
            self.pdfBinary = data;
        });
        let pdfData = base64ToUint8Array(pdfBase64);
        loadPdf(pdfData);
    };

});

// Static functions
let base64ToUint8Array = (base64) => {
    var raw = atob(base64); //This is a native function that decodes a base64-encoded string.
    var uint8Array = new Uint8Array(new ArrayBuffer(raw.length));
    for (var i = 0; i < raw.length; i++) {
        uint8Array[i] = raw.charCodeAt(i);
    }
    return uint8Array;
};

let loadPdf = (pdfData) => {
    PDFJS.disableWorker = true;
    var pdf = PDFJS.getDocument(pdfData);
    pdf.then(renderPdf);
};

let renderPdf = (pdf) => {
    pdf.getPage(1).then(renderPage);
};

let renderPage = (page) => {
    var viewport = page.getViewport(scale);
    var $canvas = $("#pdf-canvas");

    var canvas = $canvas.get(0);
    var context = canvas.getContext("2d");
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    var $pdfContainer = $("#pdfContainer");
    $pdfContainer.css("height", canvas.height + "px").css("width", canvas.width + "px");
    $pdfContainer.append($canvas);

    var canvasOffset = $canvas.offset();
    var $textLayerDiv = jQuery("<div />")
        .addClass("textLayer")
        .css("height", viewport.height + "px")
        .css("width", viewport.width + "px")
        .offset({
            top: canvasOffset.top,
            left: canvasOffset.left
        });

    $pdfContainer.append($textLayerDiv);

    page.getTextContent().then((textContent) => {
        let textLayer = new TextLayerBuilder($textLayerDiv.get(0), 0);
        textLayer.setTextContent(textContent);
        let renderContext = {
            canvasContext: context,
            viewport: viewport,
            textLayer: textLayer
        };
        page.render(renderContext);
    });
};