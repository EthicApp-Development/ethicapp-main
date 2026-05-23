const TagSelectorController = function(TagCatalogService) {
    const vm = this;
    const maxTags = 5;

    vm.$onInit = function() {
        vm.selectedTags = Array.isArray(vm.selectedTags) ? vm.selectedTags : [];
        vm.searchText = "";
        vm.suggestions = [];
        vm.isSearching = false;
    };

    vm.$onChanges = function() {
        vm.selectedTags = Array.isArray(vm.selectedTags) ? vm.selectedTags : [];
    };

    vm.getMaxTags = function() {
        return maxTags;
    };

    vm.isReadonly = function() {
        return vm.readonly === true;
    };

    vm.canAddMoreTags = function() {
        return vm.selectedTags.length < maxTags;
    };

    vm.isTagSelected = function(tag) {
        return vm.selectedTags.some((selectedTag) => Number(selectedTag.id) === Number(tag.id));
    };

    vm.searchTags = async function() {
        if (vm.isReadonly() || !vm.canAddMoreTags()) {
            vm.suggestions = [];
            return;
        }

        const query = String(vm.searchText || "").trim();
        if (query.length < 2) {
            vm.suggestions = [];
            return;
        }

        vm.isSearching = true;
        try {
            const tags = await TagCatalogService.searchTags(query, vm.scope || "case");
            vm.suggestions = tags.filter((tag) => !vm.isTagSelected(tag));
        } catch (error) {
            console.error("[TagSelectorController::searchTags] Could not search tags.", error);
            vm.suggestions = [];
        } finally {
            vm.isSearching = false;
        }
    };

    vm.addTag = function(tag) {
        if (vm.isReadonly() || !tag || !vm.canAddMoreTags() || vm.isTagSelected(tag)) {
            return;
        }

        vm.selectedTags.push(tag);
        vm.searchText = "";
        vm.suggestions = [];
    };

    vm.removeTag = function(tag) {
        if (vm.isReadonly()) {
            return;
        }

        const index = vm.selectedTags.findIndex((selectedTag) => Number(selectedTag.id) === Number(tag.id));
        if (index >= 0) {
            vm.selectedTags.splice(index, 1);
        }
    };
};

const tagSelectorComponent = {
    bindings: {
        selectedTags: "=",
        scope: "@",
        readonly: "<",
    },
    controller: ["TagCatalogService", TagSelectorController],
    templateUrl: "/assets/static/views/teacher/fragments/tag-selector.template.html",
};

export default tagSelectorComponent;
