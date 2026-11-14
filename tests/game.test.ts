import test from 'node:test';
import assert from 'node:assert/strict';
import { addPlayer, applyAction, finishIfDue, newGame, score, shuffledDeck, syncPresence, value, viewFor, type Card, type Game } from '../lib/game.ts';
import { createRoomCode, normalizeRoomCode, validRoomCode } from '../lib/room-code.ts';
import { handColumns, handPosition } from '../lib/table-layout.ts';

const card = (rank: number, suit: Card['suit'] = 'clubs'): Card => ({ rank, suit });
test('finished winner names survive seat removal, persistence, and legacy-room fallback', () => {
  const g = playing(); g.players[1].hand = [card(13, 'hearts')]; g.players[0].hand = [card(3)]; g.players[2].hand = [card(4)];
  applyAction(g, 'a', { type: 'end-game' }, 1000); finishIfDue(g, 6000);
  applyAction(g, 'a', { type: 'remove', playerId: 'b' });
  assert.deepEqual(viewFor(g, 'a').resultWinners, [{ id: 'b', name: 'Player 2' }]);
  const restored = JSON.parse(JSON.stringify(g)) as Game;
  assert.deepEqual(viewFor(restored, 'a').resultWinners, [{ id: 'b', name: 'Player 2' }]);
  delete restored.resultWinners;
  assert.deepEqual(viewFor(restored, 'a').resultWinners, [{ id: 'b', name: 'Player 2' }]);
});
test('recovery requires the host and 20 continuous offline seconds; hands and win eligibility survive', () => {
  const g = playing(); g.active = 1;
  g.players[0].hand = [card(8)]; g.players[1].hand = [card(13, 'hearts'), null]; g.players[2].hand = [card(9)];
  syncPresence(g, ['a', 'c'], 1000); syncPresence(g, ['a', 'c'], 9000);
  assert.equal(g.disconnectedAt?.b, 1000);
  assert.throws(() => applyAction(g, 'a', { type: 'recover-player', playerId: 'b' }, 20999), /20 seconds/);
  syncPresence(g, ['a', 'b', 'c'], 15000);
  assert.throws(() => applyAction(g, 'a', { type: 'recover-player', playerId: 'b' }, 25000), /20 seconds/);
  syncPresence(g, ['a', 'c'], 16000);
  assert.throws(() => applyAction(g, 'a', { type: 'recover-player', playerId: 'b' }, 35999), /20 seconds/);
  assert.throws(() => applyAction(g, 'c', { type: 'recover-player', playerId: 'b' }, 36000), /Only the host/);
  const hand = structuredClone(g.players[1].hand);
  applyAction(g, 'a', { type: 'recover-player', playerId: 'b' }, 36000);
  assert.equal(g.active, 2); assert.equal(g.turns, 1); assert.deepEqual(g.players[1].hand, hand);
  assert.throws(() => applyAction(g, 'a', { type: 'recover-player', playerId: 'b' }, 36001), /not holding up/);
  applyAction(g, 'a', { type: 'end-game' }, 37000); finishIfDue(g, 42000);
  assert.deepEqual(g.winners, ['b']); assert.equal(g.session?.players.b.wins, 1);
});

test('recovering the final drawn card discards without activating its power and keeps the final match window', () => {
  const g = playing(); g.active = 1; g.deck = [card(12)];
  applyAction(g, 'b', { type: 'draw' }, 1000); syncPresence(g, ['a', 'c'], 1000);
  const hands = structuredClone(g.players.map(p => p.hand));
  applyAction(g, 'a', { type: 'recover-player', playerId: 'b' }, 21000);
  assert.equal(g.discards.at(-1)?.rank, 12); assert.equal(g.drawn, null); assert.equal(g.power, null);
  assert.deepEqual(g.players.map(p => p.hand), hands);
  assert.equal(g.phase, 'ending'); assert.equal(g.deadline, 26000); assert.equal(g.opportunity?.open, true);
});

test('recovery cancels private power peeks and completes abandoned initial peeks without revealing hands', () => {
  const g = playing(); g.active = 1; discard(g, 13);
  applyAction(g, 'b', { type: 'peek', target: { playerId: 'b', slot: 0 } });
  const hands = structuredClone(g.players.map(p => p.hand));
  syncPresence(g, ['a', 'c'], 1000);
  applyAction(g, 'a', { type: 'recover-player', playerId: 'b' }, 21000);
  assert.equal(g.power, null); assert.deepEqual(g.players.map(p => p.hand), hands);
  assert.ok(viewFor(g, 'b').players.every(p => p.hand.every(c => !c?.face && !c?.peekedBy)));
  const initial = table();
  for (const id of ['a', 'c']) { applyAction(initial, id, { type: 'reveal-initial' }); applyAction(initial, id, { type: 'close-initial' }); }
  syncPresence(initial, ['a', 'c'], 1000);
  const original = structuredClone(initial.players[1].hand);
  applyAction(initial, 'a', { type: 'recover-player', playerId: 'b' }, 21000);
  assert.equal(initial.phase, 'playing'); assert.equal(initial.players[1].initial, 'done');
  assert.deepEqual(initial.players[1].hand, original);
  assert.ok(viewFor(initial, 'b').players[1].hand.every(c => !c?.face));
});

test('recovering an off-turn transfer preserves the active power and hides the randomly given card', () => {
  const g = playing(); discard(g, 7); g.players[1].hand = [null, card(9), null]; g.players[2].hand[0] = card(7);
  applyAction(g, 'b', { type: 'match', target: { playerId: 'c', slot: 0 }, opportunityId: g.opportunity!.id }, 1000);
  syncPresence(g, ['a', 'c'], 1000);
  applyAction(g, 'a', { type: 'recover-player', playerId: 'b' }, 21000);
  assert.equal(g.transfer, null); assert.equal(g.active, 0); assert.equal(g.power?.rank, 7);
  assert.deepEqual(g.players[1].hand, [null, null, null]); assert.equal(g.players[2].hand[0]?.rank, 9);
  for (const id of ['a', 'b', 'c']) assert.equal(viewFor(g, id, 21000).players[2].hand[0]?.face, null);
});

test('recovery can complete a transfer after the final deadline and score exactly once', () => {
  const g = playing(); discard(g, 7); g.players[1].hand = [card(3)]; g.players[2].hand[0] = card(7);
  applyAction(g, 'a', { type: 'end-game' }, 1000);
  applyAction(g, 'b', { type: 'match', target: { playerId: 'c', slot: 0 }, opportunityId: g.opportunity!.id }, 1001);
  syncPresence(g, ['a', 'c'], 1001);
  assert.equal(finishIfDue(g, 6000), false);
  applyAction(g, 'a', { type: 'recover-player', playerId: 'b' }, 21001);
  assert.equal(g.phase, 'finished'); assert.equal(g.transfer, null); assert.equal(g.session?.games, 1);
  assert.equal(finishIfDue(g, 22000), false); assert.equal(g.session?.games, 1);
});
test('session scores count outright wins, tied wins, signed points, and each game exactly once', () => {
  const g = playing();
  g.players[0].hand = [card(13, 'hearts'), null]; g.players[1].hand = [card(0, 'joker')]; g.players[2].hand = [card(3)];
  applyAction(g, 'a', { type: 'end-game' }, 1000);
  assert.ok(finishIfDue(g, 6000)); assert.equal(finishIfDue(g, 6001), false);
  assert.deepEqual(g.session?.players.a, { id: 'a', name: 'Alex', wins: 1, ties: 0, points: -1, games: 1 });
  for (const p of g.players) applyAction(g, p.id, { type: 'ready' }, 6002);
  assert.equal(g.session?.games, 1);
  g.players[0].hand = [card(2)]; g.players[1].hand = [card(2)]; g.players[2].hand = [card(4)];
  applyAction(g, 'a', { type: 'end-game' }, 7000); finishIfDue(g, 12000);
  assert.equal(g.session?.games, 2);
  assert.deepEqual(g.session?.players.a, { id: 'a', name: 'Alex', wins: 1, ties: 1, points: 1, games: 2 });
  assert.deepEqual(g.session?.players.b, { id: 'b', name: 'Player 2', wins: 0, ties: 1, points: 2, games: 2 });
  assert.equal(g.session?.players.c.points, 7);
  assert.deepEqual(viewFor(g, 'a').session, viewFor(g, 'b').session);
  const restored = JSON.parse(JSON.stringify(g)) as Game;
  applyAction(restored, 'a', { type: 'remove', playerId: 'c' });
  addPlayer(restored, 'd', 'Dana');
  assert.equal(restored.session?.players.c.points, 7);
  assert.equal(restored.session?.players.d, undefined);
  assert.equal(restored.session?.games, 2);
});

test('legacy rooms start session tracking at their next finish and never publish live hand totals', () => {
  const g = playing(); delete g.session;
  assert.deepEqual(viewFor(g, 'a').session, { games: 0, players: [] });
  applyAction(g, 'a', { type: 'end-game' }, 1000); finishIfDue(g, 6000);
  const totals = structuredClone(viewFor(g, 'a').session);
  for (const p of g.players) applyAction(g, p.id, { type: 'ready' }, 6001);
  g.players[0].hand = [card(13, 'hearts')];
  assert.deepEqual(viewFor(g, 'b').session, totals);
  assert.equal(viewFor(g, 'b').players[0].score, null);
});
test('new room codes are four characters and existing invitations stay valid', () => {
  for (let i = 0; i < 20; i++) { const code = createRoomCode(); assert.match(code, /^[A-Z0-9]{4}$/); assert.ok(validRoomCode(code)); }
  assert.equal(normalizeRoomCode(' ab-7k '), 'AB7K');
  assert.ok(validRoomCode('AB7K')); assert.ok(validRoomCode('ABCDEFGH23'));
  for (const bad of ['ABC', 'ABCDE', 'AB!K', '../x', 'abcdefgh23']) assert.equal(validRoomCode(bad), false);
});
test('opponent slots face the viewer and penalty columns never move existing positions', () => {
  assert.deepEqual([0, 1, 2, 3].map(i => handPosition(i)), [{ row: 0, column: 0 }, { row: 0, column: 1 }, { row: 1, column: 0 }, { row: 1, column: 1 }]);
  assert.deepEqual([0, 1, 2, 3].map(i => handPosition(i, true)), [{ row: 1, column: 1 }, { row: 1, column: 0 }, { row: 0, column: 1 }, { row: 0, column: 0 }]);
  assert.deepEqual(handPosition(4), { row: 0, column: 2 }); assert.deepEqual(handPosition(4, true), { row: 1, column: -1 });
  assert.deepEqual([4, 5, 6, 7].map(handColumns), [2, 3, 3, 4]);
});
function table(count = 3): Game {
  const g = newGame('ABCDEFGH23', 'a', 'Alex', 1000);
  for (let i = 1; i < count; i++) addPlayer(g, String.fromCharCode(97 + i), `Player ${i + 1}`);
  for (const p of g.players) applyAction(g, p.id, { type: 'ready' }, 1000);
  applyAction(g, 'a', { type: 'start' }, 1000);
  g.active = 0;
  return g;
}
function playing(count = 3): Game {
  const g = table(count);
  for (const p of g.players) { applyAction(g, p.id, { type: 'reveal-initial' }, 1000); applyAction(g, p.id, { type: 'close-initial' }, 1000); }
  return g;
}
function discard(g: Game, rank: number, now = 1000) {
  g.deck = [card(2), card(rank)];
  const id = g.players[g.active].id;
  applyAction(g, id, { type: 'draw' }, now);
  applyAction(g, id, { type: 'discard' }, now);
}

test('a full deck has 54 cards and the exact house values', () => {
  const deck = shuffledDeck();
  assert.equal(deck.length, 54); assert.equal(deck.filter(c => c.rank === 0).length, 2);
  assert.equal(new Set(deck.filter(c => c.rank).map(c => c.rank + c.suit)).size, 52);
  assert.deepEqual([value(card(13, 'hearts')), value(card(13, 'diamonds')), value(card(13)), value(card(0, 'joker')), value(card(11)), value(card(12))], [-1, -1, 13, 0, 11, 12]);
});

test('initial peeks are private, untimed, one-use, and gate the first turn', () => {
  const g = table();
  applyAction(g, 'a', { type: 'reveal-initial' }, 1000);
  assert.equal(viewFor(g, 'a', 999999).players[0].hand.filter(c => c?.face).length, 2);
  assert.equal(viewFor(g, 'b').players[0].hand.filter(c => c?.face).length, 0);
  assert.deepEqual(viewFor(g, 'b').players[0].hand.map(c => c?.peekedBy), [null, null, 'a', 'a']);
  applyAction(g, 'a', { type: 'close-initial' }, 2000);
  assert.ok(viewFor(g, 'b').players[0].hand.every(c => !c?.peekedBy));
  assert.equal(g.phase, 'peek');
  assert.throws(() => applyAction(g, 'a', { type: 'reveal-initial' }), /already complete/);
  applyAction(g, 'b', { type: 'flip-initial', slot: 2 });
  assert.equal(viewFor(g, 'b').players[1].hand.filter(c => c?.face).length, 1);
  applyAction(g, 'b', { type: 'flip-initial', slot: 2 });
  assert.throws(() => applyAction(g, 'b', { type: 'flip-initial', slot: 2 }), /already finished/);
  applyAction(g, 'b', { type: 'flip-initial', slot: 3 });
  applyAction(g, 'b', { type: 'flip-initial', slot: 3 });
  applyAction(g, 'c', { type: 'reveal-initial' }); applyAction(g, 'c', { type: 'close-initial' });
  assert.equal(g.phase, 'playing');
  assert.equal(viewFor(g, 'a').players[0].hand.filter(c => c?.face).length, 0);
});

test('all peek powers publish only the positions and viewer, including both king peeks', () => {
  for (const rank of [7, 8, 9, 10, 12, 13]) {
    const g = playing(); discard(g, rank);
    const targets = rank === 13 ? [{ playerId: 'a', slot: 1 }, { playerId: 'b', slot: 3 }]
      : [{ playerId: rank === 9 || rank === 10 ? 'b' : 'a', slot: 1 }];
    for (const target of targets) applyAction(g, 'a', { type: 'peek', target });
    for (const id of ['a', 'b', 'c']) {
      const view = viewFor(g, id);
      for (const target of targets) {
        const slot = view.players.find(p => p.id === target.playerId)!.hand[target.slot]!;
        assert.equal(slot.peekedBy, 'a');
        assert.deepEqual(Object.keys(slot).sort(), ['face', 'peekedBy', 'peeking']);
        if (id === 'a') assert.ok(slot.face);
        else { assert.equal(slot.face, null); assert.equal(slot.peeking, false); assert.equal(view.power, null); }
      }
      assert.equal(view.players.flatMap(p => p.hand).filter(c => c?.peekedBy).length, targets.length);
    }
    for (const target of targets) applyAction(g, 'a', { type: 'hide-peek', target });
    for (const id of ['a', 'b', 'c']) assert.ok(viewFor(g, id).players.every(p => p.hand.every(c => !c?.peekedBy && !c?.face)));
  }
});

test('drawn cards are private and replacement discards never activate a power', () => {
  const g = playing(); g.players[0].hand[0] = card(13); g.deck = [card(2), card(4)];
  applyAction(g, 'a', { type: 'draw' });
  assert.equal(viewFor(g, 'a').drawn?.rank, 4); assert.equal(viewFor(g, 'b').drawn, null);
  applyAction(g, 'a', { type: 'replace', target: { playerId: 'a', slot: 0 } });
  assert.equal(g.power, null); assert.equal(g.discards.at(-1)?.rank, 13); assert.equal(g.active, 1);
});

test('draws and replacements broadcast identical public paths without action extras or hidden values', () => {
  const g = playing(); g.deck = [card(2), card(13, 'hearts')]; g.players[0].hand[2] = card(4);
  applyAction(g, 'a', { type: 'draw' }, 1001);
  const target = { playerId: 'a', slot: 2, privateCard: card(13, 'hearts') };
  applyAction(g, 'a', { type: 'replace', target }, 1002);
  const motions = g.motions!;
  assert.deepEqual(motions.map(e => e.kind), ['draw', 'replace']);
  assert.deepEqual(motions[1].moves, [{ from: { playerId: 'a', slot: 2 }, to: 'discard' }, { from: 'draw', to: { playerId: 'a', slot: 2 } }]);
  assert.doesNotMatch(JSON.stringify(motions), /rank|suit|privateCard/);
  for (const id of ['a', 'b', 'c']) {
    assert.deepEqual(viewFor(g, id).motions, motions);
    assert.equal(viewFor(g, id).players[0].hand[2]?.face, null);
  }
  assert.equal(g.players[0].hand[2]?.suit, 'hearts'); assert.equal(g.discards.at(-1)?.rank, 4);
});

test('queen can peek at your card then swap two different opponents’ cards', () => {
  const g = playing(); g.players[1].hand[0] = card(3); g.players[2].hand[0] = card(8);
  discard(g, 12);
  applyAction(g, 'a', { type: 'peek', target: { playerId: 'a', slot: 1 } });
  assert.equal(viewFor(g, 'a').power?.reveals.length, 1); assert.equal(viewFor(g, 'b').power, null);
  assert.ok(viewFor(g, 'a').players[0].hand[1]?.face);
  assert.equal(viewFor(g, 'b').players[0].hand[1]?.face, null);
  applyAction(g, 'a', { type: 'hide-peek', target: { playerId: 'a', slot: 1 } });
  assert.equal(viewFor(g, 'a').power?.reveals.length, 0);
  applyAction(g, 'a', { type: 'swap', a: { playerId: 'b', slot: 0 }, b: { playerId: 'c', slot: 0 } });
  assert.equal(g.players[1].hand[0]?.rank, 8); assert.equal(g.players[2].hand[0]?.rank, 3);
  const swap = viewFor(g, 'a').lastSwap;
  assert.ok(swap);
  assert.deepEqual(swap.a, { playerId: 'b', slot: 0 });
  assert.deepEqual(swap.b, { playerId: 'c', slot: 0 });
  assert.deepEqual(Object.keys(swap).sort(), ['a', 'actorId', 'at', 'b', 'id']);
  for (const id of ['a', 'b', 'c']) {
    const view = viewFor(g, id);
    assert.deepEqual(view.lastSwap, swap, 'Everyone receives the same public swap positions.');
    assert.ok(view.players.every(p => p.hand.every(c => !c?.face)), 'Swapping must not reveal the cards.');
  }
});

test('only the host can choose the Queen rule between games; ready checks reset and rematches retain it', () => {
  const g = newGame('AB7K', 'a', 'Alex'); addPlayer(g, 'b', 'Blair');
  assert.equal(viewFor(g, 'b').queenRule, 'look-then-swap');
  delete g.queenRule; assert.equal(viewFor(g, 'a').queenRule, 'look-then-swap');
  for (const p of g.players) applyAction(g, p.id, { type: 'ready' });
  assert.throws(() => applyAction(g, 'b', { type: 'set-queen-rule', rule: 'swap-then-look' }), /Only the host/);
  assert.throws(() => applyAction(g, 'a', { type: 'set-queen-rule', rule: 'bad' as never }), /valid Queen rule/);
  applyAction(g, 'a', { type: 'set-queen-rule', rule: 'swap-then-look' });
  assert.ok(g.players.every(p => !p.ready));
  assert.equal(viewFor(g, 'b').queenRule, 'swap-then-look');
  for (const p of g.players) applyAction(g, p.id, { type: 'ready' });
  applyAction(g, 'a', { type: 'start' });
  assert.throws(() => applyAction(g, 'a', { type: 'set-queen-rule', rule: 'look-then-swap' }), /between games/);
  applyAction(g, 'a', { type: 'end-game' }, 1000); finishIfDue(g, 6000);
  for (const p of g.players) applyAction(g, p.id, { type: 'ready' }, 6001);
  assert.equal(g.phase, 'peek'); assert.equal(g.queenRule, 'swap-then-look');
});

test('swap-then-look reveals only your received card, in either swap direction, then ends the turn', () => {
  for (const reverse of [false, true]) {
    const g = playing(); g.queenRule = 'swap-then-look';
    g.players[0].hand[0] = card(2); g.players[1].hand[1] = card(7, 'hearts');
    discard(g, 12);
    assert.equal(g.power?.step, 'swap');
    assert.throws(() => applyAction(g, 'a', { type: 'peek', target: { playerId: 'a', slot: 0 } }), /no card to peek/);
    const own = { playerId: 'a', slot: 0 }, other = { playerId: 'b', slot: 1 };
    applyAction(g, 'a', { type: 'swap', a: reverse ? other : own, b: reverse ? own : other });
    assert.equal(g.active, 0); assert.equal(g.power?.step, 'view');
    assert.deepEqual(viewFor(g, 'a').players[0].hand[0]?.face, card(7, 'hearts'));
    for (const id of ['b', 'c']) {
      assert.equal(viewFor(g, id).players[0].hand[0]?.peekedBy, 'a');
      assert.equal(viewFor(g, id).players[0].hand[0]?.face, null);
      assert.equal(viewFor(g, id).power, null);
    }
    if (reverse) applyAction(g, 'a', { type: 'close-peek' });
    else applyAction(g, 'a', { type: 'hide-peek', target: own });
    assert.equal(g.power, null); assert.equal(g.active, 1);
  }
});

test('a Queen swap within your hand allows exactly one of those two cards to be peeked, without exposing both', () => {
  const g = playing(); g.queenRule = 'swap-then-look';
  g.players[0].hand = [card(3), card(4), card(5), card(6)]; discard(g, 12);
  applyAction(g, 'a', { type: 'swap', a: { playerId: 'a', slot: 0 }, b: { playerId: 'a', slot: 1 } });
  assert.equal(g.power?.step, 'received');
  assert.deepEqual(viewFor(g, 'a').power?.received, [{ playerId: 'a', slot: 0 }, { playerId: 'a', slot: 1 }]);
  assert.ok(viewFor(g, 'a').players[0].hand.every(c => !c?.face));
  assert.throws(() => applyAction(g, 'a', { type: 'peek', target: { playerId: 'a', slot: 2 } }), /cards you received/);
  applyAction(g, 'a', { type: 'peek', target: { playerId: 'a', slot: 1 } });
  assert.deepEqual(viewFor(g, 'a').players[0].hand[1]?.face, card(3));
  assert.equal(viewFor(g, 'b').players[0].hand[1]?.face, null);
  assert.throws(() => applyAction(g, 'a', { type: 'peek', target: { playerId: 'a', slot: 0 } }), /no card to peek/);
  applyAction(g, 'a', { type: 'close-peek' }); assert.equal(g.power, null); assert.equal(g.active, 1);
});

test('received-card choices cannot expose a replacement introduced by a matching transfer', () => {
  const g = playing(); g.queenRule = 'swap-then-look';
  g.players[0].hand[0] = card(4); g.players[0].hand[1] = card(12); g.players[1].hand[0] = card(8);
  discard(g, 12);
  applyAction(g, 'a', { type: 'swap', a: { playerId: 'a', slot: 0 }, b: { playerId: 'a', slot: 1 } });
  applyAction(g, 'b', { type: 'match', target: { playerId: 'a', slot: 0 }, opportunityId: g.opportunity!.id }, 1100);
  applyAction(g, 'b', { type: 'give', slot: 0 }, 1101);
  assert.deepEqual(viewFor(g, 'a', 1102).power?.received, [{ playerId: 'a', slot: 1 }]);
  assert.throws(() => applyAction(g, 'a', { type: 'peek', target: { playerId: 'a', slot: 0 } }), /may have moved/);
  assert.equal(viewFor(g, 'a', 1102).players[0].hand[0]?.face, null);
});

test('swapping only opponents grants no Queen peek; an exhausted deck waits for the received-card peek', () => {
  const g = playing(); g.queenRule = 'swap-then-look'; discard(g, 12);
  applyAction(g, 'a', { type: 'swap', a: { playerId: 'b', slot: 0 }, b: { playerId: 'c', slot: 0 } });
  assert.equal(g.power, null); assert.equal(g.active, 1);
  const last = playing(); last.queenRule = 'swap-then-look'; last.deck = [card(12)];
  applyAction(last, 'a', { type: 'draw' }, 1000); applyAction(last, 'a', { type: 'discard' }, 1001);
  applyAction(last, 'a', { type: 'swap', a: { playerId: 'a', slot: 0 }, b: { playerId: 'b', slot: 0 } }, 1002);
  assert.equal(last.phase, 'playing'); assert.equal(last.power?.step, 'view');
  applyAction(last, 'a', { type: 'close-peek' }, 1003);
  assert.equal(last.phase, 'ending'); assert.equal(last.deadline, 6003);
});

test('matching leaves a fixed empty slot and penalties append without moving remembered cards', () => {
  const g = playing();
  g.players[1].hand = [card(3), card(7), card(5), card(9)];
  const original = [...g.players[1].hand];
  discard(g, 7); g.deck = [card(2), card(4), card(6)];
  const opportunityId = g.opportunity!.id;
  applyAction(g, 'b', { type: 'match', target: { playerId: 'b', slot: 1 }, opportunityId }, 1000);
  assert.equal(g.players[1].hand[1], null);
  // A later discard creates another opportunity; wrong matches add penalties.
  applyAction(g, 'a', { type: 'skip-power' }, 1100);
  g.deck = [card(2), card(4), card(8)];
  applyAction(g, 'b', { type: 'draw' }, 1200);
  applyAction(g, 'b', { type: 'discard' }, 1201);
  const nextId = g.opportunity!.id;
  applyAction(g, 'b', { type: 'match', target: { playerId: 'b', slot: 0 }, opportunityId: nextId }, 1300);
  applyAction(g, 'b', { type: 'match', target: { playerId: 'b', slot: 0 }, opportunityId: nextId }, 1400);
  for (const slot of [0, 2, 3]) assert.equal(g.players[1].hand[slot], original[slot]);
  assert.equal(g.players[1].hand[1], null);
  assert.equal(g.players[1].hand[4]?.rank, 4);
  assert.equal(g.players[1].hand[5]?.rank, 2);
  const view = viewFor(g, 'c', 1500).players[1].hand;
  assert.equal(view.length, 6); assert.equal(view[1], null);
});

test('match messages name the matcher and the matched owner without duplicating the matcher name', () => {
  const g = playing();
  g.players[0].hand[1] = card(7); g.players[1].hand[2] = card(7);
  discard(g, 7);
  const opportunityId = g.opportunity!.id;
  applyAction(g, 'a', { type: 'match', target: { playerId: 'b', slot: 2 }, opportunityId });
  assert.equal(g.message, 'Alex matched Player 2’s card 3.');
  const self = playing(); self.players[0].hand[1] = card(7); discard(self, 7);
  applyAction(self, 'a', { type: 'match', target: { playerId: 'a', slot: 1 }, opportunityId: self.opportunity!.id });
  assert.equal(self.message, 'Alex matched their own card 2.');
});

test('king peeks can be flipped back individually without losing the other peek or leaking faces', () => {
  const g = playing(); discard(g, 13);
  applyAction(g, 'a', { type: 'peek', target: { playerId: 'a', slot: 0 } });
  applyAction(g, 'a', { type: 'hide-peek', target: { playerId: 'a', slot: 0 } });
  assert.equal(g.power?.step, 'other');
  assert.equal(viewFor(g, 'a').players[0].hand[0]?.face, null);
  applyAction(g, 'a', { type: 'peek', target: { playerId: 'b', slot: 0 } });
  assert.ok(viewFor(g, 'a').players[1].hand[0]?.face);
  assert.equal(viewFor(g, 'c').players[1].hand[0]?.face, null);
  applyAction(g, 'a', { type: 'hide-peek', target: { playerId: 'b', slot: 0 } });
  assert.equal(g.power?.step, 'swap');
  assert.equal(viewFor(g, 'a').players[1].hand[0]?.face, null);
});

test('matching races continue during a power; only one success and zero-card hands stay in play', () => {
  const g = playing(); g.players[1].hand = [card(7)]; g.players[2].hand = [card(7)];
  discard(g, 7);
  const opportunityId = g.opportunity!.id;
  applyAction(g, 'b', { type: 'match', target: { playerId: 'b', slot: 0 }, opportunityId });
  assert.equal(g.power?.rank, 7); assert.equal(g.phase, 'playing'); assert.equal(score(g.players[1]), 0);
  assert.throws(() => applyAction(g, 'c', { type: 'match', target: { playerId: 'c', slot: 0 }, opportunityId }), /first|changed/);
  assert.equal(g.players[2].hand[0]?.rank, 7);
});

test('wrong opponent matches restore the card, penalize the matcher, and allow a successful retry/transfer', () => {
  const g = playing(); g.players[1].hand = [card(2), card(5)]; g.players[2].hand = [card(3), card(7)];
  discard(g, 7); g.deck = [card(6), card(9)];
  const opportunityId = g.opportunity!.id;
  applyAction(g, 'b', { type: 'match', target: { playerId: 'c', slot: 0 }, opportunityId }, 1000);
  assert.equal(g.players[2].hand[0]?.rank, 3); assert.equal(g.players[1].hand.at(-1)?.rank, 9);
  applyAction(g, 'b', { type: 'match', target: { playerId: 'c', slot: 1 }, opportunityId }, 1100);
  applyAction(g, 'b', { type: 'give', slot: 0 }, 1101);
  assert.equal(g.players[2].hand[1]?.rank, 2); assert.equal(g.players[1].hand[0], null);
  assert.deepEqual(g.motions!.slice(-3).map(e => [e.kind, e.moves]), [
    ['penalty', [{ from: { playerId: 'c', slot: 0 }, to: { playerId: 'c', slot: 0 } }, { from: 'draw', to: { playerId: 'b', slot: 2 } }]],
    ['match', [{ from: { playerId: 'c', slot: 1 }, to: 'discard' }]],
    ['give', [{ from: { playerId: 'b', slot: 0 }, to: { playerId: 'c', slot: 1 } }]],
  ]);
  // A public match flash must not reveal the replacement card after a transfer.
  assert.equal(viewFor(g, 'a', 1102).players[2].hand[1]?.face, null);
});

test('Cambio requires two full rounds and protects against matches/swaps but allows peeks', () => {
  const g = playing();
  assert.throws(() => applyAction(g, 'a', { type: 'cambio' }), /Two complete/);
  g.turns = 6; applyAction(g, 'a', { type: 'cambio' });
  assert.equal(g.calledBy, 'a'); assert.equal(g.finalTurns, 2);
  discard(g, 9);
  applyAction(g, 'b', { type: 'peek', target: { playerId: 'a', slot: 0 } });
  assert.equal(g.power?.reveals[0].card.rank, g.players[0].hand[0]?.rank);
  assert.throws(() => applyAction(g, 'c', { type: 'match', target: { playerId: 'a', slot: 0 }, opportunityId: g.opportunity!.id }), /locked/);
  applyAction(g, 'b', { type: 'close-peek' });
  discard(g, 11);
  assert.throws(() => applyAction(g, 'c', { type: 'swap', a: { playerId: 'a', slot: 0 }, b: { playerId: 'c', slot: 0 } }), /locked/);
  applyAction(g, 'c', { type: 'skip-power' }, 5000);
  assert.equal(g.phase, 'ending'); assert.equal(g.deadline, 10000);
});

test('last normal draw finishes its power, then enforces the five-second matching deadline', () => {
  const g = playing(); g.deck = [card(7)];
  applyAction(g, 'a', { type: 'draw' }, 1000); assert.equal(g.phase, 'playing');
  applyAction(g, 'a', { type: 'discard' }, 1001); assert.equal(g.phase, 'playing');
  applyAction(g, 'a', { type: 'skip-power' }, 2000); assert.equal(g.deadline, 7000);
  assert.equal(finishIfDue(g, 6999), false);
  assert.throws(() => applyAction(g, 'b', { type: 'match', target: { playerId: 'b', slot: 0 }, opportunityId: g.opportunity!.id }, 7000), /closed/);
  assert.equal(finishIfDue(g, 7000), true); assert.equal(g.phase, 'finished');
});

test('last penalty draw does not interrupt an in-progress power or restart the ending countdown', () => {
  const g = playing(); discard(g, 7); g.deck = [card(4)]; g.players[1].hand[0] = card(3);
  applyAction(g, 'b', { type: 'match', target: { playerId: 'b', slot: 0 }, opportunityId: g.opportunity!.id }, 1200);
  assert.equal(g.exhausted, true); assert.equal(g.phase, 'playing'); assert.equal(g.power?.rank, 7);
  applyAction(g, 'a', { type: 'skip-power' }, 2000); assert.equal(g.deadline, 7000);
  applyAction(g, 'b', { type: 'match', target: { playerId: 'b', slot: 0 }, opportunityId: g.opportunity!.id }, 3000);
  assert.equal(g.deadline, 7000); assert.equal(g.players[1].hand.length, 5);
});

test('a matching transfer accepted before the deadline completes before scoring; tied winners seed rematches', () => {
  const g = playing(); discard(g, 7); g.players[0].hand = [card(2)]; g.players[1].hand = [card(2)]; g.players[2].hand = [card(7)];
  applyAction(g, 'a', { type: 'end-game' }, 2000);
  applyAction(g, 'b', { type: 'match', target: { playerId: 'c', slot: 0 }, opportunityId: g.opportunity!.id }, 6999);
  assert.equal(finishIfDue(g, 7000), false);
  applyAction(g, 'b', { type: 'give', slot: 0 }, 7001);
  assert.equal(g.phase, 'finished'); assert.deepEqual(g.winners, ['b']);
  g.players[0].hand = [card(0, 'joker')]; g.winners = ['a', 'b'];
  for (const p of g.players) applyAction(g, p.id, { type: 'ready' }, 8000);
  assert.equal(g.phase, 'peek'); assert.ok(['a', 'b'].includes(g.players[g.active].id));
  assert.equal(g.gameNumber, 2); assert.ok(g.players.every(p => !p.ready && p.initial === 'waiting'));
});
