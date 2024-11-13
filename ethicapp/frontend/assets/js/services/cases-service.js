import { formatDate as _formatDate } from "../helpers/date-formatter.js";
import { editorConfig, classicEditor } from "../helpers/ckeditor/main.js";

export class CasesService {
  constructor($http) {
    this.actualCase = {};
    this.readOnly = false;
    this.ckeditor = null;

    this.getCases = () => {
      return $http
        .get("/cases")
        .then((response) => {
          return response;
        })
        .catch((error) => {
          console.error("Error fetching cases:", error);
          throw error;
        });
    };

    this.getCase = (caseId) => {
      return $http
        .get(`/cases/${caseId}`)
        .then((response) => {
          this.actualCase = response.data.result;
          return response;
        })
        .catch((error) => {
          console.error(`Error fetching case ${caseId}:`, error);
          throw error;
        });
    };

    this.createCaseEmpty = () => {
      return $http
        .post("/cases")
        .then((response) => {
          const newCaseId = response.data.caseId;
          return this.getCase(newCaseId);
        })
        .then((response) => {
          return response;
        })
        .catch((error) => {
          console.error("Error creating case:", error);
          throw error;
        });
    };

    this.editCase = (caseId, data) => {
      return $http
        .patch(`/cases/${caseId}`, data)
        .then(() => {
          return this.getCase(caseId);
        })
        .then((response) => {
          return response;
        })
        .catch((error) => {
          console.error(`Error editing case ${caseId}:`, error);
          throw error;
        });
    };

    this.deleteCase = (caseId) => {
      return $http
        .delete(`/cases/${caseId}`)
        .then((response) => {
          this.actualCase = {};
          return response;
        })
        .catch((error) => {
          console.error(`Error deleting case ${caseId}:`, error);
          throw error;
        });
    };

    this.cloneCase = (caseId) => {
      return $http
        .post(`/cases/${caseId}/clone`)
        .then((response) => {
          const newCaseId = response.data.newCaseId;
          return this.getCase(newCaseId);
        })
        .then((response) => {
          return response;
        })
        .catch((error) => {
          console.error(`Error cloning case ${caseId}:`, error);
          throw error;
        });
    };

    this.setIsPublic = (caseId, bool) => {
      return $http
        .patch(`/cases/${caseId}`, { is_public: bool })
        .then((response) => {
          return response;
        })
        .catch((error) => {
          console.error(`Error toggling case ${caseId} public status:`, error);
          throw error;
        });
    };

    this.uploadDocuments = (caseId, files, filesNames = null) => {

      let changeName = filesNames && filesNames.length === files.length;

      if (filesNames && filesNames.length !== files.length) {
      console.error("The number of filenames does not match the number of files. Filenames will not be changed.");
      }

      const formData = new FormData();

      files.forEach((file, index) => {
      if (file.type === "application/pdf") {
        formData.append("pdf", file);
      } else {
        console.error(`File ${file.name} is not a valid PDF and will not be uploaded.`);
      }
      });

      if (formData.has("pdf")) {
      return $http
        .post(`/cases/${caseId}/documents`, formData, {
        headers: { "Content-Type": undefined },
        })
        .then((response) => {
          if (changeName) {
          response.data.result.forEach((file, index) => {
            if (filesNames[index] !== file.name) {
            this.renameDocument(file.id, filesNames[index]);
            }
          });
          }

        return response;
        })
        .catch((error) => {
        console.error(`Error uploading files for case ${caseId}:`, error);
        throw error;
        });
      } else {
      return Promise.reject(
        new Error("No hay archivos PDF válidos para subir.")
      );
      }
    };
    

    this.deleteDocument = (caseId, documentId) => {
      return $http
        .delete(`/cases/${caseId}/documents/${documentId}`)
        .then((response) => {
          return response;
        })
        .catch((error) => {
          console.error(
            `Error deleting document ${documentId} from case ${caseId}:`,
            error
          );
          throw error;
        });
    };

    this.renameDocument = (documentId, newName) => {
      return $http
        .patch(`/documents/${documentId}`, { name: newName })
        .then((response) => {
          return response;
        })
        .catch((error) => {
          console.error(`Error renaming document ${documentId}:`, error);
          throw error;
        });
    };

    this.customFilter = (anyCase, search) => {
      const searchLowerCase = search.toLowerCase();
      if (search === "") return anyCase;
      return (
        anyCase.title?.toLowerCase().includes(searchLowerCase) ||
        anyCase.description?.toLowerCase().includes(searchLowerCase) ||
        _formatDate(anyCase.created_at?.toLowerCase()).includes(
          searchLowerCase
        ) ||
        anyCase.updated_at?.toLowerCase().includes(searchLowerCase) ||
        anyCase.topic_tags?.some((tag) =>
          tag.name.toLowerCase().includes(searchLowerCase)
        ) ||
        anyCase.creator?.toLowerCase().includes(searchLowerCase)
      );
    };

    this.attachCaseToDesign = (caseId, designId) => {
      return $http
        .patch(`/designs/${designId}/case`, { caseId })
        .then((response) => {
          return response;
        })
        .catch((error) => {
          console.error(
            `Error attaching case ${caseId} to design ${designId}:`,
            error
          );
          throw error;
        });
    };

    this.getCaseFromDesign = (designId) => {
      return $http
        .get(`/designs/${designId}/case`)
        .then((response) => {
            this.actualCase = response.data.result;
            return response;
        })
        .catch((error) => {
          console.error(
            `Error getting case from design id ${designId}:`,
            error
          );
          throw error;
        });
    };

    this.initEditor = (caseReadOnly, _case) => {
      classicEditor.create(document.querySelector('#editor'), editorConfig).then(editor => {
          self.ckeditor = editor;
          self.ckeditor.setData(_case.rich_text);

          if (caseReadOnly) {
              self.ckeditor.enableReadOnlyMode('initEditor');

              const toolbarElement = self.ckeditor.ui.view.toolbar.element;
              toolbarElement.style.display = 'none';

              const menuBarView = self.ckeditor.ui.view.menuBarView.element;
              menuBarView.style.display = 'none';
          }

          return editor;
      });
    }


    this.ckeditorIsNotEmpty = (texto) => {
      const regex = /^(?!<p>&nbsp;<\/p>(<p>&nbsp;<\/p>)*$).+/;
      return regex.test(texto);
    }
    
  
  }
}
