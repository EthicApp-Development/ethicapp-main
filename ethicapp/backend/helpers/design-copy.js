// The design document stored for an imported copy (POST /designs/:id/duplicate).
// Everything the author configured is copied, including each phase's external
// service selection and `configurations` (#729); only identity, sharing and the
// title change.

export function buildDesignCopyDocument(sourceDocument, { title, visibility }) {
    // eslint-disable-next-line no-unused-vars
    const { id, ...copy } = structuredClone(sourceDocument);

    copy.public = false;
    copy.visibility = visibility;
    copy.locked = false;
    copy.metainfo = {
        ...(copy.metainfo || {}),
        title,
    };

    return copy;
}
