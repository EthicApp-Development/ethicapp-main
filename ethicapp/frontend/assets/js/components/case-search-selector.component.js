function CaseSearchSelectorController(CasesCatalogService) {
    const vm = this;

    vm.$onInit = function() {
        vm.selectedCaseLabel = vm.formatCaseLabel(vm.associatedCase);
    };

    vm.$onChanges = function(changes) {
        if (changes.associatedCase) {
            vm.selectedCaseLabel = vm.formatCaseLabel(vm.associatedCase);
        }
    };

    vm.searchCases = async function(query) {
        return CasesCatalogService.searchCases(query);
    };

    vm.selectCase = function(caseItem) {
        vm.associatedCase = caseItem || null;
        vm.selectedCaseLabel = vm.formatCaseLabel(caseItem);

        if (typeof vm.onSelect === "function") {
            vm.onSelect({ caseItem });
        }
    };

    vm.clearCase = function() {
        vm.associatedCase = null;
        vm.selectedCaseLabel = "";

        if (typeof vm.onClear === "function") {
            vm.onClear();
        }
    };

    vm.formatCaseLabel = function(caseItem) {
        if (!caseItem) {
            return "";
        }

        const hasAuthor = caseItem.authorFirstname || caseItem.authorLastname;
        if (hasAuthor) {
            return `${caseItem.title} (${caseItem.authorFirstname || ""} ${caseItem.authorLastname || ""})`.trim();
        }

        return caseItem.title;
    };
}

const caseSearchSelectorComponent = {
    bindings: {
        associatedCase: "<",
        onSelect:       "&",
        onClear:        "&",
    },
    controller: ["CasesCatalogService", CaseSearchSelectorController],
    templateUrl: "/assets/static/views/teacher/fragments/case-search-selector.template.html",
};

export default caseSearchSelectorComponent;
