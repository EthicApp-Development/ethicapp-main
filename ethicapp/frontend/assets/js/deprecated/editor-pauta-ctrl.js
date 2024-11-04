"use strict";

let app = angular.module("Editor", ["ui.tree", "timer"]);

app.controller("EditorController", [
    "$scope", "$http", "$timeout",
    function ($scope, $http, $timeout) {
        let self = $scope;

        self.documents = [];
        self.selections = [];
        self.selectedDocument = 0;
        self.numPages = 0;
        self.docIdx = {};
        self.editable = false;
        self.orden = 1;
        self.sesStatusses = [
            "Lectura", "Individual", "Anónimo", "Grupal", "Reporte", "Rubrica Calibración",
            "Evaluación de Pares", "Finalizada"
        ];

        rangy.init();
        self.applier = rangy.createClassApplier("highlight");
        self.secondaryApplier = rangy.createClassApplier("highlight-secondary");

        self.init = () => {
            self.getSesInfo();
        };

        self.getSesInfo = async () => {
            try {
                // Get session information
                const sesInfoResponse = await $http({ url: "get-ses-info", method: "post" });
                const sesInfoData = sesInfoResponse.data;
                self.iteration = sesInfoData.iteration;
                self.sesSTime = sesInfoData.stime ? new Date(sesInfoData.stime) : null;
                console.log(self.sesSTime);
        
                // Get session documents
                const documentsResponse = await $http({ url: "get-documents", method: "post" });
                self.documents = documentsResponse.data;
                self.documents.forEach((doc, i) => {
                    self.docIdx[doc.id] = i;
                });
                self.renderAll();
        
                // See if the "pauta" thing is editable
                const pautaResponse = await $http({ url: "pauta-editable", method: "post" });
                self.editable = pautaResponse.data.editable;
        
            } catch (error) {
                console.error("Error loading session information:", error);
                Notification.error("Error al cargar la información de la sesión");
            }
        };
        
        self.selectText = () => {
            let selection = window.getSelection();
            let serial = rangy.serializeSelection(
                window, true, $("#pdf-canvas-" + self.selectedDocument)[0]
            );
            let textDef = {
                text:     selection.toString(),
                length:   selection.toString().length,
                serial:   serial,
                document: self.selectedDocument,
                comment:  "",
                expanded: true,
                order:    self.orden,
                status:   "unsaved"
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
                applier.applyToRange(
                    rangy.deserializeRange(serial, $("#pdf-canvas-" + index)[0], document)
                );
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

        self.getIdeas = async () => {
            try {
                const postdata = { iteration: 1 };
                const url = "get-ideas";
                
                // Realizar solicitud para obtener ideas
                const response = await $http({ url: url, method: "post", data: postdata });
                const ideasData = response.data;
                
                // Procesar las ideas recibidas
                self.selections = ideasData.map((idea) => {
                    return {
                        id:       idea.id,
                        text:     idea.content,
                        serial:   idea.serial,
                        document: arrayIndexOfId(self.documents, idea.docid),
                        comment:  idea.descr,
                        expanded: false,
                        order:    idea.orden + 1,
                        status:   "saved"
                    };
                });
            } catch (error) {
                console.error("Error fetching ideas:", error);
                Notification.error("Error al cargar las ideas");
            }
        };
        
        self.sendIdea = async (sel) => {
            const postdata = {
                text:      sel.text,
                comment:   sel.comment,
                serial:    sel.serial,
                docid:     self.documents[sel.document].id,
                iteration: 1,
                order:     sel.order - 1
            };
            self.order = sel.order;
        
            try {
                if (sel.status === "unsaved") {
                    // Enviar una nueva idea
                    const response = await $http({ url: "send-pauta-idea", method: "post", data: postdata });
                    if (response.data.status === "ok") {
                        sel.expanded = false;
                        sel.status = "saved";
                        sel.id = response.data.id;
                    }
                } else if (sel.status === "dirty" && sel.id != null) {
                    // Actualizar una idea existente
                    postdata.id = sel.id;
                    const response = await $http({ url: "update-pauta-idea", method: "post", data: postdata });
                    if (response.data.status === "ok") {
                        sel.expanded = false;
                        sel.status = "saved";
                    }
                }
            } catch (error) {
                console.error("Error sending or updating idea:", error);
                Notification.error("Error al guardar la idea");
            }
        };
        
        self.deleteIdea = async (sel, index) => {
            try {
                // Si la idea ya tiene un id, la eliminamos en el backend
                if (sel.id != null) {
                    const postdata = { id: sel.id };
                    const response = await $http({ url: "delete-idea", method: "post", data: postdata });
        
                    if (response.data.status === "ok") {
                        self.selections.splice(index, 1);
                    } else {
                        Notification.error("Error al eliminar la idea");
                    }
                } else {
                    // Si no tiene id, simplemente la eliminamos localmente
                    self.selections.splice(index, 1);
                }
            } catch (error) {
                console.error("Error deleting idea:", error);
                Notification.error("No se pudo eliminar la idea");
            }
        };
        
        self.selTextChange = (sel) => {
            sel.status = (sel.status == "saved") ? "dirty" : sel.status;
        };

        self.checkAllSync = () => {
            return self.selections.filter(e => e.status != "saved").length == 0;
        };

        self.setSelOrder = async () => {
            // Verifica si todas las selecciones están sincronizadas antes de proceder
            if (!self.checkAllSync()) return;
        
            const order = self.selections.map(e => e.id);
            const postdata = { orden: order };
        
            try {
                const response = await $http({ url: "set-ideas-orden", method: "post", data: postdata });
        
                if (response.data.status === "ok") {
                    console.log("Order saved");
                    Notification.success("El orden se ha guardado correctamente");
                } else {
                    Notification.error("Error al guardar el orden");
                }
            } catch (error) {
                console.error("Error saving order:", error);
                Notification.error("No se pudo guardar el orden de las ideas");
            }
        };
        
        function arrayIndexOfId (arr, id)  {
            return arr.reduce((prev, cur, i) => (cur.id == id) ? i : prev, -1);
        }

        function loadPdf (pdfData, i) {
            PDFJS.disableWorker = true;
            let pdf = PDFJS.getDocument(pdfData);
            pdf.then((pdf) => renderPdf(pdf, i));
        }

        function renderPdf (pdf, idx) {
            for (let i = 1; i <= pdf.numPages; i++) {
                pdf.getPage(i).then((p) => renderPage(p, idx));
                self.numPages += 1;
            }
        }

        function renderPage (page, i)  {
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

            $canvas.offset();
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
                    viewport:      viewport,
                    textLayer:     textLayer
                };
                page.render(renderContext).then(() => {
                    self.numPages -= 1;
                    if (self.numPages == 0) {
                        self.getIdeas();
                        $(".textLayer").html(function() {
                            return this.innerHTML.replace(/\t/g, " ");
                        });
                    }
                });
            });
        }

        self.init();

    }]);
