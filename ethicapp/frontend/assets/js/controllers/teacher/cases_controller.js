import { decoupledEditor, editorConfig, classicEditor } from "../../helpers/ckeditor/main.js";
export const CasesController = ($scope, $window, $http, Notification, CaseService) => {
    const self = $scope;
    self.ownCases = [];
    self.publicCases = [];
    self.tab = 0;
    self.caseReadOnly = CaseService.readOnly;
    self.case = CaseService.actualCase;
    self.ckeditor = null;
    self.intervalAutoSave = null;
    self.tagInput = "";



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
    };

    self.editCase = (caseId) => {
        CaseService.readOnly = false;
        CaseService.getCase(caseId).then((response) => {
            self.selectView("caseEditor");
        });
    };

    self.createCase = () => {
        CaseService.readOnly = false;
        CaseService.createCaseEmpty().then((response) => {
            self.selectView("caseEditor");
        });
    };

    self.deleteCase = (caseId) => {
        CaseService.deleteCase(caseId).then((response) => {
            // Notification.success("Case deleted");
            self.initCasesView();
        });
    };


    self.saveCase = () => {
        const caseId = self.case.case_id;
        const data = self.case;
        self.case.rich_text = self.ckeditor.getData();

        CaseService.editCase(caseId, data).then((response) => {
            // Notification.success("Case saved");
        });
    };

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
    };

    self.toggleIsPublic = (case_id, is_public) => {
        CaseService.setIsPublic(case_id, !is_public).then((response) => {
            // Notification.success("Case saved");
        });
    }

    self.manageEnterTag = (event) => {  
        if (event.key === "Enter") {
            event.preventDefault();
            if (self.tagInput.trim() === "") {
                return
            } 
            
            self.case.topic_tags.some((tag) => { tag.name === self.tagInput.trim() });
            if (self.case.topic_tags.some((tag) => { tag.name === self.tagInput.trim() })) {
                self.tagInput = "";
                return;
            }
            
            self.case.topic_tags.push({name: self.tagInput.trim()});
            self.tagInput = "";

        }
    }

    self.removeTag = (tag) => {
        self.case.topic_tags = self.case.topic_tags.filter((item) => item.name !== tag);
    }
};
