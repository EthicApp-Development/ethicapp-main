// Publishing a case cannot be fully undone (#939, epic #923): every teacher who
// uses a public case in a design keeps reading it, with its document and its
// pages, after its author makes it private again. So the case form, on the new
// and the edit page, and the share switch ask the author to confirm before a
// case becomes public.

const PUBLIC_VISIBILITY = "public";

/**
 * Whether a save makes a case public that was not public before. A new case
 * has no previous visibility.
 * @param {string|null|undefined} previousVisibility
 * @param {string|null|undefined} nextVisibility
 * @returns {boolean}
 */
export function isCasePublication(previousVisibility, nextVisibility) {
    return nextVisibility === PUBLIC_VISIBILITY && previousVisibility !== PUBLIC_VISIBILITY;
}

/**
 * Asks the author to confirm a publication, and only a publication: any other
 * change goes ahead without asking. Only an explicit confirmation lets the
 * publication go ahead; a cancelled or failed dialog stops it.
 * @param {string|null|undefined} previousVisibility
 * @param {string|null|undefined} nextVisibility
 * @param {() => Promise<boolean>} confirm - Opens the dialog.
 * @returns {Promise<boolean>} Whether the save may go ahead.
 */
export async function confirmCasePublication(previousVisibility, nextVisibility, confirm) {
    if (!isCasePublication(previousVisibility, nextVisibility)) {
        return true;
    }

    try {
        return (await confirm()) === true;
    } catch (error) {
        console.error("[confirmCasePublication] The confirmation dialog failed.", error);
        return false;
    }
}
