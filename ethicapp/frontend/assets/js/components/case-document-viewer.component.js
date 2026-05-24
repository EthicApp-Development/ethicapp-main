const CaseDocumentViewerController = function() {
    this.isFullscreenOpen = false;
    this.renderedImagesCache = [];
    this.renderedImagesCacheSources = {};

    this.getDocumentProcessing = function() {
        return this.caseItem?.documentProcessing || null;
    };

    this.getContentRepresentation = function() {
        if (!this.caseItem || !Array.isArray(this.caseItem.representations)) {
            return null;
        }

        return this.caseItem.representations.find((representation) => {
            return representation.rel === "content";
        }) || null;
    };

    this.getPdfUrl = function() {
        return this.getContentRepresentation()?.href || this.caseItem?.pdfPath || "";
    };

    this.buildRenderedImages = function() {
        const documentImages = this.caseItem?.documentRepresentation?.content?.images;
        const renderedImages = Array.isArray(documentImages) ? documentImages : this.caseItem?.renderedImages;
        if (Array.isArray(renderedImages) && renderedImages.length > 0) {
            return renderedImages
                .map((image, index) => ({
                    ...image,
                    sequenceNumber: image.sequenceNumber || image.pageNumber || index + 1,
                    src:            image.url || image.dataUri || "",
                }))
                .filter((image) => image.src)
                .sort((left, right) => left.sequenceNumber - right.sequenceNumber);
        }

        if (!Array.isArray(this.caseItem?.representations)) {
            return [];
        }

        return this.caseItem.representations
            .filter((representation) => {
                return representation.rel === "rendered-image" && /^image\//.test(representation.mediaType || "");
            })
            .map((representation, index) => ({
                sequenceNumber: representation.sequenceNumber || representation.pageNumber || index + 1,
                pageNumber:     representation.pageNumber,
                contentType:    representation.mediaType,
                src:            representation.href,
                width:          representation.width,
                height:         representation.height,
            }))
            .filter((image) => image.src)
            .sort((left, right) => left.sequenceNumber - right.sequenceNumber);
    };

    this.refreshRenderedImagesCache = function() {
        const documentImages = this.caseItem?.documentRepresentation?.content?.images;
        const renderedImages = this.caseItem?.renderedImages;
        const representations = this.caseItem?.representations;
        const sources = {
            caseItem:        this.caseItem,
            documentImages,
            renderedImages,
            representations,
        };

        const cacheSources = this.renderedImagesCacheSources;
        const isCacheCurrent = cacheSources.caseItem === sources.caseItem
            && cacheSources.documentImages === sources.documentImages
            && cacheSources.renderedImages === sources.renderedImages
            && cacheSources.representations === sources.representations;

        if (!isCacheCurrent) {
            this.renderedImagesCache = this.buildRenderedImages();
            this.renderedImagesCacheSources = sources;
        }
    };

    this.getRenderedImages = function() {
        this.refreshRenderedImagesCache();
        return this.renderedImagesCache;
    };

    this.hasRenderedImages = function() {
        return this.getRenderedImages().length > 0;
    };

    this.isProcessing = function() {
        const status = this.getDocumentProcessing()?.status;
        return status === "pending" || status === "processing";
    };

    this.hasFailed = function() {
        return this.getDocumentProcessing()?.status === "failed";
    };

    this.openFullscreen = function() {
        if (!this.hasRenderedImages()) {
            return;
        }

        this.isFullscreenOpen = true;
    };

    this.closeFullscreen = function() {
        this.isFullscreenOpen = false;
    };
};

const caseDocumentViewerComponent = {
    bindings: {
        caseItem: "<",
    },
    controller:  CaseDocumentViewerController,
    templateUrl: "/assets/static/views/teacher/fragments/case-document-viewer.template.html",
};

export default caseDocumentViewerComponent;
