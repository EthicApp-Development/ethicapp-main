// Rules for PATCH /designs/:id (#730). Launching an activity locks its design
// (`designs.locked`), so the activity keeps the content it started with; a
// locked design's content can no longer change. Archiving and sharing
// (`/archive`, `/toggle_public`) do not change the content and stay allowed.

export const DESIGN_LOCKED_CODE = "DESIGN_LOCKED";

// The content update. `locked IS NOT TRUE` repeats the lock check inside the
// UPDATE itself, so a design locked after the check is still not modified;
// no returned row means the design is locked.
export const UPDATE_UNLOCKED_DESIGN_SQL = `
    UPDATE designs
    SET design = $1,
        case_id = $2,
        visibility = $4,
        public = $5,
        license_code = $6,
        attribution_text = $7,
        language_code = $8
    WHERE id = $3
      AND locked IS NOT TRUE
    RETURNING id
`;

export function designLockedRefusal() {
    return {
        status: 409,
        body:   {
            status:  "err",
            code:    DESIGN_LOCKED_CODE,
            message: "This design is used by an activity and can no longer be edited. "
                + "Duplicate it to make changes.",
        },
    };
}

function sameId(left, right) {
    return Number(left) === Number(right);
}

// Why the session user cannot update `existingDesign` (as read from
// `designs`: id, creator, locked), as `{ status, body }`, or null when the
// update may proceed. Another teacher's design gets the same 404 as a missing
// one, so the answer does not reveal that it exists (#929, epic #923).
export function designUpdateRefusal(existingDesign, sessionUid) {
    // rest-pg-2's singleSQL returns {} when no row matches.
    if (!existingDesign?.id || !sameId(sessionUid, existingDesign.creator)) {
        return { status: 404, body: { status: "err", message: "Design not found" } };
    }
    if (existingDesign.locked === true) {
        return designLockedRefusal();
    }

    return null;
}
