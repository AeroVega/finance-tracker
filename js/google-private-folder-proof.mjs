import { AppError } from './app-error.mjs';
import { discardDriveResponse, readBoundedDriveJson } from './drive-response-transport.mjs';

const FILES = 'https://www.googleapis.com/drive/v3/files/';
const FOLDER = 'application/vnd.google-apps.folder';
const MAX_PERMISSION_PAGES = 8;

// Call before any session release, binding change, or lifecycle start, using
// subject and token from the SAME verified candidate authorization.
export async function provePrivateGoogleFolder({
  folderId, accountId, token, expiresAt, fetchImpl = globalThis.fetch, now = Date.now, signal
}) {
  const refusal = () => new AppError('private-folder-proof-failed');
  const nonempty = value => typeof value === 'string' && value.length > 0;
  if (!nonempty(folderId) || !/^[A-Za-z0-9_-]+$/.test(folderId) || !nonempty(accountId) || !nonempty(token) ||
      !Number.isFinite(expiresAt)) throw refusal();
  const checkGrant = () => {
    const current = now();
    if (!Number.isFinite(current) || current >= expiresAt - 5000) throw new AppError('authorization-required');
    if (signal?.aborted) throw refusal();
  };
  const get = async (path, params) => {
    checkGrant();
    let response;
    try {
      response = await fetchImpl(FILES + encodeURIComponent(folderId) + path + '?' +
        new URLSearchParams({ supportsAllDrives: 'true', ...params }), {
        method: 'GET', headers: { Authorization: 'Bearer ' + token },
        cache: 'no-store', redirect: 'error', signal
      });
    } catch (cause) {
      throw new AppError('private-folder-proof-failed', { cause });
    }
    try { checkGrant(); }
    catch (error) { await discardDriveResponse(response); throw error; }
    if (!response?.ok) {
      await discardDriveResponse(response);
      if (response?.status === 401) throw new AppError('authorization-required');
      throw refusal();
    }
    let body;
    try { body = await readBoundedDriveJson(response, {kind:'metadata'}); }
    catch (cause) { throw new AppError('private-folder-proof-failed', { cause }); }
    checkGrant();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw refusal();
    return body;
  };

  const metadata = await get('', {
    fields: 'id,mimeType,trashed,driveId,ownedByMe,owners(permissionId),shared,capabilities(canListChildren,canAddChildren)'
  });
  if (metadata.id !== folderId || metadata.mimeType !== FOLDER ||
      metadata.trashed !== false || 'driveId' in metadata ||
      metadata.ownedByMe !== true || metadata.shared !== false ||
      !Array.isArray(metadata.owners) || metadata.owners.length !== 1 ||
      metadata.owners[0]?.permissionId !== accountId ||
      metadata.capabilities?.canListChildren !== true ||
      metadata.capabilities?.canAddChildren !== true) throw refusal();

  const seenTokens = new Set();
  let pageToken;
  let foundOwner = false;
  for (let i = 0; i < MAX_PERMISSION_PAGES; i++) {
    const page = await get('/permissions', {
      fields: 'nextPageToken,permissions(id,type,role,pendingOwner,view)',
      includePermissionsForView: 'published',
      ...(pageToken === undefined ? {} : { pageToken })
    });
    if (!Array.isArray(page.permissions)) throw refusal();
    for (const permission of page.permissions) {
      if (foundOwner || permission?.id !== accountId || permission.type !== 'user' ||
          permission.role !== 'owner' ||
          ('pendingOwner' in permission && permission.pendingOwner !== false) ||
          'view' in permission) throw refusal();
      foundOwner = true;
    }
    if (!('nextPageToken' in page)) {
      if (!foundOwner) throw refusal();
      return Object.freeze({ folderId, verifiedAt: now() });
    }
    pageToken = page.nextPageToken;
    if (!nonempty(pageToken) || seenTokens.has(pageToken)) throw refusal();
    seenTokens.add(pageToken);
  }
  throw refusal();
}
