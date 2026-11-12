import test from 'node:test';
import assert from 'node:assert/strict';
import { addPlayer, applyAction, finishIfDue, newGame, score, shuffledDeck, value, viewFor, type Card, type Game } from '../lib/game.ts';

const card = (rank: number, suit: Card['suit'] = 'clubs'): Card => ({ rank, suit });
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
  applyAction(g, 'a', { type: 'close-initial' }, 2000);
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

test('drawn cards are private and replacement discards never activate a power', () => {
  const g = playing(); g.players[0].hand[0] = card(13); g.deck = [card(2), card(4)];
  applyAction(g, 'a', { type: 'draw' });
  assert.equal(viewFor(g, 'a').drawn?.rank, 4); assert.equal(viewFor(g, 'b').drawn, null);
  applyAction(g, 'a', { type: 'replace', target: { playerId: 'a', slot: 0 } });
  assert.equal(g.power, null); assert.equal(g.discards.at(-1)?.rank, 13); assert.equal(g.active, 1);
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
