import { getDesignType } from "./design-helpers.js";

const phaseBuilders = {
    semantic_differential: genericPhaseBuilder,
    ranking: () => { 
        genericPhaseBuilder({ roles: [ ], randomize_item_order: false }) 
    },
};

const itemBuilders = {
    semantic_differential: sdItemBuilder,
    ranking: rankingItemBuilder,
};

const itemRemovers = {
    semantic_differential: removeSDItemFromPhase,
    ranking: removeRankingItemFromPhase,
};

const itemAdders = {
    semantic_differential: (phase, item) => {
        if (!phase.questions) {
            phase.questions = [];
        }
        phase.questions.push(item);
    },
    ranking: (phase, item) => {
        if (!phase.roles) {
            phase.roles = [];
        }
        phase.roles.push(item);
    },
};

function removeSDItemFromPhase(phase, item) {
    phase.questions = phase.questions.filter((_item) => _item !== item);
}

function removeRankingItemFromPhase(phase, item) {
    phase.roles = phase.roles.filter((_item) => _item !== item);
}

function genericPhaseBuilder(params = {}) {
    const phaseObj = {
        mode: params.mode ?? "individual",
        prevPhasesResponse: params.prevPhasesResponse ?? [],
        ...params,
    };
    return phaseObj;
}

function sdItemBuilder(params = {}) {
    return {
        q_text: params.q_text ?? "",
        ans_format: {
            l_pole: params.ans_format?.l_pole ?? "",
            r_pole: params.ans_format?.r_pole ?? "",
            values: params.ans_format?.values ?? 7,
            just_required: params.ans_format?.just_required ?? false,
            min_just_length: params.ans_format?.min_just_length ?? 0,
        },
    };
}

function rankingItemBuilder(params = {}) {
    return {
        justification_required: false,
        justification_minimum_length_required: false,
        wc: params.wc ?? 5,
        name: params.name ?? "",
        type: params.type,
    };
}

const designEditActions = {
    buildBlankPhase: function(design) {
        const builder = phaseBuilders[getDesignType(design)];
        const blankPhase = builder();
        this.initPhase(blankPhase);
        return blankPhase;
    },
    addPhase: (design, phase) => {
        if (!design.phases) {
            design.phases = [];
        }
        design.phases.push(phase);
    },
    removePhase: (design, phase) => {
        design.phases = design.phases.filter((_phase) => _phase !== phase);
    },
    buildBlankItem: (design) => {
        const builder = itemBuilders[getDesignType(design)];
        return builder();
    },
    addPhaseItem: (design, phase, item) => {
        const itemAdder = itemAdders[getDesignType(design)];
        itemAdder(phase, item);
    },
    removeItem: (design, phase, item) => {
        const remover = itemRemovers[getDesignType(design)];
        remover(phase, item);
    },
    clonePhaseByIndex: (design, phaseIndex) => {
        const phaseClone = structuredClone(design.phases[phaseIndex]);
        design.phases.splice(phaseIndex+1, 0, phaseClone);
    },
    updatePhaseType: (phase) => {
        if (phase.mode == 'team') {
            phase.stdntAmount = phase.stdntAmount || 3;
            phase.anonymous = true;
            phase.chat = true;
            phase.grouping_algorithm = phase.grouping_algorithm || 'random';
        } else {
            delete phase.anonymous;
            delete phase.chat;
            delete phase.grouping_algorithm;
            delete phase.stdntAmount;
        }
    },
    initPhase: (phase) => {
        phase.anonymous = true;
        phase.chat = true;
        phase.grouping_algorithm = phase.grouping_algorithm || null;
        phase.stdntAmount = phase.stdntAmount || 3;
    }
};

export default designEditActions;
