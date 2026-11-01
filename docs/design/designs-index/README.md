# Designs: management page proposal

This is a low-fidelity proposal for reorganizing the teacher's designs index in legacy EthicApp: AngularJS, route `#!/designs`, template `ethicapp/frontend/assets/static/views/teacher/design.index.html`, reached from "Diseños" in the side menu.

The page's job is to manage designs: create, edit, duplicate, share, archive and delete the teacher's own, and import the ones other teachers share. It is not where activities are launched; that is "Lanzar actividad", redesigned in [`../launch-activity-wizard`](../launch-activity-wizard/README.md). Teachers mix the two up today, because both pages look the same. The proposal makes each page look like what it does.

Files:

- `wireframes.html` draws the frames at their real viewport size, with the fold marked and numbered notes. It has no dependencies; open it in a browser.
  - A shows "Mis diseños" at 1920 × 1080, with a row menu open.
  - B shows the designs with errors at 1366 × 768.
  - C shows "Compartidos por otros" after an import, at 1366 × 768.
  - D shows the delete confirmation at 1366 × 768.
  - E shows the page in one column at 1024 × 768.
  - `wireframes.html?frame=A`, and likewise for B to E, renders one frame alone at its real size.
- `frames/` holds each frame rendered as a PNG (light theme).
- `current/` holds screenshots of today's page at 1920 × 1080, 1366 × 768 and 1024 × 768 (first screen and whole page), plus the "De otros" tab at 1366 × 768. They were taken on the local stack with 68 designs of one teacher.

## The problem, measured

| Block, top to bottom | Top, in px |
| --- | --- |
| Title "Diseños de Actividades", "Volver" | 120–190 |
| "Crear un diseño" | 223 |
| "Puedes buscar diseños creados por otros usuarios… e importarlos…" | 277 |
| Search | 317 |
| Tabs "Tuyos", "De otros", "Archivadas" | 370 |
| First design card | 433 |

The page was measured with headless Chrome. The numbers are the same at 1920 and 1366 px wide, because the column does not grow.

**It looks like "Lanzar actividad".**
- Both pages use the same controller (`BrowseDesignsController`) and the same card component (`design-item`).
- The first button of every card in Diseños is "Lanzar Actividad".
- So a teacher who lands on either page sees the same list of the same cards. Each page's job is told only by the buttons at the bottom of each card.

**The cards.**
- Each card is 376 px tall, five per page: 14 pages for 68 designs.
- At 1920 × 1080 one card fits on the first screen; at 1366 × 768 and 1024 × 768 none does.
- A card spells its state out as prose, one line each: "Este es un diseño válido que puede utilizarse para lanzar actividades", "Este diseño no se puede editar ni eliminar porque está usado por una actividad", visibility, license.
- Its buttons are "Lanzar Actividad", "Editar" and "Eliminar" (when not in use), "Ver", "Duplicar", "Archivar", and an On/Off switch labeled "Compartir Diseño".

**Finding and organizing.**
- There is no filter by state. A teacher cannot list the designs with errors, the ones in use, or the shared ones.
- The page's only explanation is about importing others' designs. It is shown on every tab, including the teacher's own.
- The third tab says "Archivadas", although "diseños" is masculine.

**Safety and feedback.**
- "Eliminar" deletes at once, without asking.
- "Eliminar" fails silently for a design that has copies. `designs.original_design_id` and `designs.imported_from_design_id` reference the original without `ON DELETE`, so deleting it answers `500 Internal Server Error` (`designs_original_design_id_fkey`). The page only logs the error to the console, and the design stays in the list. Measured on the local stack: duplicate a design, then delete the original. This happens to every design the teacher ever duplicated, and to a shared design another teacher imported, whose author can then no longer delete it (#963). A design used by an activity would fail the same way (`activity_design_fkey`), but the page hides "Eliminar" for those.
- "Duplicar" gives no feedback; the copy just appears in the list.
- Importing shows "Diseño importado en tu colección" for 100 seconds, without saying which copy or offering to open it.
- "Ver" leaves the page, and coming back loses the search and the page number.

## Proposal

### Two pages, two jobs

| | Diseños | Lanzar actividad |
| --- | --- | --- |
| Job | Create, edit, organize and share designs; import designs other teachers shared | Choose one design and start an activity with it |
| What it lists | All the teacher's designs, including those with errors; the designs other teachers shared; the archived designs | Only the teacher's designs that can be launched |
| Shape | A table with status, sharing and edit actions on every row, and tabs for mine, shared by others and archived | A two-step wizard: rows with a radio button, a preview, and a fixed bar with "Siguiente" |
| Primary action | "Nuevo diseño"; per row, "Editar", "Corregir" or "Duplicar para editar"; in "Compartidos por otros", "Importar" | "Lanzar actividad" |
| Bridge to the other | The role line links to Lanzar actividad. Rows have no launch action | The list's footer links here, with the "Con errores" filter |

### Page head (frame A)

- **Title:** "Diseños", the side menu's label, instead of "Diseños de Actividades".
- **A role line** says what the page is for and where the other task lives: "Crea, edita y organiza tus diseños, o importa los que otros docentes comparten. ¿Quieres usar uno con tus estudiantes? Lanzar actividad →".
- **Page actions:** "+ Nuevo diseño" (primary) and "Importar diseño compartido", which opens the "Compartidos por otros" tab.
- "Volver" goes away; the side menu and the browser already go back.

### Tabs

- The tabs are "Mis diseños", "Compartidos por otros" and "Archivados", each with a count. "Compartidos por otros" says whose designs they are; "Biblioteca compartida" could be read as the teacher's own shared designs.
- The tab and the filters are part of the URL (`#!/designs?tab=shared`, `#!/designs?status=errors`). Other pages can link to a tab or a filter, and coming back from a design restores them.

### Mis diseños (frames A, B, E)

**Filters**
- The search covers title, case and tags.
- The type filter is a menu.
- The status chips are "Todos", "Listos", "Con errores · n", "En uso" and "Compartidos".
- The order is stated: "Más recientes primero".

**One row per design**
- **Diseño:** the title, with the number of phases and the case under it. The title opens the design's view, not the editor: the row's visible action is the way to edit.
- **Tipo:** a column of its own from 1200 px; at 1366 px it moves under the title.
- **Estado:** one of
  - "● Listo": it can be launched and edited;
  - "⚠ n errores": it cannot be launched yet;
  - "🔒 En uso · n actividades": it cannot be edited or deleted.

  This one column replaces today's validity and lock sentences.
- **Compartido:** the switch that shares the design with other teachers, who see it in their "Compartidos por otros" tab, as today's "Compartir Diseño", with the same checks on its case. A design with errors cannot be shared, so its switch is disabled.
- 12 rows fit on the first screen at 1920 × 1080.

**One visible action per row, chosen by its state**
- "✎ Editar" for a ready design.
- "⚠ Corregir" for a design with errors. It opens the editor.
- "⧉ Duplicar para editar" for a design in use. It creates a copy and opens it in the editor.

**The row's "⋯" menu**
- It holds Ver, Duplicar and Archivar.
- It has no launch entry. Launching starts from Lanzar actividad, so each page does one job.
- Then Eliminar, in red and last. For a design in use it is disabled and says why: "en uso por n actividades".

**Footer**
- It shows the count and "Mostrar más"; there are no pages.
- It also reminds what archiving does: it removes the design from this list and from Lanzar actividad, and it can be undone.

**Designs with errors (frame B)**
- "Con errores" is where the launch wizard's "Revisar en Diseños" lands.
- Each row says how many errors it has and offers "Corregir".

### Compartidos por otros (frame C)

- **A one-line banner explains the tab:** "Diseños que otros docentes compartieron. Al importar uno se crea una copia privada y editable en Mis diseños; el original no cambia."
- **Columns:** design (type, phases, case), author and license.
- **"⤓ Importar" is the row's only action.**
  - A design the teacher already imported shows "✓ Importado · Ver copia" instead, so it is not imported twice by mistake.
  - A design whose case stopped being public cannot be imported. It says so, with the button disabled, instead of failing after the click.
- **After an import,** a notice names the new copy and offers "Editar copia" and "Ver en Mis diseños".

### Archivados

- The tab is not drawn. It uses the same table, with "Restaurar" as the visible action.
- Its menu holds Ver, Duplicar and Eliminar. Eliminar is disabled while the design is in use.

### Deleting asks first (frame D)

- Eliminar opens a dialog: "¿Eliminar "<título>"? Se borrará definitivamente, con sus fases y preguntas. No se puede deshacer. Las copias de este diseño se conservan."
- Copies, the teacher's own or other teachers' imports, keep their title, author and license of origin (#963).
- The buttons are "Archivar en su lugar", "Cancelar" and "Eliminar diseño" (red).

### Feedback

| Action | Notice | Links |
| --- | --- | --- |
| Duplicar | "Se creó "<copia>"" | "Editar copia" |
| Importar | "Se creó "<copia>" en Mis diseños" | "Editar copia", "Ver en Mis diseños" |
| Archivar | "Se archivó "<título>"" | "Deshacer" |

Each notice disappears after a few seconds and can be dismissed.

### Widths

- **From 1200 px:** a table.
- **Below 1200 px (frame E):** the app's menu folds, and the table becomes compact rows. Each row shows the title and its details, then the status, sharing and actions on a second line. The page actions stay at the top right.

### Where today's pieces go

| Today | Proposal |
| --- | --- |
| "Diseños de Actividades", "Volver" | "Diseños" and a role line linking to Lanzar actividad |
| "Crear un diseño" | "+ Nuevo diseño", top right, with "Importar diseño compartido" |
| The sentence about importing, on every tab | The banner of "Compartidos por otros", on that tab only |
| Tabs "Tuyos", "De otros", "Archivadas" | "Mis diseños", "Compartidos por otros", "Archivados", with counts |
| 376 px `design-item` card, 5 per page | Table row, "Mostrar más" |
| Validity and lock sentences | The Estado column |
| Visibility line and the "Compartir Diseño" On/Off switch | The Compartido column's switch |
| License line | The Licencia column of "Compartidos por otros"; in Mis diseños, in the design's view |
| "Lanzar Actividad" as the first button | Removed; the role line links to Lanzar actividad |
| "Editar", "Duplicar", "Archivar", "Eliminar", "Ver" | One visible action by state; the rest in the "⋯" menu |
| "Eliminar" without confirmation | A confirmation dialog, with "Archivar en su lugar" |
| "Importar diseño" | "Importar"; "Importado · Ver copia" once imported; disabled with the reason when it cannot be |

## Implementation notes

**Controllers and components**
- Split the controller. Today `BrowseDesignsController` serves both this page and the launch page, which is part of why they look alike. This page gets its own controller; the launch wizard keeps its own.
- A table-row component for this page, plus a compact row for one column. `design-item` stays where it is still used, or is retired once both pages move away from it.

**Status**
- "Listo" and "con errores" come from the design's `valid` flag.
- The number of errors needs the validator's result. Either the client runs the design validation helpers on the design document, or `GET /designs` returns an error count.
- "En uso · n actividades" comes from the teacher's activities. `GET /activities` returns `designId`, the same join the launch wizard uses for its last launches. The `locked` flag keeps deciding what can be edited.

**Sharing**
- The switch keeps `DesignPublicationService.togglePublicVisibility`, including the case publication dialog (#942).

**Compartidos por otros**
- "Importado" comes from the teacher's own designs whose `imported_from_design_id` (or `original_design_id`) is the shared design. After #963 these links can be null, when the shared design was deleted; such a copy simply has no shared design to match.
- Knowing beforehand that a design cannot be imported needs the list to say so. For example, `GET /designs` adds an `importable` flag computed from the case's visibility, instead of the `DESIGN_CASE_NOT_IMPORTABLE` error after the click.

**Duplicate and import**
- Both keep `POST /designs/:id/duplicate`. The response's id lets the notice link to the new copy.

**Delete**
- The dialog uses the app's existing modal service.
- #963 fixes the delete itself, and this page builds on it: copies no longer block deleting their original (`ON DELETE SET NULL`), a design an activity uses is refused with a coded 409, `DESIGN_IN_USE`, and a failed delete shows its reason instead of failing silently.

**Translations**
- New keys in `es_CL` and `en_US`. "Archivadas" becomes "Archivados".

## Decisions

- **2026-11-01: Diseños has no launch action.** The row menu's "Lanzar actividad con este diseño" is removed, so Diseños only manages and Lanzar actividad only launches. The role line still links to Lanzar actividad.
- **2026-11-01: the tab of others' designs is "Compartidos por otros".** "Biblioteca compartida" could be read as the teacher's own shared designs.
- **2026-11-01: a click on a row's title opens the design's view,** not the editor.
- **2026-11-01: a design that has copies can be deleted.** The copies keep all their source metadata: `source_design_title`, `source_design_author` and `source_design_license_code`. The fix is tracked in #963.

## Out of scope

- The design editor and the design view themselves.
- Bulk actions, folders, and editing tags from this page.
- Versioning designs.
- Phones: the page is used on laptops. Below 1024 px the one-column layout keeps working but is not optimized.
