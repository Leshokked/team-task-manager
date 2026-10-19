import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import vm from 'node:vm';

export function setup(snapshot, details = {}) {
 const sql = new DatabaseSync(':memory:');
 sql.exec(readFileSync('cloudflare/schema/0001_schema.sql', 'utf8'));
 sql.exec("INSERT INTO meta(key,value) VALUES ('current_week','2026-07-27')");
 const rows = snapshot?.tasks || [
  {id:'11657f1eb063',week:'2026-07-27',person:'angela',title:'Historical task',status:'todo',day:'Mon'},
  {id:'b84ffc647ad6',week:'2026-07-27',person:'angela',title:'Private record',status:'todo',day:'Any'}
 ];
 for(const t of rows){const keys=Object.keys(t);sql.prepare(`INSERT INTO tasks(${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).run(...Object.values(t))}
 for(const [taskId,d] of Object.entries(details))for(const table of ['checklist','comments'])for(const row of d[table]){
  const keys=Object.keys(row);sql.prepare(`INSERT INTO ${table}(${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).run(...Object.values(row));
 }
 const refresh=readFileSync('cloudflare/schema/0002_seed.sql','utf8');
 const before=sql.prepare("SELECT * FROM tasks WHERE week='2026-07-27'").all();
 sql.exec(refresh);sql.exec(refresh);
 assert.deepEqual(sql.prepare("SELECT * FROM tasks WHERE week='2026-07-27'").all(),before,'old records remain byte-for-byte equivalent');
 const db={prepare(query){
  const statement=sql.prepare(query);let values={};
  const op={bind(...args){values=Object.fromEntries(args.map((v,i)=>[String(i+1),v]));return op},
   async first(){return statement.get(values)||null},
   async all(){return {results:statement.all(values)}},
   async run(){return {meta:statement.run(values)}}};return op;
 },async batch(items){sql.exec('BEGIN');try{const r=[];for(const x of items)r.push(await x.run());sql.exec('COMMIT');return r}catch(e){sql.exec('ROLLBACK');throw e}}};
 const source=readFileSync('cloudflare/worker.js','utf8').replace('export default {','const worker = {');
 const context=vm.createContext({Response,Request,URL,crypto,fetch(){throw new Error('Unexpected network / Slack call')},console});
 const {worker,page}=vm.runInContext(source+'\n({worker, page:PAGE})',context);
 for(const [,script] of page.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(script);
 return {sql,db,worker,page};
}
export async function runChecks(){
 const {sql,db,worker,page}=setup();
 const request=(path,method='GET',body)=>worker.fetch(new Request('https://example.test'+path,{method, ...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})}),{DB:db,SLACK_WEBHOOK_URL:'should-not-call'},{});
 let r=await request('/api/board');assert.equal(r.status,200);const board=await r.json();
 assert.equal(board.week,'2026-10-19');assert.equal(board.tasks.length,11);
 assert.equal(board.tasks.filter(t=>t.status==='unverified').length,8);
 assert.equal(board.tasks.some(t=>t.person==='riley'),false);
 const isaiah=board.tasks.find(t=>t.person==='isaiah');assert.equal(isaiah.helper,'carlos');assert.equal(isaiah.day,'Any');assert.equal(isaiah.due_date,null);
 const planning=board.tasks.find(t=>t.id==='oct19-planning');assert.equal(planning.due_date,null);assert.match(planning.notes,/not an explicitly agreed deadline/);
 assert.match(board.brief.coverage,/status to confirm/);assert.match(board.brief.milestone,/Cookbook/);
 r=await request('/api/archive');assert.equal(r.status,200);const archive=await r.json();assert.equal(archive.tasks.length,1);assert.equal(archive.tasks[0].status,'todo');
 assert.equal((await request('/api/tasks/b84ffc647ad6/detail')).status,404);
 assert.equal((await request('/api/archive?week=2026-10-19')).status,404);
 assert.equal((await request('/api/tasks','POST',{person:'isaiah',helper:'carlos',title:'Test Isaiah task',by:'Isaiah'})).status,200);
 assert.equal((await request('/api/tasks/oct19-strategy','PATCH',{status:'unverified',person:'isaiah',by:'Isaiah'})).status,200);
 // Re-running a deployment must not revert a later team change or reset a later week.
 sql.exec("UPDATE tasks SET status='done' WHERE id='oct19-cmd';UPDATE meta SET value='2026-10-26' WHERE key='current_week'");
 sql.exec(readFileSync('cloudflare/schema/0002_seed.sql','utf8'));
 assert.equal(sql.prepare("SELECT status FROM tasks WHERE id='oct19-cmd'").get().status,'done');
 assert.equal(sql.prepare("SELECT value FROM meta WHERE key='current_week'").get().value,'2026-10-26');
 assert.match(page,/Filter by/);assert.match(page,/Isaiah/);assert.match(page,/Task archive/);
 console.log('PASS: migration preservation and repeatability; active week; 11 reconciled tasks; Isaiah owner/helper/API; no Riley assignments; unverified dates/status; archive privacy; no Slack calls; Worker and browser script syntax.');
}
if(process.argv[1]?.endsWith('board.test.mjs'))await runChecks();
