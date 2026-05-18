import { designFactories } from  "../../../../../common/modules/design-types.js";

/*eslint func-style: ["error", "expression"]*/
export function CreateDesignController($scope,
    DesignCatalogService, UserInformationService) {
    const vm = this;

    vm.uploadDesign = async function (title, type) {
        try {
            const factory = designFactories[type];
            if (!factory) {
                throw Error("Unsupported design type!");
            }
            
            const userInformation = await UserInformationService.getUserInformation();
            const design = factory(title, userInformation.name);
            
            design.metainfo.institution = userInformation.institution_name || "";
            design.metainfo.email = userInformation.email;

            const designId = await DesignCatalogService.createDesign(design);

            if (!designId) {
                throw Error("Could not create the new design.");
            }

            // Switch to the editor view
            $scope.navigateTo(`/designs/${designId}/edit`);
        } catch (error) {
            // Log and handle any errors encountered during the HTTP request or response processing
            console.error("Error uploading design:", error.message || error);
        }
    };
};
