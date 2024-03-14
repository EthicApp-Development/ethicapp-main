self.cleanEmptyValues = (phase) => {
    phase.q_text = phase.q_text === "-->>N/A<<--" ? "" : phase.q_text;
    phase.roles.map(role => {
        role.name = role.name === "-->>N/A<<--" ? "" : role.name;
    });
};

self.createErrorList = (phase) => {
    let rolesErrorList = [];
    phase.roles.map(role => {
        rolesErrorList.push(role.name == "");
    });
    return rolesErrorList;
};

self.validatePhase = (phase, errorList) => {
    const errors = errorList[phase];
    let error = phase.q_text == "";
    errors.map((_error, index) => {
        error = self.errorList[phase][index];
    });
    return error;
};

self.isEmpty = (errorList, phaseIndex, errorIndex, value) => {
    const _isEmpty = value==="";
    errorList[phaseIndex][errorIndex] = _isEmpty;
};

self.validatePhaseDesign = (phase) => {
    let roles = phase.roles;
    let error = phase.q_text == "";

    roles.map((role) => {
        error = role.name == "";
    });
    
    return error;
};