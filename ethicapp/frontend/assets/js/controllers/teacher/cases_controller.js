import { formatDate as _formatDate } from "../../helpers/date-formatter.js";

export const CasesController = (
  $scope,
  $window,
  $http,
  $timeout,
  Notification,
  CaseService
) => {
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
  self.userSearch = "";

  self.initCasesView = () => {
    CaseService.getCases().then((response) => {
      self.ownCases = response.data.result.my_cases;
      self.publicCases = response.data.result.public_cases;
    });
  };

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
      self.initCasesView();
    });
  };

  self.cloneCase = (caseId) => {
    CaseService.cloneCase(caseId).then((response) => {
        self.initCasesView();
    });
  };

  self.saveCase = () => {
    const caseId = self.case.case_id;
    const data = self.case;
    self.case.rich_text = ckeditor.getData();

    CaseService.editCase(caseId, data).then((response) => {
    });
  };

  self.initEditor = (caseReadOnly) => {
    const editor = CaseService.initEditor(caseReadOnly, self.case);
    self.ckeditor = editor;
  };

  self.saveAndExit = () => {
    self.saveCase();
    self.selectView("cases");
  };

  self.toggleIsPublic = (case_id, is_public) => {
    CaseService.setIsPublic(case_id, !is_public).then((response) => {
    });
  };

  self.manageEnterTag = (event) => {
    if (event.key !== "Enter") return;

    event.preventDefault();

    const trimmedInput = self.tagInput.trim();

    if (!trimmedInput) return;

    const tagExists = self.case.topic_tags.some(
      (tag) => tag.name.trim() === trimmedInput
    );

    if (tagExists) {
      self.tagInput = "";
      return;
    }

    self.case.topic_tags.push({ name: trimmedInput });
    self.tagInput = "";
  };

  self.removeTag = (tag) => {
    self.case.topic_tags = self.case.topic_tags.filter(
      (item) => item.name !== tag
    );
  };

  self.setTabEditorDocuments = (event) => {
    event.preventDefault();
    self.tabEditorDocuments = event.target.id;
  };

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
        input.value = '';
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
              self.formFiles.push(file);
            } else {
              alert('Only PDF files are allowed');
            }
          
      });

      if (self.formFiles.length === 0) {
          return;
      }

      CaseService.uploadDocuments(self.case.case_id, self.formFiles).then((response) => {
          const files = response.data.result;
          files.forEach((file) => {
              if (self.case.documents.some((document) => document.path === file.path)) {
                  return
              } else {
                  self.case.documents.push(file);
              }
          });
      })

      self.formFiles = [];
      self.$apply();
  }


  self.removeFile = ($event, index) => {
      $event.preventDefault();
      CaseService.deleteDocument(self.case.case_id, self.case.documents[index].id).then((response) => {
      })
      self.case.documents.splice(index, 1);
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
          self.renameDocument($event, documentId, newName);
          $event.target.blur();
      }
  }

  self.customFilter = (anyCase) => {
    return CaseService.customFilter(anyCase, self.userSearch);
  };

  self.formatDate = function (date) {
    return _formatDate(date);
  };

  self.handleMouseOverClone = function(event) {
    event.target.src = "../../assets/images/iconsets/gray-lineart/design-clone-active.svg";
    event.target.style.cursor = "pointer";
  };
  
  self.handleMouseLeaveClone = function(event) {
    event.target.src = "../../assets/images/iconsets/gray-lineart/design-clone.svg";
    event.target.style.cursor = "default";
  };
  
  self.handleClickClone = function(event, caseId) {
    self.cloneCase(caseId);
  };
  
};
