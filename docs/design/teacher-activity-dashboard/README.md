# Teacher activity dashboard: layout proposal

Low-fidelity proposal for reorganizing the teacher's activity dashboard in legacy EthicApp (AngularJS, route `#!/activities/:id`, template `ethicapp/frontend/assets/static/views/teacher/activity.view.html`). The goal is to give the students' live responses the most space on screen, keep the activity controls always reachable, and keep everything else accessible without it pushing the responses down.

Files:

- `wireframes.html`: frames drawn at their real viewport size, with the fold marked and numbered notes. A to C show the layout at 1920 × 1080, 1366 × 768 and 1024 × 768; D to F show the response detail in a side panel at the same three sizes. Open it in a browser; it has no dependencies.
- `frames/`: each wireframe frame rendered as a PNG (light theme), for viewing without opening the HTML.
- `current/`: screenshots of today's dashboard at 1920 × 1080, 1366 × 768 and 1024 × 768 (first screen and whole page), taken on the local stack from a finished two-phase activity.

## The problem, measured

The page stacks everything in one fixed-width column (Bootstrap 3 `.container`, 1050 px at every viewport width):

| Block, top to bottom | Top, in px |
| --- | --- |
| Tabs Información / Usuarios / Diseño, activity card | 180 |
| Activity controls (next phase, end, reports) | 507 |
| "Progreso de la Actividad", case and phase tabs | 610–660 |
| Phase features, instructions, questions, AI services | 700–1360 |
| **Responses heading** | **1370** |
| **First response row** | **1399** |

Measured with headless Chrome on an activity whose phase has one question; the numbers are the same at 1920, 1366 and 1024 px wide, because the column does not grow. At 1920 × 1080 the first response row is about 320 px under the fold, and more than half of the screen width is empty. Each extra question, a longer instruction or another AI service pushes the responses further down. During a live activity the controls also scroll out of view as soon as the teacher scrolls down to the responses.

## Proposal

### Principles

1. Responses are the main content: they start in the first screen at every supported width.
2. The controls (start next phase, end activity, reports) are always one click away, in a sticky bar.
3. Everything else stays, but as context next to or under the responses, condensed or collapsed, never above them.
4. The page uses the width it has: two columns from 1200 px, one column below.

### Layout from 1200 px: two columns

- **Activity bar, sticky** at the top of the content: name, status, current phase, access code (copy), connected students, and the controls. Once the activity is finished, the controls give way to "Reportes de actividad".
  - The controls keep today's hold-to-confirm: the button must be held for 2.5 s, which prevents starting the next phase by accident.
  - On hover and focus, a tooltip explains it: "Mantén presionado 2,5 s para iniciar la fase siguiente". While held, the button fills from left to right; releasing it early cancels.
- **Left rail**, 320 px at 1920 (260 px at 1366):
  - **Phase navigator** replacing the case and phase tabs: one row per phase with its mode and "answered / participants", the current phase marked and selected by default.
  - Starting the next phase always selects the new phase, as today. Every phase already started stays selectable.
  - **This phase**, condensed: features as chips, instructions clamped to three lines, and the questions numbered Í1, Í2… as the legend of the table columns. At 1366 it starts collapsed to the questions.
  - **AI services and warnings** of the phase (today's external services summary and tutor-mode warnings), one line per service with details on demand; the "service not running" alert moves here.
  - **Activity details**, collapsed: description, design and case links, launch date.
- **Main column**, the rest of the width:
  - tabs **Respuestas** (default), **Caso**, **Diseño**, **Participantes (n)**. Case, design and the connected-users list keep their current components;
  - a toolbar with the phase, its progress, a participant search and an "Ocultar nombres" switch (see below);
  - the response table with a sticky header. A row opens the response detail in a side panel (see below).

In the 1920 × 1080 frame the first response row is at about 290 px, and about 19 rows (responses and group summaries) fit on the first screen; at 1366 × 768, about 11.

### Below 1200 px: one column

- The same sticky bar, on one line: the name truncates, the controls, the code and the connected count stay.
- The phase navigator becomes a row of pills above the main tabs, with the same behaviour: the new phase is selected when it starts, and earlier pills stay clickable.
- The rail cards move under the table as collapsed sections ("Esta fase", "Servicios de IA", "Actividad").
- With the question legend under the table, the Í column headers show their question text on hover and focus.

In the 1024 × 768 frame the first response row is at about 340 px, with about 10 rows on the first screen.

### Response detail in a side panel

Today a row opens a large modal (`sd-individual-response-modal`, `sd-group-response-modal`) with a static backdrop, so the table is hidden until it closes. The group modal lists each question with every member's answer, then the group chat (`teacher-group-chat`), where the teacher writes and replies live. The proposal keeps that content and moves it into a panel next to the table.

**How the panel behaves:**
- It is not modal. The table stays visible and live, and the selected rows are highlighted.
- Clicking another row replaces the panel's content. ‹ › and the ↑ ↓ keys move to the previous or next group or student; Esc or × closes it.
- It is sticky under the activity bar and as tall as the viewport, with its own scroll, so the chat composer never leaves the screen.
- New answers and messages arrive as they do in today's modal, through the existing group chat subscription.
- Starting the next phase closes it. The previous phase's chat closes for the students, and each phase has its own chat, so nothing carries over.

**At each width:**
- **1920 × 1080 (frame D):**
  - the panel is 600 px wide and the table narrows to about 680 px, still with every column and about 19 rows;
  - a group shows its answers and its chat stacked, with a draggable splitter, each about 310 px tall at first;
  - the composer is pinned to the bottom.
- **1366 × 768 (frame E, an anonymous group phase with names hidden):**
  - the rail folds into a 48 px strip of phase dots, so the table keeps about 510 px with every column;
  - the 480 × 600 px panel shows Respuestas and Chat as tabs, because a split would leave too little room for either;
  - a group opens on Respuestas, as a phase without chat does (the frame shows the Chat tab, to show its layout);
  - the Chat tab counts the messages that arrived since it was last viewed;
  - a one-line digest of the group's values sits above the transcript.
- **Below 1200 px (frame F):**
  - a 470 px panel slides over the right part of the table, without a backdrop;
  - the names and the first columns stay visible and clickable.
- **One student (frame F, an earlier individual phase with names hidden):**
  - each question with its scale, its poles and the full justification;
  - in a group phase, a link to that student's group and its chat.

**Implementation:**
- The answers reuse the modals' content as components, and the chat reuses `teacher-group-chat` unchanged. Only the container changes: from `$uibModal` to a panel the dashboard controller opens.
- Ranking designs have no detail modal today; they keep their tables.

### Hiding names

An "Ocultar nombres" switch in the toolbar lets the teacher project the dashboard without exposing students.
- **Where names are replaced:** in the table, the panel, the chat authors and the Participantes tab.
- **What replaces them** depends on the phase. Two schemes coexist, and the dashboard never shows both for the same phase.
  - **The rule: in a phase with groups, the group letter; in a phase without groups, the number.** Whether the phase is anonymous for the students does not change it.
  - **Group letters, in every group phase.**
    - Every group member has a letter within their group (A, B, C…, `teamusers.anon_mask`). `ethicapp/backend/controllers/groups.js` assigns it whenever a phase's groups are created, anonymous or not; the phase's anonymity only decides whether students see the letter or the real name.
    - With names hidden, the dashboard shows that letter, "Integrante B": in the table, the group panel, the chat authors, and the panel of one student in a group phase ("Respuesta de Integrante B · Grupo 2").
    - In an anonymous group phase, it is the same letter the students see. Letters are drawn again for every group phase, so students who meet again in another chat room cannot recognize each other. A number shown next to the letter would let anyone watching the screen match them through the answers, and follow one anonymous identity from room to room.
    - In a group phase that is not anonymous, members already know each other's names. With numbers, a member could match a teammate's number through the answers, and since the number lasts the whole activity, identify that teammate in every phase projected later. With letters, they learn only what they already knew, for that phase and group, and the rest of the class learns nothing.
  - **Numbers, in phases without groups:** "Participante NN" in individual phases and in the Participantes tab.
    - The numbers are drawn in a random order once per activity, so they do not follow the class list or the alphabetical order.
    - They stay the same in every phase. The teacher can still refer to a row aloud.
- **Order of the rows.** While names are hidden, rows are ordered by pseudonym: by letter within each group in a group phase, and by number in an individual phase. Ordering them by real name would give the class list away.
- **Numbers and letters never appear together** for the same phase.
- **What keeps its label:** the teacher's own messages and the AI agents.
- **Default:** the switch always starts off. The teacher turns it on before sharing or projecting the screen.
- **Scope:** display only. It changes no data and does not affect the phase's own anonymity setting for students.
- **Implementation note:** the server assigns each participant's number once and stores it per activity.
  - Each number is drawn at random among the ones still free in a range wider than the class, for example 1–99. So numbers are not consecutive, and they reveal neither the alphabetical order nor who joined late.
  - A student who joins late gets a new number, and nobody else's changes.
  - Deriving the numbers from an ordering instead, such as a keyed hash of the participants, would renumber everyone whenever a student joins late.

### Where today's pieces go

| Today | Proposal |
| --- | --- |
| Page title "Reporte de Actividad" | Activity name in the sticky bar |
| Tabs Información / Usuarios / Diseño | Main tabs Respuestas / Caso / Diseño / Participantes |
| `activity-description` card | Status, code and connected count in the bar; the rest in the collapsed "Actividad" card |
| `activity-controls` panel | Sticky bar |
| "Servicios no disponibles" alert | Rail, AI services card (one column: top of that section) |
| Case and phase tabs | Phase navigator (rail) or pills (one column); case in the Caso tab |
| `phase-description` (features, instructions, questions) | "Esta fase" card |
| External services summary, `tutor-mode-warnings` | "Servicios de IA" card |
| `phase-state` (responses) | Main column, Respuestas tab |
| `connected-users` | Participantes tab, count in the bar |
| `design-item`, `design-viewer` | Diseño tab |

### Implementation notes

- It fits the current stack: a page-level CSS grid (or Bootstrap 3 columns with a fluid container) inside the existing app shell, `position: sticky` for the bar and the table header, and the existing directives and components moved, not rewritten. The design-type templates (`sd-*`, `ranking-*`) keep working as the content of the "Esta fase" card and the Respuestas tab.
- The sticky bar's hold-to-confirm buttons keep their accessible names; the tooltip is also their description (`aria-describedby`).
- Selecting the new phase when it starts is today's behaviour, kept without a switch.

## Decisions

- **2026-10-30: the layout of frames A to C is approved as implementable.** That includes the main tabs Respuestas, Caso, Diseño and Participantes, and the phases above them as a navigator, or as pills in one column, with the current phase marked.
- **2026-10-30: starting the next phase always moves the view to the new phase.** The teacher can still open any phase already started; there is no "follow current phase" switch.
- **2026-10-30: the hold-to-confirm button stays (2.5 s),** with a tooltip that explains it.
- **2026-10-30: the case stays a tab.** No split view of case and responses.
- **2026-10-30: no presentation density for projectors.** Instead, an "Ocultar nombres" switch.
- **2026-10-30: the response detail moves from the modal to a side panel,** as drawn in frames D to F.
- **2026-10-30: a group's panel opens on Respuestas,** as in a phase without chat.
- **2026-10-30: starting the next phase closes the panel.** Chats of successive phases are independent, and the previous one closes for the students, so an unsent message is not kept.
- **2026-10-30: "Ocultar nombres" always starts off.** Pseudonym numbers are random per activity and the rows are ordered by them, so neither follows the class list.
- **2026-10-30: with names hidden, a phase with groups shows the group letters; a phase without groups shows the numbers.** This holds whether the group phase is anonymous for the students or not.
  - The letters are the ones students see in anonymous chats, and they last a single phase.
  - Numbers never appear next to letters. So they cannot link the chat rooms of different group phases, and teammates who know each other's names cannot learn a number that would identify them in later phases.

## Out of scope

- Phones: the dashboard is used on laptops and projectors; below 1024 px the one-column layout keeps working but is not optimized.
- Changes to the response tables' content, statistics or the student app.
