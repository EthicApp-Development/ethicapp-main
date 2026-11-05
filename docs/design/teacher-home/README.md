# Teacher home: activities proposal

This is a low-fidelity proposal for the activities on the teacher's home in legacy EthicApp: AngularJS, route `#!/`, template `ethicapp/frontend/assets/static/views/teacher/home.html`, shown after sign-in and from "Inicio" in the side menu.

The home has three parts: the title "Taller del Docente" with an intro, a launcher of six photo tiles, and the "Actividades Recientes" panel. The proposal changes the panel. It replaces its `activity-description` cards with two short tables in the design language of Actividades ([`../activities-index`](../activities-index/README.md), epic #1046): the newest activities in progress, then the newest finished ones. Rows, statuses, actions and menus are those of the Actividades tabs. The title stays, and the launcher's six tiles go into one row (see Decisions).

Files:

- `wireframes.html` draws the frames at their real viewport size, with the fold marked and numbered notes. It has no dependencies; open it in a browser.
  - A shows the home at 1920 × 1080, with a row menu open.
  - B shows the same page at 1366 × 768, with today's launcher.
  - C shows the option of a one-row launcher at 1366 × 768.
  - D shows the page in one column at 1024 × 768.
  - E shows the home of a teacher with no activities, at 1366 × 768.
  - Frames are as tall as the page, so they show what lies below the fold.
  - `wireframes.html?frame=A`, and likewise for B to E, renders one frame alone at its real size.
- `frames/` holds each frame rendered as a PNG (light theme).
- `current/` holds screenshots of today's home at 1920 × 1080, 1366 × 768 and 1024 × 768 (first screen and whole page).
  - They were taken on the local stack with a seeded teacher, "Docente Demo", who has 75 activities: 9 launched with no phase started, 44 with a phase in progress, 18 finished and 4 archived.
  - The proposals for designs, cases and activities used `teacher-650`, whose data is no longer on the local stack.

## The problem, measured

| Block, top to bottom | Top, in px |
| --- | --- |
| Title "Taller del Docente" | 120 |
| Intro | 171 |
| Launcher, six tiles in three columns, 190 px tall each | 277–679 |
| "Actividades Recientes" | 736 |
| First activity card | 792 |
| End of the last card | 2530 |

The page was measured with headless Chrome. The numbers are the same at 1920, 1366 and 1024 px wide, because the column is 1050 px wide (896 px at 1024) and does not grow.

**The first screen.**
- At 1366 × 768 no activity is visible: only the heading "Actividades Recientes" reaches the bottom edge.
- At 1920 × 1080 one card is visible, the newest activity in progress.

**The cards.**
- `recentActivities` (`frontend/assets/js/helpers/recent-activities.js`) picks the three newest activities that are not finished, then the three newest finished ones. Archived activities are left out.
- The six cards are 273 px tall each and follow one another with no heading between them. The teacher can only tell a finished activity by its status line.
- Each card shows the name and the description given at launch, then five lines: "Estado actual" (the list's status since #1079), "Diseño usado", "Caso asociado", "Código de acceso" and "Fecha de inicio".
  - "Diseño usado" repeats the name for most activities, because the name defaults to the design's title (`launch-activity-wizard`).
  - A finished activity still shows its access code, which nobody can use any more.
- The only button is "Ver", which opens the dashboard. A finished activity's reports are two clicks away, as they were in Actividades before #1046.

**What the panel does not say.**
- How many activities are in progress, and how many have not started. The panel shows three of each kind whatever the totals.
- How many participants joined each activity, and whether its AI services are on. Actividades says both.
- Where the rest are. The panel has no link to Actividades; only the launcher's "Ver actividades" tile leads there.

**A new teacher.** The panel shows "No tienes actividades recientes. Puedes comenzar por lanzar una actividad o crear un nuevo diseño" and three buttons in a row: "Nuevo caso", "Crear un diseño" and "Lanzar una actividad". Actividades shows the same teacher two numbered steps (#1053).

## Proposal

### Head and launcher (frames A, B)

- The title and the intro stay as they are, in today's 1050 px column.
- With today's launcher, the list would start at 799 px, below the first screen at 1366 × 768. The launcher therefore goes into one row (frame C, see below).

### Actividades en curso (frame A)

**Heading**
- "Actividades en curso", followed by two counts that are links: the total ("53", to `#!/activities`) and "Sin iniciar 9" (to `#!/activities?status=not-started`).
- The order is stated on the right: "Más recientes primero".

**Rows**
- The five newest activities that are not finished, started or not, in the En curso table of Actividades: Actividad (name, description, and the case under them, with the design only when the activity was renamed), Estado with the "IA" mark, Participantes, Código with its copy button, and Lanzada.
- "▶ Abrir panel" is the visible action. The "⋯" menu holds Copiar código, Reportes, Ver diseño and Ver caso.
- Copying a code shows the notice of Actividades, "Código copiado".

**Footer**
- "Mostrando 5 de 53" on the left, and "Ver las 53 en curso →" on the right, which opens Actividades.
- A teacher who has finished activities but none in progress sees one line in place of the table: "No tienes actividades en curso.", and "🚀 Lanzar actividad".

### Terminadas recientemente (frame A)

- The three newest finished activities that are not archived, in the Terminadas table: Actividad, Estado ("■ Finalizada" with the "IA" mark), Participantes and Terminada. The code goes away.
- "📊 Reportes" is the visible action: one click to the reports page, where today it takes two.
- The "⋯" menu is that of Terminadas: Abrir panel, Lanzar de nuevo, Ver diseño and Archivar. Archiving shows the notice of Actividades, with "Deshacer", and the next finished activity takes the row.
- The footer reads "Mostrando 3 de 18" and "Ver las 18 terminadas →", which opens `#!/activities?tab=finished`.
- The section is left out when the teacher has no finished activities.

### A new teacher (frame E)

The empty page of Actividades replaces both sections: "Todavía no has lanzado actividades", what an activity is, then "1. Prepara un diseño" with "+ Nuevo diseño" and "2. Lanza la actividad" with "🚀 Lanzar actividad". As in Actividades, the first step is left out when the teacher already has a design ready to launch.

### Widths (frame D)

- **From 1200 px:** tables.
- **Below 1200 px:** the app's menu folds, and both tables become the compact rows of Actividades.

### One-row launcher (frame C)

- The six tiles go into one row, 96 px tall, with the same photos cropped, the same captions, order and targets.
- The list then starts at 453 px. At 1366 × 768, five of the eight rows are on the first screen, against none with today's launcher.

| | First row | Rows on the first screen at 1366 × 768 | At 1920 × 1080 | End of the list |
| --- | --- | --- | --- | --- |
| Today | 792 px | 0 cards | 1 card | 2530 px |
| Proposal, today's launcher (A, B) | 799 px | 0 | 4 | 1408 px |
| Proposal, one-row launcher (C) | 453 px | 5 | not drawn | 1062 px |

### Where today's pieces go

| Today | Proposal |
| --- | --- |
| "Actividades Recientes", one panel | "Actividades en curso" and "Terminadas recientemente", each with its counts |
| Three activities in progress and three finished, 273 px cards | Five rows in the En curso table and three in the Terminadas table |
| Heading: name · description | The Actividad column's title |
| "Estado actual" | The Estado column, with the "IA" mark |
| "Diseño usado", always | The design in the meta line, only when the activity was renamed |
| "Caso asociado" | The meta line |
| "Código de acceso", also on finished activities | The Código column, for activities in progress only |
| "Fecha de inicio" | Lanzada; Terminada for finished activities |
| "Ver" | "Abrir panel" in progress; "Reportes" finished; the "⋯" menu |
| No link to Actividades | The counts and "Ver las … →" |
| The new-teacher sentence and three buttons | The two steps of Actividades |

## Implementation notes

**What is reused from #1046**
- **Rows.** `buildActivityTables` (`frontend/assets/js/helpers/activities-table.js`) already builds the En curso and Terminadas rows, with their status, participants, dates, visible action and menu. The home takes the first rows of each table.
- **Notices.** `codeCopiedNotice`, `archiveNotice` and `archiveChangeFailureNotice` (`activity-action-feedback.js`) and the notice fragment `activities-action-notice.template.html`.
- **The empty page.** `activities-empty-page.template.html`, with the check for a design ready to launch (`launchableDesigns`).
- **Dates.** `createActivityDateFormatter` (`activity-dates.js`), with the teacher's time zone and language.
- **Styles.** The `cases-table` and `activities-*` classes, including the compact rows below 1200 px.

**What changes**
- **The table templates.** `activities-ongoing-tab.template.html`, `activities-finished-table.template.html` and `activities-row-menu.template.html` read everything from the page controller's alias `ap` and from `ap.tab`. To use them on the home, the table becomes a component, for example `<activities-table tab="…" rows="…" busy="…" on-action="…">`, used by both pages. The Actividades page keeps its tabs, filters and "Mostrar más" around it.
- **The row actions.** The actions that `ActivitiesPageController.runAction` runs (open the dashboard, open the reports, copy the code, archive with undo) move to a service or a helper that both controllers call, so the home does not copy them.
- **The controller.** `RecentActivitiesController` gets the counts and the first rows from `buildActivityTables`. `recentActivities` and its limit of 3 are replaced; their tests move with them.
- **`activity-description`.** The home stops using the card. The dashboard's context panel is then its only user (`activity-dashboard-context.template.html`).

**Data.** `GET /activities` already returns every field the rows need (#1059), so the server does not change.

**Translations.** New keys in `es_CL` and `en_US` for the two headings, the counts, the footers and the one-line empty message. `recent_activities_title_text` and `no_recent_activities_text` are retired if nothing else uses them.

## Decisions

- **2026-11-04: the launcher goes into one row** of six 96 px tiles (frame C), so the list starts on the first screen at 1366 × 768. Frames A, B, D and E still draw today's launcher.
- **2026-11-04: the home keeps both sections,** "Actividades en curso" and "Terminadas recientemente". The finished rows are the shortest way to a report.
- **2026-11-04: five rows in progress and three finished.**
- **2026-11-04: the title "Taller del Docente" and its intro stay.** A role line for the home can be proposed separately.

## Out of scope

- The launcher's photos, captions and targets; only its layout changes.
- The home's title and intro.
- The side menu and the top bar.
- Filters and search on the home; they stay in Actividades.
- The activity dashboard, the reports page and the launch wizard.
