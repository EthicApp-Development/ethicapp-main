// The page of a teacher with no activities yet (#1053, epic #1046), on the
// Activities page and the teacher's home (#1098, epic #1093): whether it
// shows step 1, "Prepara un diseño", before "Lanza la actividad".
//
// Step 1 is left out when the teacher already has a design the launch wizard
// would list (`launchableDesigns`: their own, not archived, without errors),
// and kept when the designs cannot be loaded. Like the wizard, the designs
// are loaded again: a design edited since the last load may have become
// ready. Callers ask only for a teacher with no activities, so a teacher with
// activities makes no request for designs.

import { launchableDesigns } from "./launch-design-list.js";

/**
 * Whether the empty page shows the design step.
 * @param {{
 *   loadDesigns: () => Promise<boolean>,
 *   getDesigns: () => Promise<object[]>,
 * }} designCatalog the teacher's DesignCatalogService
 * @returns {Promise<boolean>}
 */
export async function designStepNeeded(designCatalog) {
    try {
        const loaded = await designCatalog.loadDesigns();
        const designs = loaded ? await designCatalog.getDesigns() : [];
        return launchableDesigns(designs).length === 0;
    } catch (error) {
        console.error("[designStepNeeded] Could not load the designs.", error);
        return true;
    }
}
