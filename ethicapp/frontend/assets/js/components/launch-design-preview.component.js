// The preview of the design chosen in the launch wizard's first step (#971,
// epic #965): its phases with their mode, groups, chat, questions and AI
// services, its case, and when it was created and last launched. From 1200 px
// it is a panel next to the list; below, it fills the selected row (`inline`).
// "View case" and "View full design" open in a new tab, so the wizard keeps
// its state.
//
// `preview` is built by LaunchActivityWizardController.refreshPreview().

const launchDesignPreviewComponent = {
    bindings: {
        preview: "<",
        inline:  "<?",
    },
    templateUrl: "/assets/static/views/teacher/fragments/launch-design-preview.template.html",
};

export default launchDesignPreviewComponent;
