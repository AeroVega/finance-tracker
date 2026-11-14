// Select transport metadata from the internal object kind, never its filename
// or a caller-supplied MIME override. Paged locator roots/pages are canonical
// JSON; all other immutable payloads retain their existing binary contract.
export function immutableContentType(kind) {
  return kind==='locator-catalog'||kind==='locator-catalog-page'
    ? 'application/json' : 'application/octet-stream';
}
