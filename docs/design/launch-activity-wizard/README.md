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
  - `wireframes.html?frame=A`, and likewise for B to E, renders one frame alone at its real size.
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
- It asks for "Breve descripción de esta actividad (opcional)" with no hint of what makes it useful. The activity's name is always the design's title, so two activities launched from the same design differ only by this description.
- Launching locks the design for editing, which the page does not mention.

**Order.**
- `GET /designs` already returns the teacher's designs newest first (`ORDER BY d.id DESC`), but the page does not say so.
- The creation date shown on each card comes from `metainfo.creation_date` in the design document. Nothing in the current code sets it, 6 of the 98 local designs lack it, and copies keep the original's date, so it cannot be used to order the list.

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
- The list says how it is ordered and how many designs it holds: "Más recientes primero · 24 diseños".

**One row per design**
- Each row shows:
  - a radio button, the title, and the type, number of phases and case;
  - the AI services the design uses, as chips;
  - when it was last launched, for example "Lanzado 2 veces · 28 oct." or "Nunca lanzado".
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

**Action bar**
- It shows "Elegido: <title>" and "Siguiente: identificar la actividad →".
- "Siguiente" is disabled until a design is selected.
- "Cancelar" goes back to where the teacher came from, as today's "Volver" does.

### Step 2: identify and launch (frames C, E)

**The chosen design**
- It is shown at the top, with "← Cambiar diseño".
- Going back keeps step 1's search, filter and selection.

**Description of the activity**
- The label and the help text say what the description is for: "Para reconocerla después en Actividades: curso, sección, semestre o fecha."
- The example placeholder reads "Ej.: Ética Profesional · Sección 3 · 2026-2".
- Under the field, "Usadas antes" offers the teacher's last distinct descriptions as chips. One click fills the field, so the teacher can reuse a course label exactly.
- Whether the description is required is an open question; the frames show it as required.

**AI services of the design**
- A switch, "Usar los servicios de IA de este diseño", is on by default.
- The switch lists which service runs in which phase, for example "Fase 1 · Tutor de argumentación" and "Fase 2 · Agente de discusión".
- Off: the services are struck through, and a note says that the phases run without them and that the design keeps them for later activities.
- A design without AI services shows one line instead: "Este diseño no usa servicios de IA."
- The switch applies to this activity only. The design does not change.

**How it will look**
- A preview of the activity card in Actividades, with the design's title as the name and the description highlighted.

**Before launching**
- A note says that launching makes the design read-only, and that it can be duplicated to edit it.

**Action bar**
- It shows "← Atrás", a summary ("Con 2 servicios de IA · <title>") and "🚀 Lanzar actividad".
- While the launch runs, the button reads "Preparando el panel…" and is disabled.
- If the design turns out to be invalid at launch, the error appears in the bar.
- A successful launch opens the activity's dashboard, as today.

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
| "Breve descripción de esta actividad (opcional)" | "Descripción de la actividad", with help, an example and previous descriptions |
| — | AI services switch |
| — | Activity card preview and the note about locking |
| "Lanzar la actividad" with a spinner below | "Lanzar actividad" in the action bar, with its progress and errors |

## Implementation notes

**Page and step state**
- The routes stay the same.
- One page controller owns the wizard state: step, search, filter, selection and description.
- The step is mirrored in the URL (`$location.search`), so Back and Forward move between steps.

**Rows**
- A compact row component replaces `design-item` on this page only. `design-item` stays in Diseños.
- The list is today's `DesignCatalogService.getUserDesigns()`, filtered by `valid`, in its current order.
- "Last launched" and the launch count come from the teacher's activities. `GET /activities` already returns `designId` and `time` for each activity, so the activity catalog can be joined on the client side.

**Previous descriptions**
- They are the teacher's most recent distinct `description` values from the same catalog, for example the last five.

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

None yet; this is the first version for review.

## Open questions

1. **Order of the list.** The frames order designs by creation, newest first, which is today's order by design id, and show the last launch as information. The alternative is to order by last launch, so a design used every semester stays on top. A third option is to offer both in the "Más recientes primero ▾" menu.
2. **Required description.** Making it required helps the teacher tell activities apart later, but it adds friction for a quick test launch. The frames show it as required.
3. **The description in the dashboard and the lists.**
   - The activity's name is always the design's title, so the activity bar of the dashboard (#892) shows the same name for every activity launched from that design.
   - Should the bar and the activity lists show the description next to the name?
   - Alternatively, should step 2 let the teacher edit the name, prefilled with the design's title?
4. **AI services granularity.** One switch for the whole activity (drawn), or one per service, for example keeping the tutor and turning off the discussion agent?
5. **Checking AI services before launch.** Today a service that is not running is reported on the dashboard after the launch. Step 2 could check the services first and warn before launching. That needs a read-only status endpoint for the services the design uses.

## Out of scope

- Launching another teacher's public design directly. It still has to be imported into the teacher's own designs first.
- Editing a design from this page.
- Changing the dashboard that opens after the launch.
- Phones: the page is used on laptops. Below 1024 px the one-column layout keeps working but is not optimized.
