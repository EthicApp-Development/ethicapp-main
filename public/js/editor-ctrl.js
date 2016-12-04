"use strict";

let app = angular.module("Editor", []);

app.controller("EditorController", function($scope, $http){
    let self = $scope;

    self.pdfBinary = null;
    self.seltxt = "";

    self.init = () => {
        /*$http({url: "get-pdf", method: "post"}).success((data) => {
            self.pdfBinary = data;
        });*/
        //let pdfData = base64ToUint8Array(pdfBase64);
        let url = "uploads/f68e346c-ce18-4b19-a92b-13ab57b354ef/pdf/t3.pdf";
        loadPdf(url);
    };

    self.selectText = () => {
        self.seltxt = window.getSelection().toString();
    };

    self.init();

});

// Static functions
/*
let base64ToUint8Array = (base64) => {
    let raw = atob(base64); //This is a native function that decodes a base64-encoded string.
    let uint8Array = new Uint8Array(new ArrayBuffer(raw.length));
    for (let i = 0; i < raw.length; i++) {
        uint8Array[i] = raw.charCodeAt(i);
    }
    return uint8Array;
};
*/

let loadPdf = (pdfData) => {
    PDFJS.disableWorker = true;
    let pdf = PDFJS.getDocument(pdfData);
    pdf.then(renderPdf);
};

let renderPdf = (pdf) => {
    for(let i = 1; i <= pdf.numPages; i++)
        pdf.getPage(i).then(renderPage);
};

let renderPage = (page) => {
    let scale = 1.3;
    let viewport = page.getViewport(scale);
    let $canvas = $("<canvas></canvas>");

    let canvas = $canvas.get(0);
    let context = canvas.getContext("2d");
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    let $pdfContainer = $("#pdf-canvas");
    $pdfContainer.css("height", canvas.height + "px").css("width", canvas.width + "px");
    $pdfContainer.append($canvas);

    let canvasOffset = $canvas.offset();
    let $textLayerDiv = jQuery("<div />")
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