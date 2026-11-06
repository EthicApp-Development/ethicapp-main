// The mock review of a student response as a `student-result/v1` document
// (ethicapp-main #1134, epic #1124). It uses every section kind of the
// contract (criteria with descriptions, bullets, text and a comparison) and an
// overview, so the student app's generic renderer can be checked without an
// AI service. The review only counts the words and characters of the text and
// writes it backwards.
//
// The schema lives in ethicapp-ai-additions; EthicApp keeps a copy in
// canonical-schemas/ai-additions/ and refuses a document that does not
// validate against it.

export const DOCUMENT_SCHEMA = "student-result/v1";
export const LOCALES = Object.freeze(["es-CL", "en-US"]);
export const DEFAULT_LOCALE = "es-CL";

// A section kind that student-result/v1 does not define.
export const UNKNOWN_SECTION_KIND = "mock-future-kind";

// A response of this many words fills the meter of the words criterion.
const WORDS_FOR_FULL_SCORE = 80;

// Limits of the schema, in characters.
const TEXT_MAX_LENGTH = 10000;
const COMPARISON_MAX_LENGTH = 500;
const OPENING_LENGTH = 60;

const TEXTS = {
    "es-CL": {
        title:    "Revisión de prueba de tu respuesta",
        summary:  "Esta revisión es de prueba: cuenta las palabras y caracteres de tu respuesta y la escribe al revés.",
        empty:    "No escribiste texto en tu respuesta, así que no hay nada que revisar.",
        overview: "Esta es una revisión de **prueba** para el desarrollo de EthicApp. No evalúa tu argumento:\n\n"
            + "- cuenta las *palabras* y los *caracteres* de tu respuesta;\n"
            + "- escribe tu texto al revés.\n\n"
            + "Abre cada criterio para ver qué mide.",
        criteriaTitle: "Criterios",
        words:         {
            label:       "Palabras",
            value:       count => `${count} ${count === 1 ? "palabra" : "palabras"}`,
            description: "Cuenta las **palabras** de tu respuesta, separadas por espacios.\n\n"
                + `El medidor se llena con *${WORDS_FOR_FULL_SCORE} palabras* o más.`,
        },
        characters: {
            label:       "Caracteres",
            value:       count => `${count} ${count === 1 ? "carácter" : "caracteres"}`,
            description: "Cuenta los **caracteres** de tu respuesta, espacios incluidos.",
        },
        justification: {
            label:       "Justificación escrita",
            present:     "Presente",
            missing:     "Ausente",
            description: "Indica si escribiste una justificación.\n\n"
                + "Una revisión real la leería; esta solo comprueba que *exista*.",
        },
        bulletsTitle: "Sugerencias",
        bullets:      count => [
            `Tu respuesta tiene ${count} ${count === 1 ? "palabra" : "palabras"}.`,
            "Revisa si tu justificación enuncia un criterio ético claro.",
        ],
        bulletsEmpty:   ["Escribe una justificación para que pueda revisarse."],
        textTitle:      "Tu respuesta al revés",
        unknownSection: "Esta sección es de un tipo que la aplicación no conoce y no debe mostrarse.",
        comparison:     {
            title:      "Tu texto, al derecho y al revés",
            words:      "Palabras",
            characters: "Caracteres",
            opening:    "Comienzo",
        },
    },
    "en-US": {
        title:    "Mock review of your response",
        summary:  "This is a mock review: it counts the words and characters of your response and writes it backwards.",
        empty:    "Your response has no text, so there is nothing to review.",
        overview: "This is a **mock** review for EthicApp development. It does not evaluate your argument:\n\n"
            + "- it counts the *words* and *characters* of your response;\n"
            + "- it writes your text backwards.\n\n"
            + "Open each criterion to see what it measures.",
        criteriaTitle: "Criteria",
        words:         {
            label:       "Words",
            value:       count => `${count} ${count === 1 ? "word" : "words"}`,
            description: "Counts the **words** of your response, separated by spaces.\n\n"
                + `The meter fills at *${WORDS_FOR_FULL_SCORE} words* or more.`,
        },
        characters: {
            label:       "Characters",
            value:       count => `${count} ${count === 1 ? "character" : "characters"}`,
            description: "Counts the **characters** of your response, spaces included.",
        },
        justification: {
            label:       "Written justification",
            present:     "Present",
            missing:     "Missing",
            description: "Whether you wrote a justification.\n\n"
                + "A real review would read it; this one only checks that it *exists*.",
        },
        bulletsTitle: "Suggestions",
        bullets:      count => [
            `Your response has ${count} ${count === 1 ? "word" : "words"}.`,
            "Check whether your justification states a clear ethical criterion.",
        ],
        bulletsEmpty:   ["Write a justification so it can be reviewed."],
        textTitle:      "Your response backwards",
        unknownSection: "This section is of a kind the app does not know and must not be shown.",
        comparison:     {
            title:      "Your text, forwards and backwards",
            words:      "Words",
            characters: "Characters",
            opening:    "Opening",
        },
    },
};

/** `locale` when it is a locale of the contract, the default otherwise. */
export function documentLocale(locale) {
    return LOCALES.includes(locale) ? locale : DEFAULT_LOCALE;
}

// At most `length` characters (code points, as JSON Schema counts them).
function truncate(text, length) {
    const characters = Array.from(text);
    return characters.length > length ? characters.slice(0, length).join("") : text;
}

function reverse(text) {
    return Array.from(text).reverse().join("");
}

/**
 * Reviews `text` and returns the review: the document and the counts.
 *
 * @param {Object} options
 * @param {string} options.text - The student's response, possibly empty.
 * @param {string} [options.locale] - `es-CL` or `en-US`; others fall back to
 *     DEFAULT_LOCALE.
 * @returns {{ document: Object, analysis: { wordCount: number, characterCount: number } }}
 */
export function buildMockReview({ text, locale }) {
    const responseText = typeof text === "string" ? text.trim() : "";
    const documentLanguage = documentLocale(locale);
    const t = TEXTS[documentLanguage];
    const wordCount = responseText ? responseText.split(/\s+/u).length : 0;
    const characterCount = Array.from(responseText).length;
    const analysis = { wordCount, characterCount };

    const document = {
        schemaVersion: DOCUMENT_SCHEMA,
        locale:        documentLanguage,
        title:         t.title,
        summary:       responseText ? t.summary : t.empty,
        overview:      t.overview,
        sections:      [
            {
                kind:  "criteria",
                title: t.criteriaTitle,
                items: [
                    {
                        key:         "words",
                        label:       t.words.label,
                        value:       t.words.value(wordCount),
                        score:       Math.min(wordCount, WORDS_FOR_FULL_SCORE),
                        minScore:    0,
                        maxScore:    WORDS_FOR_FULL_SCORE,
                        description: t.words.description,
                    },
                    {
                        key:         "characters",
                        label:       t.characters.label,
                        value:       t.characters.value(characterCount),
                        description: t.characters.description,
                    },
                    {
                        key:         "justification",
                        label:       t.justification.label,
                        value:       responseText ? t.justification.present : t.justification.missing,
                        description: t.justification.description,
                    },
                ],
            },
            {
                kind:  "bullets",
                title: t.bulletsTitle,
                items: responseText ? t.bullets(wordCount) : t.bulletsEmpty,
            },
            // A kind v1 does not define: the schema accepts it and renderers
            // skip it, which the student app is expected to do (epic #1124,
            // smoke test item 6).
            { kind: UNKNOWN_SECTION_KIND, items: [t.unknownSection] },
        ],
    };

    if (!responseText) {
        return { document, analysis };
    }

    const opening = truncate(responseText, OPENING_LENGTH);
    document.sections.push(
        {
            kind:  "text",
            title: t.textTitle,
            text:  truncate(reverse(responseText), TEXT_MAX_LENGTH),
        },
        {
            kind:  "comparison",
            title: t.comparison.title,
            items: [
                {
                    key:    "words",
                    label:  t.comparison.words,
                    before: String(wordCount),
                    after:  String(wordCount),
                    trend:  "unchanged",
                },
                {
                    key:    "characters",
                    label:  t.comparison.characters,
                    before: String(characterCount),
                    after:  String(characterCount),
                    trend:  "unchanged",
                },
                {
                    label:  t.comparison.opening,
                    before: truncate(opening, COMPARISON_MAX_LENGTH),
                    after:  truncate(reverse(opening), COMPARISON_MAX_LENGTH),
                },
            ],
        }
    );
    return { document, analysis };
}
