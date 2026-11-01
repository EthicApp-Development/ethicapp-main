# Launch an activity: wizard proposal

This is a low-fidelity proposal for reorganizing the teacher's "Lanzar Actividad" page in legacy EthicApp: AngularJS, routes `#!/activities/new` and `#!/activities/new/:designId`, template `ethicapp/frontend/assets/static/views/teacher/activity.new.html`.

Launching an activity is one user task made of two sub-tasks:
1. find and choose a design;
2. identify the activity, so the teacher can later tell it apart by course or section, and decide whether it uses the design's AI services.

The proposal turns the page into a two-step wizard. The teacher always sees which step they are on, what they have chosen, and what is left to do.

Files:

- `wireframes.html` draws the frames at their real viewport size, with the fold marked and numbered notes. It has no dependencies; open it in a browser.
  - A and B show step 1 at 1920 × 1080 and 1366 × 768.
  - C shows step 2 at 1366 × 768.
  - D and E show both steps in one column at 1024 × 768; E has the AI services turned off.
  - F shows step 2 when the design's AI services are not available.
  - `wireframes.html?frame=A`, and likewise for B to F, renders one frame alone at its real size.
- `frames/` holds each frame rendered as a PNG (light theme), for viewing without opening the HTML.
- `current/` holds screenshots of today's page at 1920 × 1080, 1366 × 768 and 1024 × 768 (first screen and whole page), plus 1366 × 768 after selecting a design. They were taken on the local stack with 65 launchable designs.

## The problem, measured

The page stacks everything in one fixed-width column:

| Block, top to bottom | Top, in px |
| --- | --- |
| Title, "Volver", "Indicaciones" (two bullet points) | 120–300 |
| Step 1 panel, search box | 416 |
| First design card | 506 |
| Pagination (5 cards per page) | 2371 |
| **Step 2, after selecting a design** | **2489** |

The page was measured with headless Chrome. The numbers are the same at 1920, 1366 and 1024 px wide, because the column does not grow.

**The design list.**
- Each design is a 353 px card. It lists a title link, validity, a lock warning, creation date, type, visibility, license, tags, case and number of phases, then "Ver" and "Seleccionar".
- At 1920 × 1080 one card fits on the first screen. At 1366 × 768 and 1024 × 768 none does.
- With 65 designs the list has 13 pages.

**Choosing a design.**
- The search is a typeahead, with a popup of at most 8 titles, and it also filters the paginated list.
- "Ver" leaves the page for the design view. Coming back loses the search and the page.
- Designs with errors are hidden from the list without saying so.

**Step 2.**
- Selecting a design reveals step 2 at 2489 px and scrolls there. The list and the selection leave the screen.
- Step 2 does not name the chosen design.
- It asks for "Breve descripción de esta actividad (opcional)" with no hint of what makes it useful. The activity's name is always the design's title, so two activities launched from the same design differ only by this description. Yet the dashboard's activity bar shows only the name.
- Launching locks the design for editing, which the page does not mention.

**Order.**
- `GET /designs` returns the teacher's designs newest first (`ORDER BY d.id DESC`), but the page does not say so.
- The creation date shown on each card comes from `metainfo.creation_date` in the design document. Nothing in the current code sets it, 6 of the 98 local designs lack it, and copies keep the original's date. The `designs` table has no creation timestamp.

## Proposal

### Principles

1. **One step at a time.** The current step, the steps done and the steps left are always visible, in a stepper.
2. **The choice stays in sight.** What the teacher chose is named in the action bar and at the top of step 2, and can be changed in one click.
3. **The next action is always in view.** A bar fixed to the bottom of the viewport holds "Siguiente" or "Lanzar actividad".
4. **Nothing leaves the page by accident.** The design preview is inline, and "Ver diseño completo" opens a new tab.

### Step 1: choose a design (frames A, B, D)

**Finding a design**
- The search filters the list as the teacher types, over title, case and tags. It has no typeahead popup.
- Type chips (Todos, Diferencial semántico, Ranking) narrow the list.

**Order**
- The list is ordered by last launch, most recent first, and says so: "Por último lanzamiento · 24 diseños".
- A design that was never launched is placed by its creation date. A design created yesterday therefore sits above one last launched a month ago, and a design just written for this class is at the top.

**One row per design**
- Each row shows:
  - a radio button, the title, and the type, number of phases and case;
  - "✦ IA" when any of the design's phases enables an AI service;
  - when it was last launched ("Lanzado 2 veces · 28 oct.") or, if never, created ("Creado 25 oct. · nunca lanzado").
- The whole row selects the design, and it has no other buttons. Double-clicking a row moves on to step 2.
- The list shows the first 20 rows, then "Mostrar más". There are no pages.
- 11 rows fit on the first screen at 1920 × 1080, 6 at 1366 × 768, and 3 at 1024 × 768 with the selected row expanded.

**Designs that cannot be launched**
- Designs with errors and archived designs are not listed.
- The list's footer says how many designs have errors and links to Diseños: "3 diseños con errores no aparecen · Revisar en Diseños".

**Preview of the selected design**
- From 1200 px, the preview is a 460 px panel (380 px at 1366) next to the list. Below 1200 px, the selected row expands in place.
- It shows:
  - the type and number of phases;
  - the case, with "Ver caso ↗";
  - each phase with its mode, group size, chat, number of questions and AI service;
  - when the design was created and last launched;
  - "Ver diseño completo ↗", which opens in a new tab.
- The AI services are named with each service's own UI texts, as in the design editor and the dashboard.

**Action bar**
- It shows "Elegido: <title>" and "Siguiente: identificar la actividad →".
- "Siguiente" is disabled until a design is selected.
- "Cancelar" goes back to where the teacher came from, as today's "Volver" does.

### Step 2: identify and launch (frames C, E, F)

**The chosen design**
- It is shown at the top, with "← Cambiar diseño".
- Going back keeps step 1's search, filter and selection.

**Description of the activity, required**
- The label, the help text and the placeholder say what it is for: "Obligatoria. Para reconocerla después: curso, sección, semestre o fecha." The placeholder reads "Ej.: Ética Profesional · Sección 3 · 2026-2".
- Under the field, "Usadas antes" offers the teacher's last distinct descriptions as chips. One click fills the field, so the teacher can reuse a course label exactly.
- "Lanzar actividad" stays disabled while the description is empty or blank. The server rejects a launch without one.

**AI services of the design, checked before the launch**
- When step 2 opens, the page asks the server which of the design's services can run, using the same rules as today's launch notice (see below).
- Each service is listed by phase, with its state:
  - **All can run (frame C):** each service shows "● Disponible", and the switch "Usar los servicios de IA de este diseño" is offered, on by default.
  - **Turned off (frame E):** the services are struck through, and a note says that the phases run without them and that the design keeps them for later activities. The switch applies to the whole activity; the design does not change.
  - **None can run (frame F):** there is no switch, since there is nothing to turn off. Today's "services not available" notice is shown here, before the launch: "No están disponibles ahora. La actividad se realizará sin ellos."
  - **Some can run:** the switch is offered for those, and the others are listed under the same warning.
- A design without AI services shows one line instead: "Este diseño no usa servicios de IA."

**How it will look**
- A preview of the activity card, with the design's title as the name and the description next to it. Activities and the dashboard will show it the same way (see "Beyond this page").

**Before launching**
- A note says that launching makes the design read-only, and that it can be duplicated to edit it.

**Action bar**
- It shows "← Atrás", a summary ("Con 2 servicios de IA", "Sin servicios de IA" or "Servicios de IA no disponibles", then the title) and "🚀 Lanzar actividad".
- While the launch runs, the button reads "Preparando el panel…" and is disabled.
- If the design turns out to be invalid at launch, the error appears in the bar.
- A successful launch opens the activity's dashboard, as today.

### Beyond this page: the description next to the name

The activity's name is the design's title, so activities launched from the same design look alike. The description is shown next to the name wherever activities are listed or opened:
- **in the dashboard's activity bar** (#892 and #951), as a secondary part of the title, "Privacidad en apps de salud · Ética Profesional · Sección 3 · 2026-2". When space runs short, the description is cut before the name;
- **in the activity cards** of Actividades and the home page, in the card's heading, instead of a separate "Descripción:" line;
- **in the browser tab's title** of the dashboard.

Older activities without a description keep showing the name alone.

### Widths

- **From 1200 px:** step 1 is a list plus a preview, step 2 is a form plus the activity card preview, and the app's side menu stays.
- **Below 1200 px (frames D, E):**
  - the menu folds and the stepper drops its second lines;
  - in step 1 the preview moves into the selected row;
  - in step 2 the activity card moves under the form, and the page scrolls under the fixed action bar.

### Entry points

- **The side menu's "Lanzar Actividad" and the home page** open step 1.
- **A design's "Lanzar Actividad" button** (Diseños, the design view) opens `#!/activities/new/:designId` directly on step 2, with that design chosen. "Cambiar diseño" leads to step 1 with it selected.
- **The browser's back button** moves from step 2 to step 1. The step is part of the URL, for example `?step=2`.

### Where today's pieces go

| Today | Proposal |
| --- | --- |
| Title, "Volver", "Indicaciones" (two bullet points) | Title and stepper; "Volver" becomes "Cancelar" in the action bar |
| Step 1 panel: typeahead search, 353 px `design-item` cards, 5 per page | Live search, type chips, one row per design, "Mostrar más" |
| "Ver" button (leaves the page) | Inline preview; "Ver diseño completo ↗" in a new tab |
| Validity and lock lines on every card | Only launchable designs are listed; the footer counts the ones with errors |
| Visibility and license lines | Dropped from this page; they stay in Diseños |
| Step 2 panel revealed under the list | Step 2 of the wizard |
| "Breve descripción de esta actividad (opcional)" | "Descripción de la actividad", required, with help, an example and previous descriptions |
| — | AI services, checked before launch, with a switch when they can run |
| "Servicios no disponibles" notice on the dashboard after launch | The same notice in step 2, before the launch |
| — | Activity card preview and the note about locking |
| "Lanzar la actividad" with a spinner below | "Lanzar actividad" in the action bar, with its progress and errors |

## Implementation notes

**Page and step state**
- The routes stay the same.
- One page controller owns the wizard state: step, search, filter, selection and description.
- The step is mirrored in the URL (`$location.search`), so Back and Forward move between steps.

**Rows**
- A compact row component replaces `design-item` on this page only. `design-item` stays in Diseños.
- The list is today's `DesignCatalogService.getUserDesigns()`, filtered by `valid`.

**Order**
- Last launches come from the teacher's activities. `GET /activities` already returns `designId` and `time` for each activity, so the activity catalog can be joined on the client side.
- Placing never-launched designs by creation needs a creation time:
  - a migration adds `designs.created_at timestamptz DEFAULT now()`;
  - existing rows keep it null, since `metainfo.creation_date` is not reliable;
  - the sort key is the last launch, else `created_at`, with ties and nulls broken by id, newest first;
  - so existing designs that were never launched go after every dated one.

**"✦ IA" in the list**
- It is a property of the design alone: some phase has a non-empty `externalServices.enabledServiceIds`. The helper `unionEnabledServiceIds` already computes this on the server.
- The list does not enumerate or name services, so it needs no service catalog and does not change when services are added.

**Service names in the preview and in step 2**
- They come from the services' own UI texts (`getUiTranslations` of each adapter, as the design editor and the dashboard already use). No service name is written in the page.

**Previous descriptions**
- They are the teacher's most recent distinct `description` values from the activity catalog, for example the last five.

**Required description**
- The client validates the field.
- `POST /sessions` rejects an empty or blank description with a coded 400.
- Existing activities without a description are not changed.

**Checking the AI services before launch**
- A read-only endpoint, for example `GET /designs/:id/ai-services`, lists each service the design enables with its UI texts and whether it can run.
- It reuses `listServicesNotRunning` (`helpers/ai-service-launch-notice.js`), evaluated against the AI service policy version the launch would pin.
- "Can run" means what today's notice means:
  - the policy allows the service;
  - an AI Additions connection is stored;
  - the adapter is registered.

  It is not a live health probe of the remote service; that belongs with the platform health epic (#642).

**AI services switch**
- **The launch.** The request needs one more field, for example `aiServices: false` on `POST /activities`, stored on the session (`sessions.options`, or a dedicated column).
- **Phase hooks.** Phases read their services from the design each time a hook fires (`getPhaseExternalServices` in `helpers/external-service-dispatch.js`), so the session's flag must be honored there: no service is dispatched, while `phase-ended` still closes room jobs.
- **Student app.** The phase's services also reach the student app through `helpers/student-activity-state-helper.js`. With the switch off, the student app must not show "processing your response".
- **Teacher dashboard.** The "Servicios de IA" card says the services were turned off at launch.
- **Launch warning.** The `servicesNotRunning` warning after launch is skipped.
- **AI policy.** The session still pins the AI service policy version at launch, as today.

**Launch flow**
- Launching keeps today's flow: `POST /sessions` with the design's title as the name and the description, `POST /activities`, then locking the design locally.

## Decisions

- **2026-11-01: the list is ordered by last launch.** A design never launched is placed by its creation date.
- **2026-11-01: the description is required.**
- **2026-11-01: the description is shown next to the activity's name** in the dashboard's activity bar and in the activity lists, so activities launched from the same design can be told apart.
- **2026-11-01: one switch turns off the AI services for the whole activity.**
- **2026-11-01: step 2 checks whether the design's AI services can run before offering the switch.** If they cannot, it shows the "services not available" notice instead, before the launch.
- **2026-11-01: the list only marks that a design uses AI ("✦ IA").** Enumerating services as chips would need the list to cross the service catalog with every design, for little gain. The preview names the service of each phase.

## Out of scope

- Launching another teacher's public design directly. It still has to be imported into the teacher's own designs first.
- Editing a design from this page.
- Live health checks of the AI services (#642).
- Phones: the page is used on laptops. Below 1024 px the one-column layout keeps working but is not optimized.
