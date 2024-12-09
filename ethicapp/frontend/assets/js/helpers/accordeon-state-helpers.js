const accordionStateHelpers = (function () {
    const helper = {};

    // Removes the accordion state at a specific index
    helper.removeAccordionState = function (accordionState, index) {
        if (accordionState.hasOwnProperty(index)) {
            delete accordionState[index];
            console.log(`[removeAccordionState] Removed state at index ${index}`);
        } else {
            console.warn(`[removeAccordionState] No state exists at index ${index}`);
        }
    };

    // Inserts a new accordion state at a specific index
    helper.insertAccordionState = function (accordionState, index, state) {
        accordionState[index] = state;
        console.log(`[insertAccordionState] Inserted state at index ${index}:`, state);
    };

    // Moves an accordion state up, swapping with the previous one
    helper.moveAccordionStateUp = function (accordionState, sourceIndex) {
        if (sourceIndex > 0 && accordionState.hasOwnProperty(sourceIndex)) {
            const targetIndex = sourceIndex - 1;

            // Swap states
            const temp = accordionState[sourceIndex];
            accordionState[sourceIndex] = accordionState[targetIndex];
            accordionState[targetIndex] = temp;

            console.log(`[moveAccordionStateUp] Moved state from index ${sourceIndex} to ${targetIndex}`);
        } else {
            console.warn(`[moveAccordionStateUp] Cannot move up from index ${sourceIndex}`);
        }
    };

    // Moves an accordion state down, swapping with the next one
    helper.moveAccordionStateDown = function (accordionState, sourceIndex) {
        if (
            accordionState.hasOwnProperty(sourceIndex) &&
            accordionState.hasOwnProperty(sourceIndex + 1)
        ) {
            const targetIndex = sourceIndex + 1;

            // Swap states
            const temp = accordionState[sourceIndex];
            accordionState[sourceIndex] = accordionState[targetIndex];
            accordionState[targetIndex] = temp;

            console.log(`[moveAccordionStateDown] Moved state from index ${sourceIndex} to ${targetIndex}`);
        } else {
            console.warn(`[moveAccordionStateDown] Cannot move down from index ${sourceIndex}`);
        }
    };

    return helper;
})();

export default accordionStateHelpers;
