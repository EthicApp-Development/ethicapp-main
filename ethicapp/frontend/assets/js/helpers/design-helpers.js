export let isGroupPhaseByDesign = function(design, phaseNumber) {
    return design.phases[phaseNumber-1].mode === "team";
}

export let isGroupPhaseByPhaseDescriptor = function(phaseDescriptor) {
    return phaseDescriptor.mode == "team";
}