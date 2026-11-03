# Activities: list page proposal

This is a low-fidelity proposal for reorganizing the teacher's list of activities in legacy EthicApp: AngularJS, route `#!/activities`, template `ethicapp/frontend/assets/static/views/teacher/activity.index.html`, reached from "Actividades" in the side menu.

The page finds an activity again: before it starts, while it runs and after it ends. From it the teacher opens the activity's dashboard ([`../teacher-activity-dashboard`](../teacher-activity-dashboard/README.md)), hands out its access code, gets to its reports and archives it. Launching stays in "Lanzar actividad" ([`../launch-activity-wizard`](../launch-activity-wizard/README.md)). The proposal brings the page into the design language of Diseños ([`../designs-index`](../designs-index/README.md), epic #966) and Casos ([`../cases-index`](../cases-index/README.md), epic #1008): a role line, tabs with counts, a table with one status column and one visible action per row, a row menu and action notices.

Files:

- `wireframes.html` draws the frames at their real viewport size, with the fold marked and numbered notes. It has no dependencies; open it in a browser.
  - A shows "En curso" at 1920 × 1080, with a row menu open.
  - B shows "Terminadas" after archiving one, at 1366 × 768.
  - C shows the activities that have not started, at 1366 × 768.
  - D shows the page in one column at 1024 × 768.
  - E shows the page of a teacher with no activities, at 1366 × 768.
  - `wireframes.html?frame=A`, and likewise for B to E, renders one frame alone at its real size.
- `frames/` holds each frame rendered as a PNG (light theme).
- `current/` holds screenshots of today's page at 1920 × 1080, 1366 × 768 and 1024 × 768 (first screen and whole page), plus the "Terminadas" tab at 1366 × 768. They were taken on the local stack with the 71 activities of one teacher (`teacher-650`, as in the designs and cases proposals): 9 launched with no phase started, 44 with a phase in progress, 18 finished, none archived.

## The problem, measured

| Block, top to bottom | Top, in px |
| --- | --- |
| Title "Actividades", "Volver a la página anterior" | 120–190 |
| "Lanzar una actividad" | 223 |
| Search | 285 |
| Tabs "Actuales", "Terminadas", "Archivadas" | 337 |
| First activity card | 400 |

The page was measured with headless Chrome. The numbers are the same at 1920, 1366 and 1024 px wide, because the column does not grow.

**The cards.**
- Each card is 243 px tall, five per page: 11 pages for 53 current activities, 4 for 18 finished ones. Two cards fit on the first screen at 1920 × 1080, one at 1366 × 768.
- The heading is the activity's name and, after "·", the description given at launch (#973). Under it, five lines: "Estado actual", "Diseño usado" with the design's type ("Diferencial Semántico"), the case, "Código de acceso" and "Fecha de inicio" in UTC ("02-11-2026 18:01 (UTC)").
- The only button of a current activity is "Ver". A finished one adds "Archivar"; an archived one, "Desarchivar".

**What the page does not say.**
- Where a running activity stands: which phase, of how many, and whether it is a team or an individual phase. The dashboard's bar says it ("Fase 2 de 3 · Grupal"); the list says "En curso".
- How many students joined.
- Which current activities have not started. "Actuales" mixes the 9 launched activities with no phase started (status `initiated`) with the 44 that have one in progress, and both read "En curso" in green.
- Whether AI services are on (`sessions.ai_services_enabled`, V36).

**Finding an activity.**
- The search matches only `activity.title`, which `ActivityCatalogService` fills with the design's title (`activity-catalog.service.js:138`). The activity's name, its description, its case and its code are not searched.
- There is no status filter, and there are no counts on the tabs.

**Getting to the reports.** A finished activity's reports are two clicks away: "Ver", then "Reportes" in the dashboard's bar.

**Archiving.**
- "Archivar" removes the card without a notice and without undo.
- `PATCH /activities/:session_id/toggle_archived` (`ethicapp/backend/controllers/activities/activities-teacher.js:429`) flips the flag. Two requests, for example an undo sent twice, leave the activity as it was before the first, and the page cannot tell. The server also archives an activity in progress; only the page limits "Archivar" to finished ones.

**Leftovers.**
- "Lanzar una actividad" duplicates the side menu's "Lanzar Actividad" with a different label.
- The design's type contradicts the 2026-11-01 decision that designs are not told apart by type (#964).
- The empty "Actuales" tab of a new teacher is an alert with two links in one sentence.

## Proposal

### Page head (frame A)

- **Title:** "Actividades", as today.
- **A role line:** "Sigue tus actividades, comparte su código con los estudiantes y revisa sus reportes. ¿Necesitas otra propuesta? Prepara un diseño →". The link leads to Diseños, because "Lanzar actividad" is already the page action.
- **Page action:** "🚀 Lanzar actividad" (primary), with the side menu's label.
- "Volver a la página anterior" goes away.

### Tabs

- "En curso", "Terminadas" and "Archivadas", each with a count. "En curso" holds every activity that has not been finished, started or not.
- The tab and the filters are part of the URL (`#!/activities?tab=finished`, `#!/activities?status=not-started`). Coming back from the dashboard with the browser restores them.

### En curso (frames A, C, D)

**Filters**
- The search covers the activity's name and description, its design's title, its case's title and its access code.
- The status chips are "Todas", "Sin iniciar · n" and "Con fase en curso".
- The order is stated: "Más recientes primero", as the home's recent activities (#918).

**One row per activity**
- **Actividad:** the name and, after "·", the description. Under it, the case, and the design only when the activity was renamed at launch: by default the name is the design's title (`launch-activity-wizard`), and repeating it is noise. A click on the name opens the dashboard.
- **Estado:**
  - "○ Sin iniciar" while no phase has started;
  - "● Fase n de m · Grupal" or "· Individual", with the dashboard bar's words and keys (`activity_bar_phase_label`, `activity_bar_phase_mode_*`);
  - an "IA" mark when the activity's AI services are on.
- **Estudiantes:** how many students joined; "Nadie aún" when none has.
- **Código:** the access code, with a copy button.
- **Lanzada:** in the browser's time zone, relative when recent ("hoy, 18:01", "ayer, 09:05") and as a short date after that ("12 oct."). The full date and time show on hover.
- 12 rows fit on the first screen at 1920 × 1080, and 6 at 1366 × 768.

**Actions**
- "▶ Abrir panel" is the visible action: the dashboard.
- The "⋯" menu holds Copiar código, Reportes, Ver diseño and Ver caso.
- Ending an activity stays in the dashboard, behind its hold-to-confirm button. The list has no destructive action for a running activity.

**Not started (frame C)**
- The "Sin iniciar" filter lists the activities whose students can join and wait. Their code is what the teacher needs, and it is on the row.
- The footer says what these activities are: "Sus estudiantes pueden unirse y esperar a que inicies la fase 1."

### Terminadas (frame B)

- **Columns:** activity, status ("■ Finalizada", with the "IA" mark), students who took part, and when it ended. The code goes away.
- **Terminada** is the date and time the teacher ended the activity (`sessions.finished_at`, see Decisions), relative when recent. Activities finished before the migration have no end time and show "—", with the launch date on hover.
- **"📊 Reportes" is the visible action:** the reports page (`#!/activities/:id/reports`), one click instead of two.
- **The "⋯" menu** holds Abrir panel, Lanzar de nuevo (the wizard on the same design, `#!/activities/new/:designId`), Ver diseño and Archivar.
- **The footer** says what archiving does: it removes the activity from this list and keeps its reports. Students see a finished activity and an archived one the same way, so the notice says nothing about them.

### Archivadas

- The tab is not drawn. It uses the Terminadas table, with "Restaurar" as the visible action and Reportes, Abrir panel and Ver diseño in the menu.
- Only finished activities reach this tab. Restoring one returns it to Terminadas.

### A new teacher (frame E)

- Instead of today's one-sentence alert, two steps in the order a teacher follows them: "1. Prepara un diseño" with "+ Nuevo diseño", and "2. Lanza la actividad" with "🚀 Lanzar actividad".
- When the teacher already has designs ready to launch, the first step is left out.
- The Terminadas and Archivadas tabs keep a one-line empty message.

### Feedback

| Action | Notice | Links |
| --- | --- | --- |
| Copiar código | "Código copiado" | |
| Archivar | "Se archivó "<nombre · descripción>"" | "Deshacer", "Ver Archivadas" |
| Restaurar | "Se restauró "<nombre · descripción>"" | "Ver en Terminadas" |

Each notice disappears after a few seconds and can be dismissed. The page stays on the current tab.

### Widths

- **From 1200 px:** a table.
- **Below 1200 px (frame D):** the app's menu folds and the table becomes compact rows: name, description and case, with the launch date on the right; then status, students, code and the actions on a second line.

### Where today's pieces go

| Today | Proposal |
| --- | --- |
| "Volver a la página anterior" | Removed |
| "Lanzar una actividad" | "🚀 Lanzar actividad", top right, with the side menu's label |
| Search over the design's title | Search over name, description, design, case and code |
| Tabs "Actuales", "Terminadas", "Archivadas" | "En curso", "Terminadas", "Archivadas", with counts |
| 243 px `activity-description` card, 5 per page | Table row, "Mostrar más" |
| Heading: name · description | The Actividad column's title |
| "Estado actual: En curso" | "Sin iniciar" or "Fase n de m · Grupal", and the "IA" mark |
| "Diseño usado" with the design's type | The design in the meta line when the activity was renamed; no type |
| Case line | The meta line |
| "Código de acceso" | The Código column, with copy |
| "Fecha de inicio … (UTC)" | Lanzada, in the browser's time zone; Terminada for finished activities |
| "Ver" | "Abrir panel"; the name is a link too |
| "Archivar" without feedback | In the Terminadas menu, with a notice and undo |
| "Desarchivar" | "Restaurar" |
| The new-teacher alert | Two steps with their buttons |

## Implementation notes

**Controllers and components**
- `ActivityController` (`frontend/assets/js/controllers/teacher/activity.controller.js`) gets the structure of `designs-page.controller.js` and the cases page: plain ES helpers for status, filters, the search and the date, with `node:test` coverage.
- `activity-description` stays while other pages use it: the home's recent activities and the dashboard's context panel. It is retired from this page.
- The relative date helper is shared with the home's recent activities.

**Data**
- `GET /activities` (`backend/controllers/activities/activities-teacher.js:87`) returns the session's `status`, `time`, `code`, `archived` and the whole design document. The rows also need:
  - the current phase's number and mode (`sessions.current_stage`, joined to `stages`) and the number of phases;
  - the number of students who joined (`sesusers` with role `A`, as the dashboard's bar counts them);
  - `ai_services_enabled`;
  - `finished_at`, for finished activities.
- The design document is used for its title and case. Returning those fields alone would make the response much smaller for teachers with many activities.

**End time**
- A migration adds `sessions.finished_at timestamptz NULL`. Existing finished sessions keep NULL: their end time is unknown, and guessing it from responses would record a time nobody saw.
- `FINISH_SESSION_SQL` (`backend/helpers/activity-finish-helper.js`) sets it in the statement that makes the session `finished`, so the teacher's own finish and the finish of a forgotten teacher's open activities (#877) both record it. A finish that resumes a pending finalization keeps the first time.

**Archive**
- Replace the toggle with an explicit `PATCH /activities/:session_id/archive` taking `{ archived: true | false }`, as cases and designs have. Undo then sends `false`, and a repeated request does no harm.
- Archiving an activity that is not finished is refused with a coded 409, `ACTIVITY_NOT_FINISHED`. Restoring is always allowed.
- Archived sessions that are not finished may already exist from the toggle. A query in `deploy/README.md` lists them before deploying; whether they are finished or restored is decided then.

**Translations**
- New keys in `es_CL` and `en_US`. "Actuales" becomes "En curso"; "Desarchivar" becomes "Restaurar".

## Decisions

- **2026-11-03: an activity's end time is recorded.** Most activities are synchronous and last under an hour, but the record of when an activity ended is worth keeping. Terminadas shows it.
- **2026-11-03: the list shows each activity's status and its participants,** with no response count. The status is "Sin iniciar" (`initiated`), "Fase n de m · Grupal" or "· Individual" (`in_progress`) or "Finalizada" (`finished`).
- **2026-11-03: only a finished activity can be archived.** The page and the server apply the same rule.
- **2026-11-03: archiving changes nothing for students.** They see a finished activity and an archived one the same way.

## Out of scope

- The activity dashboard, the reports page and the launch wizard.
- Deleting activities.
- Bulk actions, such as archiving several finished activities at once.
- Phones: below 1024 px the one-column layout keeps working but is not optimized.
