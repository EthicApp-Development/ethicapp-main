export const isPhaseValid = function(phaseErrors) {    
    const itemsValid = !phaseErrors.items || Object.keys(phaseErrors.items).items == 0;
    const groupConfigValid = !phaseErrors.groupingConfig || phaseErrors.groupingConfig.length == 0;
    const instructionsConfigValid = !phaseErrors.phaseInstructions || phaseErrors.phaseInstructions.length == 0;
    const otherConfigValid = !phaseErrors.other || phaseErrors.other.length == 0;

    return itemsValid && groupConfigValid && instructionsConfigValid && otherConfigValid;
}
