// Non-destructive audit probes: isolated host, fake DSH/LLM, temporary state only.
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { apply } from 'file:///D:/App/DSH-agent-board/src/host/index.js'
const home = await mkdtemp(join(tmpdir(), 'dab-audit-'))
const oldHome = process.env.DSH_HOME, oldFetch = globalThis.fetch
process.env.DSH_HOME = home
const routes = new Map(), listeners = new Map(), live = new Map(), created = []
let proposals = [], pauseOnReply = false, host
const task = { id: 't1', title: 'audit', status: 'todo', workspaceId: 'w1', version: 1, dependsOn: [], permission: 'workspace-write', isolation: 'none', execution: { mode: 'claim' } }
async function call(method, path, body) {
  return new Promise((resolve, reject) => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]); req.method = method; req.url = '/dsh-agent-board/api/v2' + path; req.headers = {}
    let status; routes.get('/dsh-agent-board/api/v2').handler(req, {writeHead(c){status=c}, end(t){try{resolve({status,...JSON.parse(String(t))})}catch(e){reject(e)}}, on(){}})
  })
}
const ctx = {
 logger: {warn(){},info(){},error(){}}, connection: { requestRejection(){} },
 webServer: {getOrigin:()=> 'http://127.0.0.1:1', register:r=>{routes.set(r.path,r);return()=>routes.delete(r.path)}},
 effect(fn){const d=fn();return()=>d?.()}, on(e,f){listeners.set(e,f);return()=>{}},
 workspaceRegistry: {get:id=>id==='w1'?{id,path:home,attachSession:async()=>{}}:undefined,list:()=>[{id:'w1',path:home,title:'audit'}]},
 get(n){if(n==='agentDefaultModel')return {currentSelection:()=>({provider:'fake',model:'one'})}; if(n==='llm')return {listProviders:()=>[{id:'fake',name:'fake',locality:'local'}],listModels:async()=>[{id:'one'},{id:'two'}]};if(n==='sessions')return {get:()=>undefined}},
 agents: {get:id=>live.get(id),async create(o){created.push(o);const a={id:o.sessionId,inject(){},cancel(){},followup(){ if(!o.sessionId.startsWith('session-superagent-'))return;setTimeout(async()=>{if(pauseOnReply) await call('POST','/superagent/pause',{});const assessment={schemaVersion:1,situation:'audit',findings:[],proposals,decisions:[],directiveEcho:[],noopReason:null};listeners.get('session/event')?.({id:o.sessionId},{type:'assistant/message',time:Date.now(),data:{message:{content:[{type:'text',text:JSON.stringify(assessment)}]}}});listeners.get('session/event')?.({id:o.sessionId},{type:'turn/end',time:Date.now(),data:{reason:{kind:'completed'}}})},5)}};live.set(o.sessionId,a);return{agent:a,dispose:async()=>{}}}}
}
globalThis.fetch=async url=>String(url).includes('/dsh-taskboard/state')?{ok:true,status:200,json:async()=>({ok:true,value:{revision:1,tasks:[task]}})}:{ok:false,status:404,json:async()=>({})}
try {
 host=apply(ctx,{baseUrl:'http://127.0.0.1:1',mandate:{scopeMode:'selected',selectedWorkspaces:['w1'],level:'L4',actions:{launch:true,create_task:true,comment:true},projects:{w1:{enabled:true,level:'L4',budget:{maxTasksPerHour:100}}},requiresConfiguration:false}})
 await call('GET','/state');await call('POST','/mode',{mode:'autonomous'})
 proposals=[{action:'create_task',projectId:'w1',taskId:null,rationale:'audit',risk:'low',expectedEffect:'new card',requiresApproval:false}]
 const unsupported=await call('POST','/superagent/cycle',{})
 assert.equal(unsupported.value.executed[0].reason,'no_adapter_for_action')
 console.log('CONFIRMED: granted create_task reaches no_adapter_for_action')
 const first=created.find(x=>x.sessionId.startsWith('session-superagent-'))
 const changed=await call('POST','/superagent/model',{provider:'fake',model:'two',fallback:[{provider:'fake',model:'one'}]})
 assert.equal(changed.ok,true)
 proposals=[];await call('POST','/superagent/cycle',{})
 assert.equal(created.filter(x=>x.sessionId.startsWith('session-superagent-')).length,1)
 assert.equal(first.agentOptions.model,'one')
 console.log('CONFIRMED: saved model two, next cycle still reuses model one')
 // A second distinct card avoids the duplicate-assignment guard of the final probe.
 task.id='blocked-card';task.status='backlog';task.blocked=true;task.waitingForHuman=true;task.dependsOn=['missing-prerequisite']
 proposals=[{action:'launch',projectId:'w1',taskId:'blocked-card',rationale:'audit',risk:'low',expectedEffect:'session',requiresApproval:false}]
 const unready=await call('POST','/superagent/cycle',{})
 assert.equal(unready.value.executed[0].ok,true)
 console.log('CONFIRMED: Super Agent launches backlog + blocked + waitingForHuman + missing prerequisite card')
 task.id='t1';task.status='todo';task.blocked=false;task.waitingForHuman=false;task.dependsOn=[]
 proposals=[{action:'launch',projectId:'w1',taskId:'t1',rationale:'audit',risk:'low',expectedEffect:'session',requiresApproval:false}];pauseOnReply=true
 const paused=await call('POST','/superagent/cycle',{})
 assert.equal(paused.value.executed[0].ok,true)
 console.log('CONFIRMED: pause during assessment does not prevent subsequent worker launch')
 console.log(JSON.stringify({unsupported:unsupported.value.executed,modelActual:first.agentOptions.model,pausedLaunch:paused.value.executed},null,2))
} finally {
 host?.();globalThis.fetch=oldFetch;if(oldHome===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=oldHome
 // Exact directory is the unique temporary directory created at startup.
 await rm(home,{recursive:true,force:true})
}
