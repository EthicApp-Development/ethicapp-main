"use strict";

let app = angular.module("Editor", []);

app.controller("EditorController", function ($scope, $http) {
    let self = $scope;

    self.documents = [];
    self.selectedDocument = -1;
    self.seltxt = "";
    self.last_serial = "";
    rangy.init();
    self.applier = rangy.createClassApplier("highlight");

    self.init = () => {
        $http({url: "get-documents", method: "post"}).success((data) => {
            self.documents = data;
            self.renderAll();
        });
    };

    self.selectText = () => {
        let selection = window.getSelection();
        let serial = rangy.serializeSelection(window, true, $("#pdf-canvas-" + self.selectedDocument)[0]);
        self.seltxt = selection.toString() + " - " + serial;
        self.last_serial = serial;
    };

    self.highlightSerial = () => {
        self.applier.applyToRange(rangy.deserializeRange(self.last_serial, $("#pdf-canvas-" + self.selectedDocument)[0], document));
    };

    self.renderAll = () => {
        self.documents.forEach((doc, idx) => {
            loadPdf(doc.path, idx);
        });
    };

    self.selectPDF = (idx) => {
        self.selectedDocument = idx;
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

let loadPdf = (pdfData, i) => {
    PDFJS.disableWorker = true;
    let pdf = PDFJS.getDocument(pdfData);
    pdf.then((pdf) => renderPdf(pdf, i));
};

let renderPdf = (pdf, idx) => {
    for (let i = 1; i <= pdf.numPages; i++)
        pdf.getPage(i).then((p) => renderPage(p, idx));
};

let renderPage = (page, i) => {
    let scale = 1.3;
    let viewport = page.getViewport(scale);
    let $canvas = $("<canvas></canvas>");

    let canvas = $canvas.get(0);
    let context = canvas.getContext("2d");
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    let $pdfContainer = $("#pdf-canvas-" + i);
    $pdfContainer.css("height", canvas.height + "px").css("width", canvas.width + "px");
    $pdfContainer.append($canvas);

    let canvasOffset = $canvas.offset();
    let $textLayerDiv = jQuery("<div></div>")
        .addClass("textLayer")
        .css("height", viewport.height + "px")
        .css("width", viewport.width + "px");
    /*.offset({
     top: canvasOffset.top,
     left: canvasOffset.left
     });*/

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