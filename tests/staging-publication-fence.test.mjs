import test from 'node:test';
import assert from 'node:assert/strict';
import {setupHttpCanonicalWorkbench} from './helpers/pr28-http-workbench.mjs';
import {CanonicalLedgerStore} from '../js/canonical-ledger-storage.mjs';
import {CanonicalWorkspaceSession} from '../js/canonical-workspace-session.mjs';
import {replayFixture} from './helpers/ledger-replay-fixtures.mjs';

test('remote ownership change during immutable staging cannot publish the edited ledger',async()=>{
  const h=await setupHttpCanonicalWorkbench(),store=new CanonicalLedgerStore({lifecycle:h.lifecycle});
  await store.load();await store.save(replayFixture(2).ledger);
  const session=new CanonicalWorkspaceSession({storage:{lifecycle:h.lifecycle}});await session.loadVerified();
  session.correct({activityId:session.ledger.activities[0].activityId,type:'classification',activityKind:'spending',rationale:'Invented fence test'});
  const before=h.http.json(h.manifestFileId),inspect=h.lifecycle.coordinator.inspect.bind(h.lifecycle.coordinator);
  let taken=false;
  h.lifecycle.transactionAdapter.afterMutation=async({operation,kind})=>{if(operation==='create'&&kind==='snapshot-object')taken=true;};
  h.lifecycle.coordinator.inspect=async()=>{
    const result=await inspect();
    return taken&&result.record?{...result,record:{...result.record,sessionId:'invented-other-owner'}}:result;
  };
  await assert.rejects(session.save());
  assert.equal(taken,true);
  assert.equal(h.http.json(h.manifestFileId).revision,before.revision);
  assert.equal(session.dirty,true);
  assert.equal(h.lifecycle.coordinator.canWrite,false);
});
