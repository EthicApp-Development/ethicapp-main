import assert from "node:assert/strict";
import test from "node:test";

import {
    getAuthorizedUpload,
    normalizeRequestedUploadPath,
} from "../protected-uploads.js";

test("normalizeRequestedUploadPath accepts legacy upload URL shapes", () => {
    assert.equal(
        normalizeRequestedUploadPath("/uploads/cases/12/case.pdf"),
        "cases/12/case.pdf"
    );
    assert.equal(
        normalizeRequestedUploadPath("/uploads/user-profiles/5/user-5-topbar-64.jpg?v=1"),
        "user-profiles/5/user-5-topbar-64.jpg"
    );
});

test("normalizeRequestedUploadPath rejects traversal and malformed paths", () => {
    assert.equal(normalizeRequestedUploadPath("/uploads/../secret.pdf"), null);
    assert.equal(normalizeRequestedUploadPath("/uploads/%2e%2e/secret.pdf"), null);
    assert.equal(normalizeRequestedUploadPath("/uploads/cases/1/%00case.pdf"), null);
    assert.equal(normalizeRequestedUploadPath("/uploads/%E0%A4%A"), null);
});

test("getAuthorizedUpload authorizes an ethical case document only when metadata query matches", async () => {
    const calls = [];
    const authorized = await getAuthorizedUpload(
        "cases/7/case.pdf",
        { uid: 12, role: "A" },
        async ({ sql, sqlParams }) => {
            calls.push({ sql, sqlParams });
            if (sql.includes("FROM ethical_cases c")) {
                assert.deepEqual(sqlParams[0], [
                    "uploads/cases/7/case.pdf",
                    "/uploads/cases/7/case.pdf",
                    "assets/uploads/cases/7/case.pdf",
                    "/assets/uploads/cases/7/case.pdf",
                ]);
                assert.equal(sqlParams[1], 12);
                assert.equal(sqlParams[2], "A");
                return [{ id: 7, pdf_path: "/uploads/cases/7/case.pdf" }];
            }

            return [];
        }
    );

    assert.deepEqual(authorized, { id: 7, pdf_path: "/uploads/cases/7/case.pdf" });
    assert.equal(calls.length, 1);
});

test("ethical case authorization keeps shared, imported, and activity-based access paths", async () => {
    await getAuthorizedUpload(
        "cases/7/case.pdf",
        { uid: 12, role: "P" },
        async ({ sql }) => {
            if (sql.includes("FROM ethical_cases c")) {
                assert.match(sql, /d\.creator = \$2 OR d\.public = TRUE/);
                assert.match(sql, /INNER JOIN activity a ON a\.design = d\.id/);
                assert.match(sql, /FROM sesusers su/);
                return [{ id: 7, pdf_path: "/uploads/cases/7/case.pdf" }];
            }

            return [];
        }
    );
});

test("getAuthorizedUpload allows authenticated users to read registered profile avatars", async () => {
    const authorized = await getAuthorizedUpload(
        "user-profiles/99/user-99-topbar-64.jpg",
        { uid: 12, role: "P" },
        async ({ sql, sqlParams }) => {
            if (sql.includes("FROM users")) {
                assert.deepEqual(sqlParams[0], [
                    "uploads/user-profiles/99/user-99-topbar-64.jpg",
                    "/uploads/user-profiles/99/user-99-topbar-64.jpg",
                    "assets/uploads/user-profiles/99/user-99-topbar-64.jpg",
                    "/assets/uploads/user-profiles/99/user-99-topbar-64.jpg",
                ]);
                assert.equal(sqlParams.length, 1);
                return [{ id: 99 }];
            }

            return [];
        }
    );

    assert.deepEqual(authorized, { id: 99 });
});

test("getAuthorizedUpload does not authorize unmatched upload metadata", async () => {
    let queryCount = 0;
    const authorized = await getAuthorizedUpload(
        "cases/99/case.pdf",
        { uid: 12, role: "P" },
        async () => {
            queryCount += 1;
            return [];
        }
    );

    assert.equal(authorized, null);
    assert.equal(queryCount, 2);
});

test("getAuthorizedUpload rejects missing authenticated session", async () => {
    let queryCount = 0;
    const authorized = await getAuthorizedUpload(
        "cases/99/case.pdf",
        {},
        async () => {
            queryCount += 1;
            return [{ id: 99 }];
        }
    );

    assert.equal(authorized, null);
    assert.equal(queryCount, 0);
});
