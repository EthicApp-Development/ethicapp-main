export let isGroupPhaseByDesign = function(design, phaseNumber) {
    return design.phases[phaseNumber-1].mode === "team";
}

export let isGroupPhaseByPhaseDescriptor = function(phaseDescriptor) {
    return phaseDescriptor.mode == "team";
}

export let getDesignType = function(design) {
    return design.type;
}

export let getPhaseByIndex = function(design, phaseIndex) {
    return design.phases[phaseIndex];
}