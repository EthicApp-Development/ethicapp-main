self.cleanEmptyValues = (phase) => {
    phase.questions.map(question => {
        question.q_text = question.q_text === "-->>N/A<<--" ? "" : question.q_text;
        question.ans_format.l_pole = question.ans_format.l_pole === "-->>N/A<<--" ? 
            "" : question.ans_format.l_pole;
        question.ans_format.r_pole = question.ans_format.r_pole === "-->>N/A<<--" ? 
            "" : question.ans_format.r_pole;
    });
};

self.createErrorList = (phase) => {
    let questionsErrorList = [];
    let questions = phase.questions;

    questions.map((question) => {
        let questionErrors = {};
        questionErrors = {
            q: question.q_text == "",
            l: question.ans_format.l_pole == "",
            r: question.ans_format.r_pole == ""
        };
        questionsErrorList.push(questionErrors);                    
    });
    return questionsErrorList;
};

self.validatePhase = (phase, errorList) => {
    const errors = self.errorList[phase];
    let error = false;
    errors.map((_error, index) => {
        const errorValues = Object.values(errorList[phase][index]);
        const errorResult = errorValues.some(value => value === true);
        error = errorResult; // boolean value
    });
    return error;
};

self.isEmpty = (value, type) => {
    const _isEmpty = value === "";
    const phase = self.currentStage;
    const question  = self.currentQuestion;
    if(type !== "") {
        self.errorList[phase][question][type] = _isEmpty;
    }
    return _isEmpty;
};

self.validatePhaseDesign = (phase) => { 
    let questions = phase.questions;
    let error = false;
    questions.map((question) => {
        error = question.q_text == "";
        error = question.ans_format.l_pole == "";
        error = question.ans_format.r_pole == "";
        error = question.ans_format.min_just_length < 0;
    });
    return error;
};

