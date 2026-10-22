// Translation key for a failed design save. A locked design (used by an
// activity) answers 409 DESIGN_LOCKED (#730); anything else is a generic failure.
export function designSaveErrorMessageKey(error) {
    if (error?.status === 409 && error?.data?.code === "DESIGN_LOCKED") {
        return "save_design_locked";
    }

    return "save_design_failure";
}
