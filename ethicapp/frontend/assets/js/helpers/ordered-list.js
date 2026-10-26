// Ordered lists the teacher edits in place (#793, epic #789): moving and
// removing items, telling whether the order changed, and where keyboard focus
// goes after a move. The case form's videos and attached documents share them.

/** The list with the item at `index` moved by `offset` places, when possible. */
export function moveListItem(list, index, offset) {
    const target = index + offset;
    if (!Array.isArray(list) || index < 0 || index >= list.length
        || target < 0 || target >= list.length) {
        return list;
    }

    const moved = list.slice();
    const [item] = moved.splice(index, 1);
    moved.splice(target, 0, item);
    return moved;
}

/** The list without the item at `index`. */
export function removeListItem(list, index) {
    if (!Array.isArray(list) || index < 0 || index >= list.length) {
        return list;
    }
    return list.filter((_item, position) => position !== index);
}

/** Whether two lists of keys hold the same keys in the same order. */
export function sameOrderedKeys(keys, otherKeys) {
    const left = Array.isArray(keys) ? keys : [];
    const right = Array.isArray(otherKeys) ? otherKeys : [];
    return left.length === right.length
        && left.every((key, index) => key === right[index]);
}

/**
 * The move button ("up" or "down") that keeps the keyboard on an item moved
 * by `offset` to `position` in a list of `length` items: the button that can
 * still move it the same way, or the other one at either end.
 */
export function moveFocusDirection(offset, position, length) {
    const canKeepDirection = offset < 0 ? position > 0 : position < length - 1;
    return (offset < 0) === canKeepDirection ? "up" : "down";
}
