export let isGroupPhase = function(design, phaseNumber) {
    return design.phases[phaseNumber-1].mode === "team";
}
