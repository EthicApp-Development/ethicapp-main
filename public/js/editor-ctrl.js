"use strict";

let app = angular.module("Editor", ['dndLists']);

app.controller("EditorController", function ($scope, $http, $timeout) {
    let self = $scope;

    self.documents = [];
    self.selections = [];
    self.selectedDocument = -1;

    rangy.init();
    self.applier = rangy.createClassApplier("highlight");

    self.init = () => {
        $http({url: "get-documents", method: "post"}).success((data) => {
            self.documents = data;
            self.renderAll();
            $timeout(self.getIdeas, 2000); // To be changed by promises
        });
    };

    self.selectText = () => {
        let selection = window.getSelection();
        let serial = rangy.serializeSelection(window, true, $("#pdf-canvas-" + self.selectedDocument)[0]);
        let textDef = {
            text: selection.toString(),
            length: selection.toString().length,
            serial: serial,
            document: self.selectedDocument,
            comment: "",
            expanded: true,
            status: "unsaved"
        };
        if (textDef.length < 2 || textDef.length > 50) return;
        self.highlightSerial(textDef.serial, textDef.document);
        self.selections.push(textDef);
    };

    self.highlightSerial = (serial, index) => {
        self.applier.applyToRange(rangy.deserializeRange(serial, $("#pdf-canvas-" + index)[0], document));
    };

    self.renderAll = () => {
        self.documents.forEach((doc, idx) => {
            loadPdf(doc.path, idx);
        });
    };

    self.selectPDF = (idx) => {
        self.selectedDocument = idx;
    };

    self.getIdeas = () => {
        $http({url: "get-ideas", method: "post"}).success((data) => {
            self.selections = [];
            data.forEach((idea) => {
                let textDef = {
                    id: idea.id,
                    text: idea.content,
                    serial: idea.serial,
                    document: arrayIndexOfId(self.documents, idea.docid),
                    comment: idea.descr,
                    expanded: false,
                    status: "saved"
                };
                self.highlightSerial(textDef.serial, textDef.document);
                self.selections.push(textDef);
            });
        });
    };

    self.sendIdea = (sel) => {
        let postadata = {
            text: sel.text,
            comment: sel.comment,
            serial: sel.serial,
            docid: self.documents[sel.document].id
        };
        if (sel.status == "unsaved") {
            $http({url: "send-idea", method: "post", data: postadata}).success((data) => {
                if (data.status == "ok") {
                    sel.expanded = false;
                    sel.status = "saved"
                }
            });
        }
        else if(sel.status == "dirty" && sel.id != null) {
            postadata.id = sel.id;
            $http({url: "update-idea", method: "post", data: postadata}).success((data) => {
                if (data.status == "ok") {
                    sel.expanded = false;
                    sel.status = "saved"
                }
            });
        }
    };

    self.selTextChange = (sel) => {
        sel.status = (sel.status == 'saved') ? 'dirty' : sel.status;
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

let arrayIndexOfId = (arr, id) => {
    return arr.reduce((prev, cur, i) => (cur.id == id) ? i : prev, -1);
};

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