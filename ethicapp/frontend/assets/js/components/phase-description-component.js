let phaseDescriptionComponent = {
    bindings: {
        phase: '<',
    },
    // TODO: Choose the template depending on the phase type
    template: `
    <ul class="list-group">
        <li class="list-group-item"><i class="fa-solid fa-user"></i> <strong>Mode:</strong> Individual</li>
        <li class="list-group-item"><i class="fa-solid fa-question"></i> <strong>Question:</strong> How many fingers in one hand?</li>
        <li class="list-group-item"><i class="fa-solid fa-file-signature"></i> <strong>Justification required:</strong> yes</li>
    </ul>
    `
};

export { phaseDescriptionComponent };