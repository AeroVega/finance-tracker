import assert from 'node:assert/strict';

// Only answer the exact provider endpoints and binding requested by the app.
export function fakeGoogleFolderProof(url, options, { folderId, token, shared = false }) {
  const endpoint = new URL(url);
  const root = '/drive/v3/files/' + encodeURIComponent(folderId);
  if (endpoint.origin !== 'https://www.googleapis.com' || endpoint.searchParams.get('supportsAllDrives') !== 'true') return;
  if (endpoint.pathname !== root && endpoint.pathname !== root + '/permissions') return;
  const fields = endpoint.searchParams.get('fields');
  if (!fields?.includes('ownedByMe') && !fields?.includes('permissions(id,type,role,pendingOwner,view)')) return;
  assert.equal(options.method, 'GET');
  assert.equal(new Headers(options.headers).get('authorization'), 'Bearer ' + token);
  assert.equal(options.cache, 'no-store');
  if (endpoint.pathname === root + '/permissions') {
    assert.equal(endpoint.searchParams.get('includePermissionsForView'), 'published');
    return Response.json({permissions:[{id:'invented-owner',type:'user',role:'owner'}]});
  }
  return Response.json({
    id:folderId,mimeType:'application/vnd.google-apps.folder',trashed:false,
    ownedByMe:true,shared,owners:[{permissionId:'invented-owner'}],
    capabilities:{canListChildren:true,canAddChildren:true}
  });
}
