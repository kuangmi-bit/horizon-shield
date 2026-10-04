// gen_edge_bundles.mjs : conformance-v0 adversary. Builds freshly signed bundles that reach the deep rules of
// provenance-v0/VERIFIER.md (timestamps, window edges, null versus absent, evidence shapes, action_binding, R3/R4
// edges, linkage forms, preflight). Each bundle is validly signed, so a difference between two verifiers on it is a
// difference in rules, never a broken hash. Keys are fresh on every run; the point is the differential, not a frozen
// expectation. Run: node gen_edge_bundles.mjs [out.json]
import { writeFileSync } from "node:fs";
import { evidenceId } from "../task-delegation-bind-v0/bind.mjs";
import { newAgentKey, signObservation, signEdge } from "../task-delegation-bind-v0/sign.mjs";
import { grantRef, receiptId } from "../task-execution-bind-v0/bind_exec.mjs";
import { signGrant, signReceipt } from "../task-execution-bind-v0/sign_exec.mjs";
import { intentId, signIntent } from "../task-execution-bind-v0/preflight.mjs";
import { didKeyEncode, rawFromKeyObject } from "../task-delegation-bind-v0/verify_fixture.mjs";
const REF="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const ACTION={tool:"a2a.invoke",target:"/task",args_sha256:"x"};
function did(){const k=newAgentKey();return {k,id:didKeyEncode(rawFromKeyObject(k.publicKey))};}
const A=did(),B=did(),C=did(),W1=did(),W2=did();const P={};for(const x of [A,B,C,W1,W2])P[x.id]=x.k.privateKey;
const T="task_diff";
function mk(o={}){
  const g={schema:"task-execution-bind-v0/grant",task_id:T,action:o.gaction===undefined?ACTION:o.gaction,caller_id:(o.selfauth?B:A).id,provider_id:o.provider===undefined?B.id:o.provider,nonce:"n",not_before:o.nb===undefined?"2026-10-04T00:00:00Z":o.nb,not_after:o.na===undefined?"2026-10-04T01:00:00Z":o.na};
  if(o.delprov) delete g.provider_id; if(o.delnb) delete g.not_before;
  g.grant_ref=grantRef(g); const grant=signGrant(g,(o.selfauth?B:A).k.privateKey);
  const r={schema:"task-execution-bind-v0/receipt",task_id:T,grant_ref:grant.grant_ref,executed_action:o.raction===undefined?ACTION:o.raction,outcome:{status:"completed",result_sha256:"r"},provider_id:B.id,executed_at:o.at===undefined?"2026-10-04T00:30:00Z":o.at};
  if(o.ev!==undefined) r.outcome.evidence=o.ev; else r.outcome.evidence={kind:"ledger_record",ref:REF,system:"s"};
  if(o.delat) delete r.executed_at; if(o.ab!==undefined) r.action_binding=o.ab;
  r.receipt_id=receiptId(r); const receipt=signReceipt(r,B.k.privateKey);
  const ob=(x)=>{const q={task_id:T,hop:{seq:x.seq,from:x.from,to:x.to},prev_evidence_id:x.prev===undefined?null:x.prev,conduct:{verdict:x.v,detail_ref:x.ref===undefined?null:x.ref},witness_id:x.w,observed_at:"2026-10-04T00:30:00Z"}; if(x.delprev) delete q.prev_evidence_id; if(x.delv) delete q.conduct.verdict; q.evidence_id=evidenceId(q); return signEdge(signObservation(q,P[x.w]),P[x.from]);};
  const h0=ob({seq:o.seq0===undefined?0:o.seq0,from:A.id,to:B.id,w:W1.id,v:"pass",ref:o.link===undefined?"nenrin-exec://"+receipt.receipt_id:o.link,delprev:o.delprev,delv:o.delv});
  const h1=ob({seq:1,from:B.id,to:C.id,w:W2.id,v:"pass",prev:h0.evidence_id});
  const b={task_id:T,observations:[h0,h1],grant,receipt};
  if(o.intent){const i={schema:"task-execution-bind-v0/intent",task_id:T,grant_ref:grant.grant_ref,proposed_action:o.iaction===undefined?ACTION:o.iaction,provider_id:B.id,declared_at:o.dat===undefined?"2026-10-04T00:20:00Z":o.dat}; i.intent_id=intentId(i); b.intent=signIntent(i,B.k.privateKey);}
  return b;
}
const C2=[];const add=(n,o)=>C2.push({name:"signed|"+n,bundle:mk(o)});
add("base",{});
for (const at of ["2026-02-30T00:30:00Z","2026-10-04T24:00:00Z","2026-10-04T00:30:00.9999Z","2026-10-04T00:30:00+00:00","2026-10-04t00:30:00z","2026-10-04T01:00:00.0004Z","2026-10-04T01:00:00Z","2026-10-04T00:00:00Z","2026-10-04T00:30:00Z\n","0000-01-01T00:00:00Z",""]) add("at="+JSON.stringify(at),{at});
add("del executed_at",{delat:true}); add("nb=null",{nb:null}); add("del nb",{delnb:true}); add("na=2026-02-30",{na:"2026-02-30T00:00:00Z"});
add("provider=null",{provider:null}); add("del provider",{delprov:true}); add("selfauth",{selfauth:true}); add("selfauth+diverge",{selfauth:true,raction:{tool:"x"}});
add("ev={}",{ev:{}}); add("ev=null",{ev:null}); add("ev=0",{ev:0}); add("ev upper hex",{ev:{kind:"ledger_record",ref:REF.toUpperCase(),system:"s"}}); add("ev extra key",{ev:{kind:"ledger_record",ref:REF,system:"s",x:1}}); add("ev system empty",{ev:{kind:"ledger_record",ref:REF,system:""}});
add("ab=null",{ab:null}); add("ab={}",{ab:{}});
add("gaction=null",{gaction:null,raction:null}); add("gaction missing both",{gaction:0,raction:0});
add("seq0='0'",{seq0:"0"}); add("del prev0",{delprev:true}); add("del verdict0",{delv:true});
add("upper link",{link:"NENRIN-EXEC://"+"0".repeat(64)}); add("no link",{link:null}); add("link other scheme",{link:"nenrin://x"});
add("intent ok",{intent:true}); add("intent dat=2026-02-30",{intent:true,dat:"2026-02-30T00:00:00Z"}); add("intent diverge",{intent:true,iaction:{tool:"y"}}); add("intent selfauth",{intent:true,selfauth:true});
const out=process.argv[2]||"edge_bundles.json"; writeFileSync(out,JSON.stringify(C2)); console.log("wrote "+C2.length+" signed edge bundles to "+out);
