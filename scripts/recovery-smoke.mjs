// Optional real WebSocket check; takes about 22 seconds to exercise the grace period.
import assert from 'node:assert/strict';
const base = process.argv[2] ?? 'http://127.0.0.1:8787', clients = [];
const pause = ms => new Promise(r => setTimeout(r, ms));
async function until(f) { for (let i=0;i<400;i++) { if(f()) return; await pause(25); } throw new Error('Room update timed out'); }
async function post(path, name) { const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})});assert.equal(r.status,200);return r.json(); }
async function connect(seat) {
  const c={seat,state:null,errors:[],acks:new Set(),ws:new WebSocket(base.replace(/^http/,'ws')+`/rooms/${seat.code}/ws`)};clients.push(c);
  c.ws.onopen=()=>c.ws.send(JSON.stringify({type:'auth',...seat}));
  c.ws.onmessage=e=>{if(e.data==='pong')return;const m=JSON.parse(e.data);if(m.type==='state')c.state=m.state;if(m.type==='error')c.errors.push(m.error);if(m.type==='ack')c.acks.add(m.id);};
  await until(()=>c.state);return c;
}
async function act(c,action,reject=false) {
  const id=crypto.randomUUID(),errors=c.errors.length;
  c.ws.send(JSON.stringify({type:'action',id,version:c.state.version,action}));
  await until(()=>c.acks.has(id)||c.errors.length>errors);
  assert.equal(c.errors.length>errors,reject,c.errors.at(-1));await pause(70);
}
try {
  const host=await connect(await post('/rooms','Recovery host'));
  let absent=await connect(await post(`/rooms/${host.seat.code}/join`,'Recovery guest'));
  const backup=await connect(await post(`/rooms/${host.seat.code}/join`,'Recovery backup'));
  for(const c of clients)await act(c,{type:'ready'});
  await act(host,{type:'start'});
  for(const c of [host,backup]){await act(c,{type:'reveal-initial'});await act(c,{type:'close-initial'});}
  const recover={type:'recover-player',playerId:absent.seat.playerId};
  absent.ws.close();await until(()=>host.state.disconnectedAt[recover.playerId]!==undefined);
  await act(host,recover,true);
  absent=await connect(absent.seat);
  await until(()=>host.state.disconnectedAt[recover.playerId]===undefined);
  await act(host,recover,true);
  absent.ws.close();await until(()=>host.state.disconnectedAt[recover.playerId]!==undefined);
  await pause(20100);
  await act(backup,recover,true);
  await act(host,recover);
  await until(()=>host.state.phase==='playing');
  assert.equal(host.state.players.find(p=>p.id===recover.playerId).count,4);
  host.ws.close();await until(()=>backup.state.hostId===backup.seat.playerId);
  console.log('PASS: server rejects early, reconnected, and non-host recovery; allows recovery after 20 continuous seconds and preserves the seat. Host handoff works.');
} finally {for(const c of clients)c.ws.close();}
