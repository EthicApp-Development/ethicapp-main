import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  caseDirectoryPath,
  isValidUploadRelativePath,
  isWithinUploadDirectory,
  profileImageDeletionEntries,
  recordUploadDeletionRequests,
  uploadRelativePath
} from '../upload-deletion-helper.js';

describe('upload deletion helper (#877)', () => {
  it('turns the stored public paths into paths relative to the uploads root', () => {
    assert.equal(uploadRelativePath('/uploads/cases/12/case.pdf'), 'cases/12/case.pdf');
    assert.equal(uploadRelativePath('uploads/user-profiles/5/user-5-original.jpg'), 'user-profiles/5/user-5-original.jpg');
    assert.equal(uploadRelativePath('/assets/uploads/cases/12/case.pdf'), 'cases/12/case.pdf');
  });

  it('refuses paths outside the uploads, with dot segments, or with other characters', () => {
    for (const storedPath of [
      null,
      '',
      '/etc/passwd',
      '/uploads/../etc/passwd',
      '/uploads/cases/../../etc/passwd',
      '/uploads/cases/./12/case.pdf',
      '/uploads/cases',
      '/uploads/cases/12/my case.pdf',
      '/uploads/cases\\12\\case.pdf',
      `/uploads/cases/${'a'.repeat(600)}`
    ]) {
      assert.equal(uploadRelativePath(storedPath), null, String(storedPath));
    }
    assert.equal(isValidUploadRelativePath('cases/12'), true);
    assert.equal(isValidUploadRelativePath('/cases/12'), false);
  });

  it('names a case directory and tells what is inside it', () => {
    assert.equal(caseDirectoryPath(12), 'cases/12');
    assert.throws(() => caseDirectoryPath('../1'), TypeError);
    assert.equal(isWithinUploadDirectory('cases/12/case.pdf', 'cases/12'), true);
    assert.equal(isWithinUploadDirectory('cases/12', 'cases/12'), true);
    assert.equal(isWithinUploadDirectory('cases/120/case.pdf', 'cases/12'), false);
  });

  it('keeps the profile images that are upload paths', () => {
    assert.deepEqual(profileImageDeletionEntries('/uploads/user-profiles/5/a.jpg', null, 'https://example.com/a.jpg'), [
      { path: 'user-profiles/5/a.jpg', recursive: false }
    ]);
  });

  it('records each path once, keeping the longest delay, and nothing for no path', async () => {
    const calls = [];
    const client = { query: async (sql, params) => calls.push({ sql, params }) };

    assert.equal(await recordUploadDeletionRequests(client, 5, 9, []), 0);
    assert.deepEqual(calls, []);

    const recorded = await recordUploadDeletionRequests(client, 5, 9, [
      { path: 'cases/12', recursive: true, delaySeconds: 0 },
      { path: 'user-profiles/5/a.jpg' },
      { path: 'cases/12', recursive: false, delaySeconds: 600 }
    ]);

    assert.equal(recorded, 2);
    assert.match(calls[0].sql, /INSERT INTO upload_deletion_requests/);
    assert.match(calls[0].sql, /ON CONFLICT \(user_id, path\) DO UPDATE/);
    assert.deepEqual(calls[0].params, [5, ['cases/12', 'user-profiles/5/a.jpg'], [true, false], [600, 0], 9]);
  });

  it('refuses to record an invalid path', async () => {
    const client = { query: async () => assert.fail('nothing must be written') };

    await assert.rejects(
      recordUploadDeletionRequests(client, 5, 9, [{ path: '../secrets' }]),
      TypeError
    );
  });
});
