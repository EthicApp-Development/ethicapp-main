// How the teacher UI titles an activity (#973, epic #965): its name, the
// design's title, followed by its description, so activities launched from
// the same design can be told apart. "Privacidad en apps de salud · Ética
// Profesional · Sección 3". An activity without a description, as older ones
// may be, is titled by its name alone. The dashboard's activity bar, the
// activity cards and the dashboard's browser tab all use it.

export const ACTIVITY_TITLE_SEPARATOR = " · ";

// What separates the activity's title from the page's own title in the
// browser tab.
export const DOCUMENT_TITLE_SEPARATOR = " – ";

function cleanText(value) {
    return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

// The two parts of an activity's title, trimmed and on one line: `name` and
// `description`, each "" when missing.
export function activityTitleParts(activity) {
    return {
        name:        cleanText(activity?.name),
        description: cleanText(activity?.description),
    };
}

// The activity's title as one line of text: "<name> · <description>", the
// name alone without a description, the description alone without a name,
// or "" without either.
export function activityTitleText(activity) {
    const { name, description } = activityTitleParts(activity);
    return [name, description].filter(Boolean).join(ACTIVITY_TITLE_SEPARATOR);
}

// The browser tab's title for the activity's page: the activity's title
// before the page's own title (`baseTitle`), or `baseTitle` alone while the
// activity has none.
export function activityDocumentTitle(activity, baseTitle = "") {
    const title = activityTitleText(activity);
    const base = cleanText(baseTitle);
    return [title, base].filter(Boolean).join(DOCUMENT_TITLE_SEPARATOR);
}

// Keeps the browser tab titled by an activity while its page is open:
// `show(activity)` titles it, `restore()` puts back the title the document
// had when the keeper was made and ignores any later `show`, as when the
// activity loads after the teacher left its page. `doc` may be missing.
export function activityDocumentTitleKeeper(doc) {
    const original = typeof doc?.title === "string" ? doc.title : null;
    let restored = false;

    return {
        show(activity) {
            if (original === null || restored) {
                return;
            }
            doc.title = activityDocumentTitle(activity, original);
        },
        restore() {
            if (restored) {
                return;
            }
            restored = true;
            if (original !== null) {
                doc.title = original;
            }
        },
    };
}
