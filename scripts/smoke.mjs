// Real network check against `npm run dev:api`. No browser automation or fake server state.
import assert from 'node:assert/strict';

const base = process.env.GAME_SERVER || 'http://127.0.0.1:8787';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, timeout = 10000) {
  const start = Date.now();
  while (!predicate()) { if (Date.now() - start > timeout) throw new Error('Timed out waiting for server state.'); await pause(15); }
}
async function post(path, body) {
  const response = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Origin': 'http://127.0.0.1:3000' }, body: JSON.stringify(body) });
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://127.0.0.1:3000');
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  return result;
}
async function connect(seat) {
  const client = { seat, ws: new WebSocket(`${base.replace(/^http/, 'ws')}/rooms/${seat.code}/ws`), state: null, acks: new Set(), errors: [] };
  client.ws.onopen = () => client.ws.send(JSON.stringify({ type: 'auth', ...seat }));
  client.ws.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.type === 'state') client.state = message.state;
    if (message.type === 'ack') client.acks.add(message.id);
    if (message.type === 'error') client.errors.push(message.error);
  };
  await until(() => client.state);
  return client;
}
async function action(client, command) {
  const id = crypto.randomUUID(), oldErrors = client.errors.length;
  client.ws.send(JSON.stringify({ type: 'action', id, version: client.state.version, action: command }));
  await until(() => client.acks.has(id) || client.errors.length > oldErrors);
  assert.equal(client.errors.length, oldErrors, client.errors.at(-1));
  // Exercise human-speed play rather than intentionally tripping the abuse limit.
  await pause(45);
}
async function play(count) {
  const clients = [];
  try {
    const host = await post('/rooms', { name: `Test host ${count}` });
    clients.push(await connect(host));
    for (let i = 1; i < count; i++) clients.push(await connect(await post(`/rooms/${host.code}/join`, { name: `Test friend ${i}` })));
    for (const c of clients) await action(c, { type: 'ready' });
    await action(clients[0], { type: 'start' });
    await until(() => clients.every(c => c.state.phase === 'peek'));
    for (const c of clients) {
      await action(c, { type: 'reveal-initial' });
      await until(() => c.state.players.find(p => p.id === c.seat.playerId).initial === 'viewing');
      assert.equal(c.state.players.find(p => p.id === c.seat.playerId).hand.filter(h => h?.face).length, 2);
      assert.ok(c.state.players.filter(p => p.id !== c.seat.playerId).every(p => p.hand.every(h => !h?.face)));
      await action(c, { type: 'close-initial' });
    }
    await until(() => clients.every(c => c.state.phase === 'playing'));
    // Reconnect a real seat; no initial card may be revealed again.
    const replacement = await connect(clients[1].seat);
    clients[1] = replacement;
    assert.ok(replacement.state.players.every(p => p.hand.every(h => !h?.face)));
    let turns = 0;
    while (clients[0].state.phase === 'playing') {
      assert.ok(turns++ < 60, 'A single-deck game should terminate.');
      const active = clients.find(c => c.seat.playerId === clients[0].state.activeId);
      await action(active, { type: 'draw' });
      await until(() => active.state.drawn);
      for (const c of clients) if (c !== active) assert.equal(c.state.drawn, null);
      await action(active, { type: 'discard' });
      await until(() => active.state.drawn === null);
      if (active.state.power) await action(active, { type: 'skip-power' });
      await until(() => clients[0].state.activeId !== active.seat.playerId || clients[0].state.phase !== 'playing');
    }
    await until(() => clients.every(c => c.state.phase === 'finished'), 8000);
    assert.ok(clients[0].state.winners.length);
    assert.ok(clients[0].state.players.every(p => p.hand.every(h => !h || h.face)));
    const winners = clients[0].state.winners;
    for (const c of clients) await action(c, { type: 'ready' });
    await until(() => clients.every(c => c.state.phase === 'peek' && c.state.gameNumber === 2));
    assert.ok(winners.includes(clients[0].state.activeId));
    assert.ok(clients.every(c => c.state.players.every(p => p.hand.every(h => !h?.face))));
    console.log(`PASS ${count}-player room: join, ready, private peeks, reconnect, full game, scoring, rematch`);
  } finally { for (const c of clients) c.ws.close(); }
}
const counts = process.argv.slice(2).map(Number);
for (const count of counts.length ? counts : [2, 6, 10]) await play(count);
