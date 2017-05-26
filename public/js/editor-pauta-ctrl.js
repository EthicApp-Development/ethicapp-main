"use strict";

let app = angular.module("Editor", ['ui.tree', "timer"]);

app.controller("EditorController", ["$scope", "$http", "$timeout", function ($scope, $http, $timeout) {
    let self = $scope;

    self.documents = [];
    self.selections = [];
    self.selectedDocument = 0;
    self.numPages = 0;
    self.docIdx = {};
    self.editable = false;
    self.orden = 1;
    self.sesStatusses = ["Lectura", "Individual", "Anónimo", "Grupal", "Reporte", "Rubrica Calibración", "Evaluación de Pares", "Finalizada"];

    rangy.init();
    self.applier = rangy.createClassApplier("highlight");
    self.secondaryApplier = rangy.createClassApplier("highlight-secondary");

    self.init = () => {
        self.getSesInfo();
    };

    self.getSesInfo = () => {
        $http({url: "get-ses-info", method: "post"}).success((data) => {
            self.iteration = data.iteration;
            self.sesSTime = (data.stime != null) ? new Date(data.stime) : null;
            console.log(self.sesSTime);
            $http({url: "get-documents", method: "post"}).success((data) => {
                self.documents = data;
                data.forEach((doc, i) => {
                    self.docIdx[doc.id] = i;
                });
                self.renderAll();
            });
            $http({url: "pauta-editable", method: "post"}).success((data) => {
                self.editable = data.editable;
            });
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
            order: self.orden,
            status: "unsaved"
        };
        if (textDef.length < 2 || textDef.length > 50) return;
        //self.highlightSerial(textDef.serial, textDef.document);
        self.selections.push(textDef);
    };

    self.goToSerial = (text, index, hcls) => {
        hcls = (hcls == null)? ".highlight" : hcls;
        self.selectedDocument = index;
        let highs = angular.element(hcls);
        highs = highs.filter((i,e) => e.innerHTML == text);
        console.log(highs);
        if (highs.length > 0){
            $timeout(() => highs[0].scrollIntoView(),100);
        }
    };

    self.highlightSerial = (serial, index, applier) => {
        console.log(serial,index);
        applier = (applier == null) ? self.applier : applier;
        try{
            applier.applyToRange(rangy.deserializeRange(serial, $("#pdf-canvas-" + index)[0], document));
        }
        catch (err){
            console.log(serial + " no se pudo highlightear!", err);
        }
    };

    self.renderAll = () => {
        self.numPages = 0;
        self.documents.forEach((doc, idx) => {
            loadPdf(doc.path, idx);
        });
    };

    self.selectPDF = (idx) => {
        self.selectedDocument = idx;
    };

    self.getIdeas = () => {
        let postdata = {iteration: 1};
        let url = "get-ideas";
        $http({url: url, method: "post", data: postdata}).success((data) => {
            self.selections = [];
            data.forEach((idea) => {
                let textDef = {
                    id: idea.id,
                    text: idea.content,
                    serial: idea.serial,
                    document: arrayIndexOfId(self.documents, idea.docid),
                    comment: idea.descr,
                    expanded: false,
                    order: idea.orden + 1,
                    status: "saved"
                };
                //self.highlightSerial(textDef.serial, textDef.document);
                self.selections.push(textDef);
            });
        });
    };

    self.sendIdea = (sel) => {
        let postadata = {
            text: sel.text,
            comment: sel.comment,
            serial: sel.serial,
            docid: self.documents[sel.document].id,
            iteration: 1,
            order: sel.order - 1
        };
        self.order = sel.order;
        if (sel.status == "unsaved") {
            $http({url: "send-pauta-idea", method: "post", data: postadata}).success((data) => {
                if (data.status == "ok") {
                    sel.expanded = false;
                    sel.status = "saved";
                    sel.id = data.id;
                }
            });
        }
        else if (sel.status == "dirty" && sel.id != null) {
            postadata.id = sel.id;
            $http({url: "update-pauta-idea", method: "post", data: postadata}).success((data) => {
                if (data.status == "ok") {
                    sel.expanded = false;
                    sel.status = "saved";
                }
            });
        }
    };

    self.deleteIdea = (sel, index) => {
        if (sel.id != null) {
            let postadata = {id: sel.id};
            $http({url: "delete-idea", method: "post", data: postadata}).success((data) => {
                if(data.status == "ok") {
                    self.selections.splice(index, 1);

                }
            });
        }
        else{
            self.selections.splice(index, 1);
        }
    };

    self.selTextChange = (sel) => {
        sel.status = (sel.status == 'saved') ? 'dirty' : sel.status;
    };

    self.checkAllSync = () => {
        return self.selections.filter(e => e.status != "saved").length == 0;
    };

    self.setSelOrder = () => {
        if (!self.checkAllSync()) return;
        let order = self.selections.map(e => e.id);
        let postdata = {orden: order};
        $http({url: "set-ideas-orden", method: "post", data: postdata}).success((data) => {
            if (data.status == "ok") {
                console.log("Order saved");
            }
        });
    };

    let arrayIndexOfId = (arr, id) => {
        return arr.reduce((prev, cur, i) => (cur.id == id) ? i : prev, -1);
    };

    let loadPdf = (pdfData, i) => {
        PDFJS.disableWorker = true;
        let pdf = PDFJS.getDocument(pdfData);
        pdf.then((pdf) => renderPdf(pdf, i));
    };

    let renderPdf = (pdf, idx) => {
        for (let i = 1; i <= pdf.numPages; i++) {
            let p = pdf.getPage(i).then((p) => renderPage(p, idx));
            self.numPages += 1;
        }
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

        page.getTextContent({normalizeWhitespace: true}).then((textContent) => {
            let textLayer = new TextLayerBuilder($textLayerDiv.get(0), 0);
            textLayer.setTextContent(textContent);
            let renderContext = {
                canvasContext: context,
                viewport: viewport,
                textLayer: textLayer
            };
            page.render(renderContext).then(() => {
                self.numPages -= 1;
                if (self.numPages == 0) {
                    self.getIdeas();
                    $(".textLayer").html(function() {
                        return this.innerHTML.replace(/\t/g, ' ');
                    });
                }
            });
        });
    };

    self.init();

}]);