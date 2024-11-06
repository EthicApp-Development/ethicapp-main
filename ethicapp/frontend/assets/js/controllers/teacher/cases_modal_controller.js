import { formatDate as _formatDate } from '../../helpers/date-formatter.js';
export function CasesModalController($scope, $window, $http, $timeout, $uibModalInstance, Notification, CaseService) {
    self = $scope;
    self.usefullCases = [];
    self.selectedCaseId = null;
    self.userSearch = "";
    self.tabSelectCase = "selectCase";
    self.formFiles = [];
    self.case = null;

    self.getUsefullCases = () => {
        CaseService.getCases().then((response) => {
            const ownCases = response.data.result.my_cases;
            const publicCases = response.data.result.public_cases;
            self.usefullCases = ownCases.concat(publicCases);
        });
    }

    self.dismiss = function() {
        $uibModalInstance.dismiss('cancel');
    }

    self.customFilter = (anyCase) => {
        return CaseService.customFilter(anyCase, self.userSearch);
    }

    self.formatDate = function(date) {
        return _formatDate(date);
    };

    self.selectCase = (caseId) =>{
        self.selectedCaseId = caseId;
        $uibModalInstance.close(self.selectedCaseId);
    }


    self.initDragDrop = () => {
        const uploadContainer = document.getElementById('upload-container');

        uploadContainer.addEventListener('mouseover', () => {
            uploadContainer.classList.add('over'); 
        });

        uploadContainer.addEventListener('mouseout', () => {
            uploadContainer.classList.remove('over'); 
        });

        uploadContainer.addEventListener('dragover', (event) => {
            self.handleDragOver(event);
            uploadContainer.classList.add('over'); 
        });

        uploadContainer.addEventListener('dragleave', (event) => {
            self.handleDragLeave(event);
            uploadContainer.classList.remove('over'); 
        });

        uploadContainer.addEventListener('drop', (event) => { 
            self.handleDrop(event);
            uploadContainer.classList.remove('over'); 
        })
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
    }

    self.handleDragLeave = (event) => {
        event.preventDefault();
        event.stopPropagation();
        self.$apply();
    }

    self.handleDrop = (event) => {
        event.preventDefault();
        event.stopPropagation();
        const files = event.dataTransfer.files;
        self.addFiles(files);
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

        self.$apply();
    }
    

    self.removeFile = ($event, index) => {
        $event.preventDefault();
        self.formFiles.splice(index, 1);
    };

    self.viewFile = ($event, path) => {
        $event.preventDefault();
        const url = path;
        $window.open(url, '_blank');
    }

    self.renameDocument = ($event, documentId, newName) => {
        $event.preventDefault();
        CaseService.renameDocument(documentId, newName).then((response) => {
        });
    }

    self.renameDocumentOnEnter = ($event, documentId) => {
        if ($event.key === 'Enter') {
            const newName = $event.target.value;
            // self.renameDocument($event, documentId, newName);
            $event.target.blur();
        }
    }

    self.createCaseFromDocs = (event) => {
        event.preventDefault();
        
        CaseService.createCaseEmpty().then((response) => {
            const newCaseId = response.data.result.case_id;
            
            CaseService.uploadDocuments(newCaseId, self.formFiles).then((response) => {
                const result = response.data.result;
                
                $uibModalInstance.close(newCaseId);
            })
        });
        
    }
}