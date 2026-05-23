/*eslint func-style: ["error", "expression"]*/
export function BrowseDesignsController($scope, $routeParams, toast, $translate,
    ActivityStateService, DesignCatalogService, DesignPublicationService, $timeout, $window) {

    const vm = this;
    vm.selectedDesignId = 0;
    vm.dsgnMode = 0;
    vm.hasFetchedUserDesigns = false;
    vm.userSearch = "";
    vm.designSearchQuery = "";
    vm.userDesigns = [];
    vm.publicDesigns = [];
    vm.archivedDesigns = [];
    vm.designs = [];
    vm.currentPage = 1;
    vm.pageSize = 5;

    vm.goBack = function() {
        if ($window.history.length > 1) {
            $window.history.back();
            return;
        }

        $scope.navigateTo("/");
    };

    vm.scrollToActivitySetup = function() {
        $timeout(() => {
            const stepPanel = $window.document.getElementById("activity-launch-step");
            if (stepPanel) {
                stepPanel.scrollIntoView({ behavior: "smooth", block: "start" });
            }
            const descriptionInput = $window.document.getElementById("activity-description-input");
            if (descriptionInput) {
                descriptionInput.focus({ preventScroll: true });
            }
        }, 0, false);
    };

    vm.init = async function() {
        const updateHandler = function() {
            vm.forceFetchDesigns();
        };

        DesignCatalogService.registerListener("onDesignCatalogUpdated", 
            updateHandler);

        $scope.$on('$destroy', function () {
            DesignCatalogService.unregisterListener("onDesignCatalogUpdated", 
                updateHandler);    
        });
        $scope.$on("caseVisibilityUpdatedDesigns", function(_event, data) {
            DesignCatalogService.applyPrivateVisibilityToDesigns(data?.affectedDesignIds || []);
            vm.forceFetchDesigns();
        });
        
        try {
            await vm.forceFetchDesigns();

            const designIdParam = Number($routeParams.designId);
            if (!isNaN(designIdParam)) {
                vm.selectedDesignId = designIdParam;
                const designObj = await DesignCatalogService.getDesignById(vm.selectedDesignId);
                vm.userSearch = vm.formatDesignLabel(designObj);
                vm.designSearchQuery = vm.userSearch;
            }
        } catch(error) {
            console.error("[BrowseDesignsController::init] Failed to retrieve designId route parameter");
        }        
    }

    vm.handleSelectDesign = function(id) {
        $scope.$applyAsync(() => {
            vm.selectedDesignId = id;
            vm.scrollToActivitySetup();
        });
    }

    vm.forceFetchDesigns = async function() {
        vm.userDesigns = await DesignCatalogService.getUserDesigns(true);
        vm.archivedDesigns = await DesignCatalogService.getArchivedDesigns();
        vm.publicDesigns = await DesignCatalogService.getPublicDesigns();
        vm.designs = await DesignCatalogService.getDesigns();
        vm.setPage(vm.currentPage);

        $scope.$applyAsync();
    }

    vm.showDesignToast = function(messageKey, className = undefined) {
        $scope.$applyAsync(() => {
            $translate(messageKey).then((result) => {
                toast.create({
                    timeout: 6 * 1000,
                    message: result,
                    className,
                    containerClass: 'designs-toast-container',
                    dismissible: false,
                    defaultToastClass: 'toast',
                    insertFromTop: true,
                });
            });
        });
    };

    vm.designPublic = async function(design) {
        try {
            const result = await DesignPublicationService.togglePublicVisibility(design);
            if (result.status === "case_not_ready") {
                vm.showDesignToast("case_publication_settings_not_public", "alert-warning");
            }
        } catch (error) {
            console.error("[BrowseDesignsController::designPublic] Error changing design visibility.", error);
            vm.showDesignToast("design_visibility_update_error", "alert-danger");
        } finally {
            $scope.$applyAsync();
        }
    };
    
    vm.designLock = async function(id) {
        await DesignCatalogService.toggleDesignLock(id);
    };
    
    vm.getDesigns = async function() {
        vm.userDesigns = await DesignCatalogService.getUserDesigns();
        vm.archivedDesigns = await DesignCatalogService.getArchivedDesigns();
        vm.hasFetchedUserDesigns = true;
        vm.setPage(vm.currentPage);
        $scope.$applyAsync();
    };

    vm.getUserDesigns = async function() {
        vm.userDesigns = await DesignCatalogService.getUserDesigns();
        vm.setPage(vm.currentPage);
        $scope.$applyAsync();
    };

    vm.setDesignMode = function(mode) {
        const nextMode = Number(mode);
        if (!Number.isInteger(nextMode)) {
            return;
        }

        vm.dsgnMode = [0, 1, 2].includes(nextMode) ? nextMode : 0;
        vm.currentPage = 1;
    };

    vm.getActiveDesigns = function() {
        if (vm.dsgnMode === 1) {
            return vm.publicDesigns;
        }
        if (vm.dsgnMode === 2) {
            return vm.archivedDesigns;
        }
        return vm.userDesigns;
    };

    vm.designMatchesSearch = function(design) {
        const query = String(vm.userSearch || "").trim().toLowerCase();
        if (query.length === 0) {
            return true;
        }

        return vm.formatDesignLabel(design).toLowerCase().includes(query);
    };

    vm.getFilteredDesigns = function() {
        return vm.getActiveDesigns().filter(vm.designMatchesSearch);
    };

    vm.getTotalPages = function() {
        return Math.max(1, Math.ceil(vm.getFilteredDesigns().length / vm.pageSize));
    };

    vm.getPaginatedDesigns = function() {
        const startIndex = (vm.currentPage - 1) * vm.pageSize;
        return vm.getFilteredDesigns().slice(startIndex, startIndex + vm.pageSize);
    };

    vm.setPage = function(pageNumber) {
        const nextPage = Number(pageNumber);
        if (!Number.isInteger(nextPage)) {
            return;
        }

        vm.currentPage = Math.min(Math.max(nextPage, 1), vm.getTotalPages());
    };

    vm.previousPage = function() {
        vm.setPage(vm.currentPage - 1);
    };

    vm.nextPage = function() {
        vm.setPage(vm.currentPage + 1);
    };

    vm.getLaunchableUserDesigns = function() {
        return vm.userDesigns.filter((design) => design.valid === true);
    };

    vm.getFilteredLaunchableUserDesigns = function() {
        return vm.getLaunchableUserDesigns().filter(vm.designMatchesSearch);
    };

    vm.getLaunchableTotalPages = function() {
        return Math.max(1, Math.ceil(vm.getFilteredLaunchableUserDesigns().length / vm.pageSize));
    };

    vm.getPaginatedLaunchableUserDesigns = function() {
        const startIndex = (vm.currentPage - 1) * vm.pageSize;
        return vm.getFilteredLaunchableUserDesigns().slice(startIndex, startIndex + vm.pageSize);
    };

    vm.setLaunchablePage = function(pageNumber) {
        const nextPage = Number(pageNumber);
        if (!Number.isInteger(nextPage)) {
            return;
        }

        vm.currentPage = Math.min(Math.max(nextPage, 1), vm.getLaunchableTotalPages());
    };

    vm.previousLaunchablePage = function() {
        vm.setLaunchablePage(vm.currentPage - 1);
    };

    vm.nextLaunchablePage = function() {
        vm.setLaunchablePage(vm.currentPage + 1);
    };

    vm.searchUserDesigns = function(searchText) {
        const query = (searchText || "").toLowerCase().trim();
        if (query.length < 1) {
            return vm.userDesigns.slice(0, 8);
        }

        return vm.userDesigns
            .filter((design) => vm.formatDesignLabel(design).toLowerCase().includes(query))
            .slice(0, 8);
    };

    vm.searchLaunchableUserDesigns = function(searchText) {
        const launchableDesigns = vm.getLaunchableUserDesigns();
        const query = (searchText || "").toLowerCase().trim();
        if (query.length < 1) {
            return launchableDesigns.slice(0, 8);
        }

        return launchableDesigns
            .filter((design) => vm.formatDesignLabel(design).toLowerCase().includes(query))
            .slice(0, 8);
    };

    vm.formatDesignLabel = function(design) {
        return design?.metainfo?.title || "";
    };

    vm.handleDesignSearchChange = function() {
        vm.userSearch = vm.designSearchQuery || "";
        vm.setPage(1);
    };

    vm.selectDesignFromSearch = function(design) {
        if (!design) {
            return;
        }

        vm.selectedDesignId = design.id;
        vm.designSearchQuery = vm.formatDesignLabel(design);
        vm.userSearch = vm.designSearchQuery;
        vm.scrollToActivitySetup();
    };

    vm.handleLaunch = function(designId) {
        $scope.navigateTo('/activities/new/' + designId);
    };

    vm.handleEdit = function(designId) {
        $scope.navigateTo('/designs/' + designId + '/edit');
    };

    vm.handleView = function(designId) {
        $scope.navigateTo('/designs/' + designId);
    };

    vm.getPublicDesigns = async function() {
        vm.publicDesigns = await DesignCatalogService.getPublicDesigns();
        vm.setPage(vm.currentPage);
        $scope.$applyAsync();
    };
    
    vm.deleteDesign = async function(id) {
        await DesignCatalogService.deleteDesign(id);
    };

    vm.archiveDesign = async function(id) {
        const design = await DesignCatalogService.getDesignById(id);
        const nextArchived = design?.archived !== true;
        try {
            await DesignCatalogService.updateDesignArchived(id, nextArchived);
            vm.showDesignToast(nextArchived ? "design_archive_success" : "design_unarchive_success");
            if (!nextArchived) {
                vm.dsgnMode = 0;
            }
        } catch (error) {
            console.error("[BrowseDesignsController::archiveDesign] Error updating archived status.", error);
            vm.showDesignToast("design_archive_error", "alert-danger");
        }
    };

    vm.duplicateDesign = async function(id) {
        await DesignCatalogService.duplicateDesign(id);
    };

    vm.importDesign = async function(id) {
        try {
            await DesignCatalogService.importDesign(id);
            
            $scope.$applyAsync(() => {
                $translate("design_imported_text").then((result) => {
                    toast.create({
                        timeout: 100 * 1000,
                        message: result,
                        containerClass: 'designs-toast-container',
                        dismissible: false,
                        defaultToastClass: 'toast',
                        insertFromTop: true,
                    });
                });
            });
        } catch (error) {
            const messageKey = error?.data?.code === "DESIGN_CASE_NOT_IMPORTABLE"
                ? "design_import_blocked_by_case"
                : "design_import_error";
            vm.showDesignToast(messageKey, "alert-danger");
        }
    };
    
    vm.getDesign = async function(id) {
        const design = await DesignCatalogService.getDesignById(id);
        ActivityStateService.setDesign(id, design);
    };

    vm.filterById = function(design) {
        return vm.selectedDesign && design.id === vm.selectedDesign.id;
    };

    vm.init();
};
