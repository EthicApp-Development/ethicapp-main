import { decoupledEditor, editorConfig, classicEditor } from "../../helpers/ckeditor/main.js";
export const CasesController = ($scope, $window, $http, $timeout, Notification, CaseService) => {
    const self = $scope;
    self.ownCases = [];
    self.publicCases = [];
    self.tabListCases = "ownCases";
    self.tabEditorDocuments = "editorTab";
    self.caseReadOnly = CaseService.readOnly;
    self.case = CaseService.actualCase;
    self.ckeditor = null;
    self.intervalAutoSave = null;
    self.tagInput = "";
    self.formFiles = [];
    self.isDragOver = false;
    

    self.initCasesView = () => {
        CaseService.getCases().then((response) => {
            self.ownCases = response.data.result.my_cases;
            self.publicCases = response.data.result.public_cases;
        });
        
    }

    self.viewCase = (caseId) => {
        CaseService.readOnly = true;
        CaseService.getCase(caseId).then((response) => {
            self.selectView("caseEditor");
        });
    }

    self.editCase = (caseId) => {
        CaseService.readOnly = false;
        CaseService.getCase(caseId).then((response) => {
            self.selectView("caseEditor");
        });
    }

    self.createCase = () => {
        CaseService.readOnly = false;
        CaseService.createCaseEmpty().then((response) => {
            self.selectView("caseEditor");
        });
    }

    self.deleteCase = (caseId) => {
        CaseService.deleteCase(caseId).then((response) => {
            // Notification.success("Case deleted");
            self.initCasesView();
        });
    }


    self.saveCase = () => {
        const caseId = self.case.case_id;
        const data = self.case;
        self.case.rich_text = self.ckeditor.getData();

        CaseService.editCase(caseId, data).then((response) => {
            // Notification.success("Case saved");
        });
    }

    self.initEditor = () => {
        decoupledEditor.create(document.querySelector('#editor'), editorConfig).then(editor => {
            document.querySelector('#editor-toolbar').appendChild(editor.ui.view.toolbar.element);
            document.querySelector('#editor-menu-bar').appendChild(editor.ui.view.menuBarView.element);
            self.ckeditor = editor;
            self.ckeditor.setData(self.case.rich_text);

            if (self.caseReadOnly) {
                self.ckeditor.enableReadOnlyMode('initEditor');

                const toolbarElement = self.ckeditor.ui.view.toolbar.element;
                toolbarElement.style.display = 'none';

                const menuBarView = self.ckeditor.ui.view.menuBarView.element;
                menuBarView.style.display = 'none';
            }

            return editor;
        });
    }

    self.saveAndExit = () => {
        self.saveCase();
        self.selectView("cases");
    }

    self.toggleIsPublic = (case_id, is_public) => {
        CaseService.setIsPublic(case_id, !is_public).then((response) => {
            // Notification.success("Case saved");
        });
    }

    self.manageEnterTag = (event) => {  
        if (event.key !== "Enter") return;
        
        event.preventDefault();
        
        const trimmedInput = self.tagInput.trim();
        
        if (!trimmedInput) return;
    
        const tagExists = self.case.topic_tags.some(tag => tag.name.trim() === trimmedInput);
        
        if (tagExists) {
            self.tagInput = "";
            return;
        }
    
        self.case.topic_tags.push({ name: trimmedInput });
        self.tagInput = "";
    }
    

    self.removeTag = (tag) => {
        self.case.topic_tags = self.case.topic_tags.filter((item) => item.name !== tag);
    }

    self.setTabEditorDocuments = (event) => {
        event.preventDefault();
        self.tabEditorDocuments = event.target.id;

    }


    self.initDragDrop = () => {
        const uploadContainer = document.getElementById('upload-container');

        if (!uploadContainer) return;
        
        uploadContainer.addEventListener('dragover', self.handleDragOver, false);
        uploadContainer.addEventListener('dragleave', self.handleDragLeave, false);
        uploadContainer.addEventListener('drop', self.handleDrop, false);

    }
    
    
    self.triggerFileInput = () => {
        const input = document.getElementById('file-input');
        
        input.onchange = (event) => {
            const files = event.target.files;
            self.addFiles(files);
            self.$apply(); // Asegura que AngularJS actualice la vista
        };
        
        input.click();
    }
    

    self.handleFileSelect = (event) => {
        const files = event.target.files;
        self.addFiles(files);
        self.$apply();
    }

    self.handleDragOver = (event) => {
        event.preventDefault();
        event.stopPropagation();
        self.isDragOver = true;
    }

    self.handleDragLeave = (event) => {
        event.preventDefault();
        event.stopPropagation();
        self.isDragOver = false;
        self.$apply();
    }

    self.handleDrop = (event) => {
        event.preventDefault();
        event.stopPropagation();
        const files = event.dataTransfer.files;
        self.addFiles(files);
        self.isDragOver = false;
        self.$apply();
    }

    self.addFiles = (files) => {
        Array.from(files).forEach(file => {
            if (file.type === 'application/pdf') {
                self.formFiles.push(file);
            } else {
                alert('Solo se permiten archivos PDF');
            }
            
        });

        CaseService.uploadDocuments(self.case.case_id, self.formFiles).then((response) => {
            const files = response.data.result;
            files.forEach((file) => {
                if (self.case.documents.some((document) => document.path === file.path)) {
                    return
                } else {
                    self.case.documents.push(file);
                }
            });
        });
        self.formFiles = [];
        self.$apply();
    }
    

    self.removeFile = ($event, documentId) => {
        $event.preventDefault();
        const index = $event.target.id;
        self.formFiles.splice(index, 1);
        CaseService.deleteDocument(self.case.case_id, documentId).then((response) => {
            self.case.documents = self.case.documents.filter((document) => document.id !== documentId);
        });
    };

    self.viewFile = ($event, path) => {
        $event.preventDefault();
        const url = "/assets/uploads" + path;
        $window.open(url, '_blank');
    }


    self.truncateTextName = (textName, length) => {
        if (!textName) return;


        const arrayName = textName.split('.');
        if (arrayName.length == 2) {
            
            const name = arrayName[0];
            const extension = arrayName[1];
            if (name.length > length) {
                return name.substring(0, length) + '... .' + extension;
            }
        }
        return textName.substring(0, length);
    }

};
