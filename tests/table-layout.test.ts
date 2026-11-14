import test from 'node:test';
import assert from 'node:assert/strict';
import { handPosition, handViewport, tableLayout, resultTitle, turnTitle, matchActivity } from '../lib/table-layout.ts';

test('desktop seats remain within the table and separate with large hands, for 2–10 players', () => {
  for (const width of [1024, 1280, 1440, 1920]) for (const height of [640, 768, 900, 1080]) for (let n = 1; n <= 9; n++) {
    const w = Math.min(1400, width - 64) - 14, h = Math.max(650, height - 156) - 14;
    const layout = tableLayout(n, w, h);
    const bounds = layout.seats.map(seat => {
      const box = handViewport(54, layout.cardWidth, 7, seat.cap, true);
      const frameHeight = 2 * layout.cardHeight + 7 + 30;
      const angle = seat.tilt * Math.PI / 180;
      const corners = [[-box.origin, -frameHeight / 2], [box.visible + 20 - box.origin, -frameHeight / 2], [-box.origin, frameHeight / 2], [box.visible + 20 - box.origin, frameHeight / 2]];
      const points = corners.map(([x, y]) => ({ x: seat.x + x * Math.cos(angle) - y * Math.sin(angle), y: seat.y + 44 + frameHeight / 2 + x * Math.sin(angle) + y * Math.cos(angle) }));
      return { left: Math.min(...points.map(p => p.x)), right: Math.max(...points.map(p => p.x)), top: Math.min(...points.map(p => p.y)), bottom: Math.max(...points.map(p => p.y)) };
    });
    for (const b of bounds) assert.ok(b.left >= 0 && b.right <= w && b.top >= 0 && b.bottom <= h, `Outside ${width}×${height}, ${n + 1} players: ${JSON.stringify(b)}`);
    for (let i = 0; i < bounds.length; i++) for (let j = i + 1; j < bounds.length; j++) {
      const a = bounds[i], b = bounds[j];
      assert.ok(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top, `Seats ${i}/${j} overlap at ${width}×${height}, ${n + 1} players`);
    }
  }
});

test('penalties up to a full deck keep the original slots anchored in either viewing direction', () => {
  for (const opposite of [false, true]) for (const cap of [100, 122, 180, 320]) {
    const original = handViewport(4, 44, 7, cap, opposite);
    for (const slots of [5, 6, 10, 24, 54]) {
      const box = handViewport(slots, 44, 7, cap, opposite);
      const scroll = opposite ? box.total - box.visible : 0;
      for (let i = 0; i < 4; i++) {
        const column = handPosition(i, opposite).column;
        assert.equal(box.left + box.canvas + column * 51 - scroll, original.left + original.canvas + column * 51);
      }
      assert.ok(box.visible <= Math.max(95, cap));
    }
  }
});

test('tab titles identify only your connected active turn and result titles have no periods', () => {
  assert.equal(turnTitle('playing', 'a', 'a', true), 'Your turn · Cambio');
  for (const phase of ['lobby', 'peek', 'ending', 'finished']) assert.equal(turnTitle(phase, 'a', 'a', true), 'Cambio');
  assert.equal(turnTitle('playing', 'b', 'a', true), 'Cambio');
  assert.equal(turnTitle('playing', 'a', 'a', false), 'Cambio');
  assert.equal(resultTitle(['a'], [{ id: 'a', name: 'A long winner name' }]), 'A long winner name takes the table');
  assert.equal(resultTitle(['a', 'b'], []), 'A shared victory');
  assert.equal(resultTitle(['gone'], []), 'The winner takes the table');
});

test('rapid matching activity distinguishes the actor, owner, slot, penalties, and transfers', () => {
  const players = [{ id: 'a', name: 'Alex' }, { id: 'b', name: 'Sam' }];
  const event = { id: '1', actorId: 'a', at: 1000, kind: 'match' as const, moves: [{ from: { playerId: 'b', slot: 3 }, to: 'discard' as const }] };
  assert.equal(matchActivity(event, players), 'Alex matched Sam’s #4');
  assert.equal(matchActivity({ ...event, kind: 'penalty' }, players), 'Alex missed Sam’s #4 · penalty card');
  assert.equal(matchActivity({ ...event, moves: [{ from: { playerId: 'a', slot: 1 }, to: 'discard' }] }, players), 'Alex matched their own #2');
  assert.equal(matchActivity({ ...event, kind: 'give', moves: [{ from: { playerId: 'a', slot: 0 }, to: { playerId: 'b', slot: 3 } }] }, players), 'Alex gave #1 to Sam’s #4');
});
