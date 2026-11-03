// Translations for text-only sinks, such as the teacher toast, which renders
// its message with `ng-bind`.
//
// The teacher app's sanitize strategy (`sanitizeParameters`, teacher-admin.mjs)
// HTML-encodes interpolation parameters. That suits `ng-bind-html`, but a text
// sink shows the entities as they are, for example `An&#225;lisis de prueba`.
// Passing `null` as the per-call strategy of `$translate.instant` keeps the
// parameters as given. The sink renders the whole message as text, so a case
// title or an analysis name cannot inject HTML. Never bind the result as HTML.

export function translatePlainText($translate, key, params) {
    return $translate.instant(key, params, undefined, undefined, null);
}
