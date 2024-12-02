window.DIC = null;
window.warnDIC = {};

function LangFilter() {
    filt.$stateful = true;
    return filt;

    function filt(label) {
        if (window.DIC == null) return;
        if (window.DIC[label]) return window.DIC[label];
        if (!window.warnDIC[label]) {
            console.warn("Cannot find translation for ", label);
            window.warnDIC[label] = true;
        }
        return label;
    }
};

export { LangFilter };