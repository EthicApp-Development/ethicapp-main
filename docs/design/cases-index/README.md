# Cases: management page and case view proposal

This is a low-fidelity proposal for reorganizing the teacher's cases in legacy EthicApp: AngularJS, routes `#!/cases` and `#!/cases/:id`, templates `ethicapp/frontend/assets/static/views/teacher/cases.index.html` and `cases.view.html`, reached from "Casos" in the side menu.

The page manages the material designs are built on: write or upload a case, add videos and documents, share it, archive or delete it, and import the cases other teachers share. The proposal brings it into the design language of the Diseños page ([`../designs-index`](../designs-index/README.md), epic #966): a role line, tabs with counts, a table with one status column and one visible action per row, a row menu, a delete confirmation and action notices. It also gives the case view a head with the case's actions and the designs that use it.

Files:

- `wireframes.html` draws the frames at their real viewport size, with the fold marked and numbered notes. It has no dependencies; open it in a browser.
  - A shows "Mis casos" at 1920 × 1080, with a row menu open.
  - B shows "Compartidos por otros" after an import, at 1366 × 768.
  - C shows the delete confirmation at 1366 × 768.
  - D shows the case view at 1366 × 768.
  - E shows the page in one column at 1024 × 768.
  - `wireframes.html?frame=A`, and likewise for B to E, renders one frame alone at its real size.
- `frames/` holds each frame rendered as a PNG (light theme).
- `current/` holds screenshots of today's page at 1920 × 1080, 1366 × 768 and 1024 × 768 (first screen and whole page), the "De otros" tab at 1366 × 768, and the case view at 1366 × 768. They were taken on the local stack with the cases of one teacher (`teacher-650`, the same teacher as the designs proposal).

## The problem, measured

| Block, top to bottom | Top, in px |
| --- | --- |
| Title "Casos éticos", "Volver a la página anterior" | 120–190 |
| "Nuevo caso" | 223 |
| Search | 275 |
| Tabs "Tuyos", "De otros", "Archivadas" | 327 |
| First case card | 390 |

The page was measured with headless Chrome. The numbers are the same at 1920 and 1366 px wide, because the column does not grow.

**The cards.**
- Each card is 390–432 px tall, five per page. At 1920 × 1080 one card fits on the first screen; at 1366 × 768 and 1024 × 768 none does.
- A card spells the case out in nine lines, one fact each: title, author, email, language, visibility, rights status, license, PDF link and document processing. A case in use adds a tenth: "Este caso no se puede editar, eliminar ni volver privado porque está asociado a un diseño usado por una actividad".
- Its buttons are "Ver", "Editar", "Duplicar", "Archivar" and "Eliminar", and a "Compartir caso" switch with two lines of help text.
- The language shows as a code (`es_CL`).

**What the page does not say.**
- How many designs use a case, and whether other teachers' designs are among them. Both decide what sharing, making private and deleting affect.
- That a case another teacher shared can be chosen directly in a design. The "De otros" tab offers only "Importar caso", without saying what importing does.
- Which cases are in use, which are shared and which have a PDF that could not be processed. There is no status filter.
- The third tab says "Archivadas", although "casos" is masculine; it uses the shared key `archived`.

**Safety and feedback.**
- "Eliminar" deletes at once, without asking.
- "Eliminar" fails with a 500 for a case that has copies. `ethical_cases.original_case_id` and `imported_from_case_id` reference the original without `ON DELETE`, so deleting it violates `ethical_cases_original_case_id_fkey`. Measured on the local stack, inside a rolled-back transaction, on the one case with a copy. This is the case counterpart of #963.
- Deleting a case that designs use, when no activity was launched from them, succeeds and leaves those designs without a case: `designs.case_id` is `ON DELETE SET NULL` (`V3__ethical_cases.sql`). This includes other teachers' designs. The only guard is `hasLaunchedDesignActivity` (`ethicapp/backend/controllers/cases.js:593`). On the local stack, one private case keeps nine designs of another teacher. Epic #923 decided that existing associations are never detached; deleting the case detaches them.
- "Duplicar", "Archivar" and "Importar" show a generic notice and switch to the "Tuyos" tab, without naming the copy or offering to open it.

**The case view.**
- Its title is "Ver caso". Under it, the same card without buttons, 329 px tall, then the tabs "Texto del caso" and one per AI analysis. The document starts at 625 px.
- It has no actions. To edit, duplicate or archive the case, the teacher goes back to the list.
- The case's title in the card links to the page the teacher is already on.

## Proposal

### Casos and Diseños

| | Casos | Diseños |
| --- | --- | --- |
| Job | Write or upload cases, add their material, decide which to share; import cases other teachers shared | Create, edit, organize and share designs; import designs other teachers shared |
| What a row says | PDF state, use by activities, designs that use it, sharing | Ready, errors or in use; sharing |
| Primary action | "Nuevo caso"; per row "Editar", "Reemplazar PDF" or "Duplicar para editar"; "Importar" | "Nuevo diseño"; per row "Editar", "Corregir" or "Duplicar para editar"; "Importar" |
| Bridge to the other | The role line links to Diseños; "Nuevo diseño con este caso" in the row menu and the case view | The row's meta line names the case |

### Page head (frame A)

- **Title:** "Casos", the side menu's label, instead of "Casos éticos".
- **A role line:** "Sube tus casos, agrega su material y decide cuáles compartir, o importa los que otros docentes comparten. ¿Quieres usar uno con tus estudiantes? Crea un diseño →".
- **Page actions:** "+ Nuevo caso" (primary) and "Importar caso compartido", which opens the "Compartidos por otros" tab.
- "Volver a la página anterior" goes away; the side menu and the browser already go back.

### Tabs

- "Mis casos", "Compartidos por otros" and "Archivados", each with a count.
- The tab and the filters are part of the URL (`#!/cases?tab=shared`, `#!/cases?status=in-use`), as in Diseños.

### Mis casos (frames A, E)

**Filters**
- The search covers title, authors and tags.
- The status chips are "Todos", "Listos", "En uso", "Compartidos" and "PDF con error · n".
- The order is stated: "Más recientes primero".

**One row per case**
- **Caso:** the title, with the pages, the attached material (videos, documents) and the language under it. The title opens the case view.
- **Estado:** one of
  - "● Listo";
  - "⟳ Procesando PDF", while the worker renders its pages;
  - "⚠ PDF con error", when rendering failed and students see the PDF instead of the pages;
  - "🔒 En uso · n actividades", when an activity was launched from a design that uses it. The case cannot be edited or deleted; its sharing stays editable (see Decisions).

  When a case is in use and its PDF failed, "En uso" wins: the teacher cannot replace the PDF anyway.
- **Diseños:** how many designs use the case and, under it, how many belong to other teachers. "Sin diseños" when none does.
- **Compartido:** the switch that makes the case public, keeping today's publication confirmation (#939) and the notice about the public designs that become private (#934). It works for a case in use too, in both directions (see Decisions).
- 12 rows fit on the first screen at 1920 × 1080, and 6 at 1366 × 768.

**One visible action per row, chosen by its state**
- "✎ Editar" for a ready or processing case.
- "⚠ Reemplazar PDF" for a case whose PDF failed. It opens the editor.
- "⧉ Duplicar para editar" for a case in use. It creates a copy and opens it in the editor.

**The row's "⋯" menu**
- Ver, Nuevo diseño con este caso, Duplicar and Archivar.
- Then Eliminar, last. It is disabled, with the reason, in two cases:
  - the case is in use: "en uso por n actividades";
  - other teachers' designs use it: "lo usan n diseños de m docentes" (see Decisions).

**Footer**
- The count and "Mostrar más"; there are no pages.
- A reminder of what archiving does: it removes the case from this list and from the design editor's case search, and it can be undone. Designs that already use it keep it.

### Compartidos por otros (frame B)

- **A one-line banner:** "Casos que otros docentes compartieron. Puedes elegirlos directamente en tus diseños, o importar uno para tener una copia privada y editable en Mis casos; el original no cambia."
- **Columns:** case (pages, language), author, and license with the rights status under it.
- **"⤓ Importar" is the row's visible action.** A case the teacher already imported shows "✓ Importado · Ver copia" instead. "Nuevo diseño con este caso" sits next to it, since a shared case can be used without importing it.
- **After an import,** a notice names the new copy and offers "Editar copia" and "Ver en Mis casos". The page stays on the tab.

### Archivados

- The tab is not drawn. It uses the same table, with "Restaurar" as the visible action.
- Its menu holds Ver, Duplicar and Eliminar, with the same rules for Eliminar.

### Deleting asks first (frame C)

- Eliminar opens a dialog: "¿Eliminar "<título>"? Se borrará definitivamente, con su PDF, sus páginas, videos, documentos y análisis. No se puede deshacer."
- It lists the teacher's own designs that will lose their case.
- "Las copias de este caso se conservan." Copies keep their source title, author and license (`source_case_title`, `source_case_author`, `source_case_license_code`), once the foreign keys allow it.
- The buttons are "Archivar en su lugar", "Cancelar" and "Eliminar caso" (red).

### The case view (frame D)

- **Head.** "← Casos" returns to the list with its tab and filters. The title is the case's title. Under it, the author and the creation date.
- **Actions.** The row's rule: "Duplicar para editar" (primary) for a case in use, "Editar" otherwise, plus "Nuevo diseño con este caso" and a "⋯" menu with Duplicar, Archivar and Eliminar. For a case of another teacher, the actions are "Importar" and "Nuevo diseño con este caso".
- **Facts as one line of chips:** state, sharing, language, license, rights status, pages and material, tags. The nine card lines go away.
- **Where it is used.** "Se usa en n diseños · a tuyos, b de otros docentes", with the teacher's own designs as links to their views. Other teachers' designs are counted and never named. A private case that other teachers keep says so here, which is what #939 tells the author when they make it private.
- **Tabs.** "Texto del caso" first, as today, then "Material" when the case has videos or documents, one tab per AI analysis, and "Derechos" with the attribution, license notes, permission statement and commercial source. Today the material sits under the document, and the rights details sit in the card.
- The document starts at 369 px, against 625 px today.

### Feedback

| Action | Notice | Links |
| --- | --- | --- |
| Duplicar | "Se creó "<copia>"" | "Editar copia" |
| Importar | "Se creó "<copia>" en Mis casos" | "Editar copia", "Ver en Mis casos" |
| Archivar | "Se archivó "<título>"" | "Deshacer" |
| Compartir, dejar de compartir | Today's notices (#934, #939) | |

Each notice disappears after a few seconds and can be dismissed. The page stays on the current tab.

### Widths

- **From 1200 px:** a table.
- **Below 1200 px (frame E):** the app's menu folds and the table becomes compact rows: title and meta, then status, designs, sharing and the actions on a second line.

### Where today's pieces go

| Today | Proposal |
| --- | --- |
| "Casos éticos", "Volver a la página anterior" | "Casos" and a role line linking to Diseños |
| "Nuevo caso" | "+ Nuevo caso", top right, with "Importar caso compartido" |
| Tabs "Tuyos", "De otros", "Archivadas" | "Mis casos", "Compartidos por otros", "Archivados", with counts |
| 390–432 px `case-card`, 5 per page | Table row, "Mostrar más" |
| Title, author and email lines | The row's title; author and email in the case view and in "Compartidos por otros" |
| Language line (`es_CL`) | The language's name in the meta line |
| Visibility line and the "Compartir caso" switch | The Compartido column's switch |
| Rights status and license lines | The Licencia column of "Compartidos por otros"; chips and the "Derechos" tab in the case view |
| "PDF del caso: Abrir archivo" | "Abrir PDF" in the case view's document header |
| Document processing line | The Estado column |
| The in-use warning sentence | "🔒 En uso · n actividades" and the disabled menu entries with their reason |
| "Ver", "Editar", "Duplicar", "Archivar", "Eliminar" | One visible action by state; the rest in the "⋯" menu |
| "Eliminar" without confirmation | A confirmation dialog, with "Archivar en su lugar" |
| "Importar caso" | "Importar"; "Importado · Ver copia" once imported |
| "Ver caso" with the card and no actions | The case view's head, actions, chips and uses |

## Implementation notes

**Controllers and components**
- `CasesController` serves the list, the view, the creation form and the edit form today (615 lines). The list gets its own controller, as `designs-page.controller.js` did for Diseños, and so does the view. The forms keep theirs.
- The list's filtering, status and row actions go in plain ES helpers, like `design-status.js`, `designs-filters.js` and `designs-table.js`, with `node:test` coverage.
- `case-card` is retired once neither page uses it.

**Data**
- `GET /cases` (`ethicapp/backend/controllers/cases.js:619`) returns `hasLaunchedDesignActivity` as a boolean, and `publicDesigns`. The rows need:
  - the number of activities launched from designs that use the case, for "En uso · n actividades";
  - the number of designs that use it, split into the teacher's own and other teachers';
  - for "Compartidos por otros", whether the teacher already has a copy (`imported_from_case_id` or `original_case_id` among their own cases).
- The case view also needs the ids and titles of the teacher's own designs that use the case. Other teachers' designs are only counted, as the #923 access rules require.
- The document state already comes from `documentProcessing`, which the controller polls while it is pending.

**Delete**
- A migration recreates `ethical_cases_original_case_id_fkey` and `ethical_cases_imported_from_case_id_fkey` with `ON DELETE SET NULL`, as #963 did for designs.
- `DELETE /cases/:id` answers coded 409s: `CASE_USED_BY_LAUNCHED_ACTIVITY` (exists) and a new `CASE_USED_BY_OTHER_TEACHERS`. The page shows the reason for a failed delete.
- The dialog uses the app's existing modal service.

**Nuevo diseño con este caso**
- It needs the design creation form to accept a case, for example `#!/designs/new?caseId=<id>`, checked with the existing `findAssociableCase` rule.

**Translations**
- New keys in `es_CL` and `en_US`. "Archivadas" becomes "Archivados" on this page.

## Decisions

Recorded in epic #1008.

- **2026-11-02: a case that other teachers' designs use cannot be deleted.** `DELETE /cases/:id` answers `409 CASE_USED_BY_OTHER_TEACHERS`, and the page offers archiving. Their designs would otherwise lose their case, against the #923 decision that associations are never detached.
- **2026-11-02: "Nuevo diseño con este caso" is in scope,** as a shortcut to a new design built on the case: in the "Mis casos" row menu, next to "Importar" in "Compartidos por otros", and in the case view. The design creation form accepts `?caseId=`.
- **2026-11-02: the case view's uses panel is complete:** the teacher's own designs that use the case, as links, and the counts of other teachers' designs. It needs a new server query.
- **2026-11-02: the rights details go in a "Derechos" tab** of the case view.
- **2026-11-02: a case in use locks only its content and its deletion.** Its visibility, license and rights stay editable in both directions, with the publication confirmation (#939) and the notice about the public designs that become private (#934). Visibility changes neither what activities showed nor who already reads the case, and making a case private has the same effect on other teachers' public designs whether the case is in use or not. Today the server refuses every change to a case in use, so a teacher cannot share a design used by an activity when its case is their own private case.

Frames A and B were drawn before these decisions: A shows the Compartido switch of a case in use locked, and B shows "Importar" alone.

## Out of scope

- The case creation and edit forms, and their material editors.
- The AI analysis tabs' contents.
- Bulk actions, folders and editing tags from this page.
- Phones: below 1024 px the one-column layout keeps working but is not optimized.
