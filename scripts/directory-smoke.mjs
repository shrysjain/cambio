import assert from 'node:assert/strict';
const base = process.argv[2] ?? 'http://127.0.0.1:8787', clients = [];
const pause = ms => new Promise(r => setTimeout(r, ms));
async function until(f) { for (let i=0;i<200;i++) { if(await f()) return; await pause(25); } throw new Error('Directory update timed out'); }
async function post(path, body) { const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); return {status:r.status,data:await r.json()}; }
async function connect(seat) { const c={seat,state:null,ws:new WebSocket(base.replace(/^http/,'ws')+`/rooms/${seat.code}/ws`)}; clients.push(c); c.ws.onopen=()=>c.ws.send(JSON.stringify({type:'auth',...seat})); c.ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.type==='state')c.state=m.state;};await until(()=>c.state);return c; }
const list=()=>fetch(base+'/rooms').then(r=>r.json()).then(d=>d.rooms);
try {
 const name='Directory check '+crypto.randomUUID().slice(0,6);
 const a=await post('/rooms',{name}), b=await post('/rooms',{name:name+' B'});
 assert.equal(a.status,200); assert.equal(b.status,200);
 const host=await connect(a.data); const other=await connect(b.data);
 let listing;
 await until(async()=>{listing=(await list()).find(r=>r.hostName===name);return !!listing;});
 assert.deepEqual(Object.keys(listing).sort(),['gameNumber','hostName','id','phase','players','private','updatedAt']);
 assert.equal(listing.players,1);assert.equal(listing.gameNumber,1);assert.equal(listing.private,true);assert.notEqual(listing.id,a.data.code);
 const wrong=await post(`/rooms/${b.data.code}/join`,{name:'Wrong room',roomId:listing.id});assert.equal(wrong.status,400);assert.match(wrong.data.error,/does not match/);
 const joined=await post(`/rooms/${a.data.code}/join`,{name:'Directory guest',roomId:listing.id});assert.equal(joined.status,200);
 const guest=await connect(joined.data);
 await until(async()=>(await list()).find(r=>r.id===listing.id)?.players===2);
 host.ws.close();guest.ws.close();other.ws.close();
 await until(async()=>!(await list()).some(r=>r.id===listing.id));
 console.log('PASS: private listings expose only summaries; selected-room code validation, player counts, and disconnect cleanup work.');
} finally { for(const c of clients)c.ws.close(); }
