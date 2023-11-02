export let getSDItemAPIObject = (question, number, stageId, sessionId) => {
    var content = question.ans_format;
    return {
        name:       question.q_text,
        tleft:      content.l_pole,
        tright:     content.r_pole,
        num:        content.values,
        orden:      number,
        justify:    content.just_required,
        stageid:    stageId,
        sesid:      sessionId,
        word_count: content.min_just_length
    };
};