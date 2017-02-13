"use strict";

let app = angular.module("Editor", ['ui.tree']);

app.controller("EditorController", ["$scope", "$http", "$timeout", function ($scope, $http, $timeout) {
    let self = $scope;

    self.iteration = 1;
    self.myUid = -1;
    self.documents = [];
    self.selections = [];
    self.selectedDocument = 0;
    self.numPages = 0;
    self.ansIter1 = {};
    self.ansIter2 = {};
    self.sideTab = 0;
    self.docIdx = {};
    self.writingReport = true;

    self.tabOptions = ["Actual"];

    rangy.init();
    self.applier = rangy.createClassApplier("highlight");
    self.secondaryApplier = rangy.createClassApplier("highlight-secondary");

    self.init = () => {
        self.getSesInfo();
    };

    self.getSesInfo = () => {
        $http({url: "get-ses-info", method: "post"}).success((data) => {
            self.iteration = data.iteration;
            self.myUid = data.uid;
            self.sesName = data.name;
            $http({url: "get-documents", method: "post"}).success((data) => {
                self.documents = data;
                data.forEach((doc,i) => {
                    self.docIdx[doc.id] = i;
                });
                self.renderAll();
            });
        });
    };

    self.setTab = (idx) => {
        self.sideTab = idx;
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
        let postdata = {iteration: Math.min(3,self.iteration)};
        $http({url: "get-ideas", method: "post", data: postdata}).success((data) => {
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
        if(self.iteration > 1) {
            $http({url: "get-team-ideas", method: "post", data: {iteration: 1}}).success((data) => {
                data.forEach((ans) => {
                    self.ansIter1[ans.uid] = self.ansIter1[ans.uid] || [];
                    self.ansIter1[ans.uid].push(ans);
                    self.highlightSerial(ans.serial, self.docIdx[ans.docid], self.secondaryApplier);
                });
                self.tabOptions.push("Iteración 1");
            });
        }
        if(self.iteration > 2) {
            $http({url: "get-team-ideas", method: "post", data: {iteration: 2}}).success((data) => {
                data.forEach((ans) => {
                    self.ansIter2[ans.uid] = self.ansIter2[ans.uid] || [];
                    self.ansIter2[ans.uid].push(ans);
                    self.highlightSerial(ans.serial, self.docIdx[ans.docid], self.secondaryApplier);
                });
                self.tabOptions.push("Iteración 2");
            });
        }
        if(self.iteration == 4){
            self.writingReport = true;
        }
        else if(self.iteration == 5){
            window.location.replace("rubrica");
        }
    };

    self.sendIdea = (sel) => {
        let postadata = {
            text: sel.text,
            comment: sel.comment,
            serial: sel.serial,
            docid: self.documents[sel.document].id,
            iteration: self.iteration
        };
        if (sel.status == "unsaved") {
            $http({url: "send-idea", method: "post", data: postadata}).success((data) => {
                if (data.status == "ok") {
                    sel.expanded = false;
                    sel.status = "saved";
                    sel.id = data.id;
                }
            });
        }
        else if (sel.status == "dirty" && sel.id != null) {
            postadata.id = sel.id;
            $http({url: "update-idea", method: "post", data: postadata}).success((data) => {
                if (data.status == "ok") {
                    sel.expanded = false;
                    sel.status = "saved";
                }
            });
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

        page.getTextContent().then((textContent) => {
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
                }
            });
        });
    };

    self.init();

}]);

app.controller("ReportController", ["$scope", "$http", function ($scope, $http) {
    let self = $scope;
    self.isFull = true;
    self.content = "";
    self.lastSent = null;

    self.toggleFull = () => {
        self.isFull = !self.isFull;
    };

    self.sendReport = () => {
        let postdata = {content: self.content};
        $http({url:"send-report", method:"post", data:postdata}).success((data) => {
            if (data.status == "ok"){
                self.lastSent = new Date();
            }
        });
    };

    self.getReport = () => {
        $http({url:"get-my-report", method:"post"}).success((data) => {
            if (data.status == "ok"){
                self.content = data.content;
            }
        });
    };

    self.getReport();

}]);

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

