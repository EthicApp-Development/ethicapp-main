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
            self.$apply();
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
                const _file = {
                    name: file.name,
                    file: file,
                }
                self.formFiles.push(_file);

            } else {
                alert('Only PDF files are allowed');
            }
        });

        self.$apply();
    }
    

    self.removeFile = ($event, index) => {
        $event.preventDefault();
        self.formFiles.splice(index, 1);
    };

    self.viewFile = ($event, file) => {
        $event.preventDefault();
    
        if (file && file instanceof File) {
            const fileURL = URL.createObjectURL(file);
            window.open(fileURL, '_blank');
    
            setTimeout(() => URL.revokeObjectURL(fileURL), 100);
        } else {
            console.error("El archivo no es válido o no se proporcionó.");
        }
    };
    
    self.renameDocument = ($event, documentId, newName) => {
        $event.preventDefault();
        CaseService.renameDocument(documentId, newName).then((response) => {
        });
    }

    self.renameDocumentOnEnter = ($event, documentId) => {
        // if ($event.key === 'Enter') {
        //     const newName = $event.target.value;
        //     // self.renameDocument($event, documentId, newName);
        //     $event.target.blur();
        // }
    }

    self.createCaseFromDocs = (event) => {
        event.preventDefault();
        
        CaseService.createCaseEmpty().then((response) => {
            const newCaseId = response.data.result.case_id;

            let filesNames = [];
            let files = [];

            self.formFiles.forEach((file, index) => {
                files.push(file.file);
                filesNames.push(file.name);
            });


            
            CaseService.uploadDocuments(newCaseId, files, filesNames).then((response) => {
                const result = response.data.result;
                
                $uibModalInstance.close(newCaseId);
            })
        });
        
    }
}