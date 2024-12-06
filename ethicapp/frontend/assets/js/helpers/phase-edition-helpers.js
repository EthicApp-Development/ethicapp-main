import { getDesignType } from "./design-helpers.js";

// Fases y acciones de construcción
const phaseBuilders = {
    semantic_differential: genericPhaseBuilder,
    ranking: genericPhaseBuilder,
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

// Funciones auxiliares
function removeSDItemFromPhase(phase, item) {
    phase.questions = phase.questions.filter((_item) => _item !== item);
}

function removeRankingItemFromPhase(phase, item) {
    phase.roles = phase.roles.filter((_item) => _item !== item);
}

function genericPhaseBuilder(params = {}) {
    const phaseObj = {
        mode: params.mode ?? "individual",
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
        wc: params.wc ?? 5,
        name: params.name ?? "",
        type: params.type,
    };
}

const designEditActions = {
    buildBlankPhase: (design) => {
        const builder = phaseBuilders[getDesignType(design)];
        const blankPhase = builder();
        initPhase(blankPhase); // add basic fields
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
            phase.anonymous = phase.anonymous || true;
            phase.chat = phase.chat || true;
            phase.grouping_algorithm = phase.grouping_algorithm || 'random';
        } else {
            delete phase.anonymous;
            delete phase.chat;
            delete phase.grouping_algorithm;
        }
    },
    initPhase: (phase) => {
        phase.anonymous = phase.anonymous || false;
        phase.chat = phase.chat || false;
        phase.grouping_algorithm = phase.grouping_algorithm || null;
    }
};

export default designEditActions;
