import assert from 'node:assert/strict';
import {HttpCatalogDrive} from './http-catalog-drive.mjs';

// This extension allows exactly the experimental manifest's multipart PATCH.
// All other endpoint, authorization, immutable collision, delay and failure
// behavior remains the existing actual-HTTP synthetic Drive model.
export class HttpFullSnapshotDrive extends HttpCatalogDrive {
  async respond(target,options,category,id,row) {
    const file=this.files.get(id);
    if(category!=='update'||file?.metadata.appProperties?.financeTrackerKind!=='finance-tracker-full-snapshot-manifest')
      return super.respond(target,options,category,id,row);
    assert.equal(target.searchParams.get('uploadType'),'multipart');
    const {metadata,bytes}=await this.multipart(options);
    if(metadata.appProperties?.financeTrackerKind!==undefined)
      assert.equal(metadata.appProperties.financeTrackerKind,'finance-tracker-full-snapshot-manifest');
    if(metadata.id!==undefined)assert.equal(metadata.id,id);
    if(metadata.parents!==undefined)assert.deepEqual(metadata.parents,[this.folderId]);
    Object.assign(file.metadata,metadata);file.bytes=bytes;
    file.metadata.version=String(BigInt(file.metadata.version)+1n);
    file.metadata.size=String(bytes.length);
    this.mutate();
    const responseBytes=new TextEncoder().encode(JSON.stringify(structuredClone(file.metadata)));
    return new Response(responseBytes,{status:200,headers:{'Content-Type':'application/json','Content-Length':String(responseBytes.length)}});
  }
}
