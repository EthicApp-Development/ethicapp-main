export class casesService {
    constructor($http) {

        this.actualCase = {};
        this.readOnly = false;

        this.getCases = () => {
            return $http.get("/cases")
                .then((response) => {
                    return response;
                })
                .catch((error) => {
                    console.error("Error fetching cases:", error);
                    throw error;
                });
        };

        this.getCase = (caseId) => {
            return $http.get(`/cases/${caseId}`)
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
            return $http.post("/cases")
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
            return $http.patch(`/cases/${caseId}`, data)
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
            return $http.delete(`/cases/${caseId}`)
                .then((response) => {
                    this.actualCase = {};
                    return response;
                })
                .catch((error) => {
                    console.error(`Error deleting case ${caseId}:`, error);
                    throw error;
                });
        };

        this.setIsPublic = (caseId, bool) => {
            return $http.patch(`/cases/${caseId}`, { is_public: bool })
                .then((response) => {
                    return response;
                })
                .catch((error) => {
                    console.error(`Error toggling case ${caseId} public status:`, error);
                    throw error;
                });
        };

        this.uploadDocuments = (caseId, files) => {
            const formData = new FormData();

            files.forEach((file) => {
                if (file.type === 'application/pdf') {
                    formData.append("pdf", file);
                } else {
                    console.error(`El archivo ${file.name} no es un PDF válido y no será subido.`);
                }
            });

            if (formData.has("pdf")) {
                return $http.post(`/cases/${caseId}/documents`, formData, {
                    headers: { "Content-Type": undefined }
                })
                    .then((response) => {
                        return response;
                    })
                    .catch((error) => {
                        console.error(`Error uploading files for case ${caseId}:`, error);
                        throw error;
                    });
            } else {
                return Promise.reject(new Error("No hay archivos PDF válidos para subir."));
            }
        };

        this.deleteDocument = (caseId, documentId) => {
            return $http.delete(`/cases/${caseId}/documents/${documentId}`)
                .then((response) => {
                    return response;
                })
                .catch((error) => {
                    console.error(`Error deleting document ${documentId} from case ${caseId}:`, error);
                    throw error;
                });
        };

    }
}