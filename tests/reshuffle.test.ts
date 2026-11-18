import test from 'node:test';
import assert from 'node:assert/strict';
import { addPlayer, applyAction, finishIfDue, newGame, viewFor, type Card, type Game } from '../lib/game.ts';

const card = (rank: number, id = crypto.randomUUID()): Card => ({ rank, suit: 'clubs', id });

function lobby() {
  const game = newGame('AB12', 'a', 'Alex', 1000);
  addPlayer(game, 'b', 'Blake');
  return game;
}

function playing(reshuffle = true, decks: 1 | 2 = 1) {
  const game = lobby();
  applyAction(game, 'a', { type: 'set-reshuffle', enabled: reshuffle });
  applyAction(game, 'a', { type: 'set-decks', decks });
  for (const p of game.players) applyAction(game, p.id, { type: 'ready' });
  applyAction(game, 'a', { type: 'start' });
  for (const p of game.players) {
    applyAction(game, p.id, { type: 'reveal-initial' });
    applyAction(game, p.id, { type: 'close-initial' });
  }
  game.active = 0;
  return game;
}

function openDiscard(game: Game, cards: Card[]) {
  game.discards = cards;
  game.opportunity = { id: 'match-opportunity', open: true };
}

test('reshuffling defaults off; only the host may toggle it between games, resetting readiness', () => {
  const game = lobby();
  assert.equal(viewFor(game, 'a').reshuffle, false);
  game.players.forEach(p => p.ready = true);
  assert.throws(() => applyAction(game, 'b', { type: 'set-reshuffle', enabled: true }), /Only the host/);
  assert.throws(() => applyAction(game, 'a', { type: 'set-reshuffle', enabled: 'yes' as never }), /whether reshuffling/);
  applyAction(game, 'a', { type: 'set-reshuffle', enabled: true });
  assert.ok(game.players.every(p => !p.ready));
  assert.equal(viewFor(game, 'b').reshuffle, true);
  game.players.forEach(p => p.ready = true);
  applyAction(game, 'a', { type: 'set-reshuffle', enabled: true });
  assert.ok(game.players.every(p => p.ready));
  applyAction(game, 'a', { type: 'start' });
  assert.throws(() => applyAction(game, 'a', { type: 'set-reshuffle', enabled: false }), /between games/);
  applyAction(game, 'a', { type: 'end-game' }, 1000);
  assert.throws(() => applyAction(game, 'a', { type: 'set-reshuffle', enabled: false }, 1001), /between games/);
  finishIfDue(game, 6000);
  const restored = JSON.parse(JSON.stringify(game)) as Game;
  for (const p of restored.players) applyAction(restored, p.id, { type: 'ready' }, 6001);
  assert.equal(restored.phase, 'peek');
  assert.equal(restored.reshuffle, true);
  restored.phase = 'finished';
  applyAction(restored, 'a', { type: 'set-reshuffle', enabled: false });
  assert.equal(viewFor(restored, 'b').reshuffle, false);
  assert.ok(restored.players.every(p => !p.ready));
});

test('last draw recycles only buried discards, preserving identities, opportunity and private views', () => {
  const game = playing();
  const buried = [card(4), card(4), card(0)];
  const top = card(9), last = card(7);
  game.deck = [last];
  openDiscard(game, [...buried, top]);
  applyAction(game, 'a', { type: 'draw' }, 1000);
  assert.equal(game.drawn, last);
  assert.deepEqual(new Set(game.deck.map(c => c.id)), new Set(buried.map(c => c.id)));
  assert.deepEqual(game.discards, [top]);
  assert.equal(game.opportunity?.id, 'match-opportunity');
  assert.equal(game.opportunity?.open, true);
  assert.equal(game.exhausted, false);
  game.spectators = [{ id: 's', name: 'Watcher', queuedAt: null }];
  for (const id of ['a', 'b', 's']) {
    const view = viewFor(game, id, 1000);
    assert.equal(view.deckCount, 3);
    assert.equal(view.reshuffleUntil, 4000);
    assert.deepEqual(view.discard, top);
    for (const c of buried) assert.ok(!JSON.stringify(view).includes(c.id!));
    assert.equal(view.drawn, id === 'a' ? last : null);
  }
  assert.throws(() => applyAction(game, 'a', { type: 'discard' }, 3999), /reshuffling/);
  assert.throws(() => applyAction(game, 'b', { type: 'match', target: { playerId: 'b', slot: 0 }, opportunityId: 'match-opportunity' }, 3999), /reshuffling/);
  assert.equal(viewFor(game, 'a', 4000).reshuffleUntil, null);
  applyAction(game, 'a', { type: 'discard' }, 4000);
  applyAction(game, 'a', { type: 'skip-power' }, 4001);
  assert.equal(game.phase, 'playing');
  assert.equal(game.active, 1);
});

test('a penalty refills the draw pile without changing the active power or matching opportunity', () => {
  const game = playing();
  const buried = card(2), top = card(7), penalty = card(5);
  game.deck = [penalty];
  game.players[1].hand[0] = card(3);
  game.power = { rank: 7, step: 'own', reveals: [] };
  openDiscard(game, [buried, top]);
  applyAction(game, 'b', { type: 'match', target: { playerId: 'b', slot: 0 }, opportunityId: 'match-opportunity' }, 1000);
  assert.equal(game.players[1].hand.at(-1), penalty);
  assert.deepEqual(game.deck, [buried]);
  assert.deepEqual(game.discards, [top]);
  assert.equal(game.opportunity?.open, true);
  assert.equal(game.power?.rank, 7);
  assert.equal(game.exhausted, false);
  assert.throws(() => applyAction(game, 'a', { type: 'skip-power' }, 3999), /reshuffling/);
  applyAction(game, 'a', { type: 'skip-power' }, 4000);
  assert.equal(game.phase, 'playing');
});

test('a discard or replacement can supply recyclable cards after the last draw', () => {
  for (const replace of [false, true]) {
    const game = playing();
    const top = card(9);
    game.deck = [card(3)];
    openDiscard(game, [top]);
    applyAction(game, 'a', { type: 'draw' }, 1000);
    assert.equal(game.exhausted, true);
    if (replace) applyAction(game, 'a', { type: 'replace', target: { playerId: 'a', slot: 0 } }, 1001);
    else applyAction(game, 'a', { type: 'discard' }, 1001);
    assert.deepEqual(game.deck, [top]);
    assert.equal(game.discards.length, 1);
    assert.equal(game.exhausted, false);
    assert.equal(game.phase, 'playing');
  }
});

test('a successful match during the final power can replenish the pile without reopening matching', () => {
  const game = playing();
  const top = card(7), matched = card(7);
  game.deck = [top];
  game.players[1].hand[0] = matched;
  applyAction(game, 'a', { type: 'draw' }, 1000);
  applyAction(game, 'a', { type: 'discard' }, 1001);
  applyAction(game, 'b', { type: 'match', target: { playerId: 'b', slot: 0 }, opportunityId: game.opportunity!.id }, 1002);
  assert.deepEqual(game.deck, [top]);
  assert.deepEqual(game.discards, [matched]);
  assert.equal(game.opportunity?.open, false);
  applyAction(game, 'a', { type: 'skip-power' }, 4002);
  assert.equal(game.phase, 'playing');
});

test('disabled reshuffling and an empty recyclable pile retain the final matching window', () => {
  for (const enabled of [false, true]) {
    const game = playing(enabled);
    game.deck = [card(3)];
    openDiscard(game, enabled ? [] : [card(2), card(9)]);
    applyAction(game, 'a', { type: 'draw' }, 1000);
    applyAction(game, 'a', { type: 'discard' }, 1001);
    assert.equal(game.deck.length, 0);
    assert.equal(viewFor(game, 'a', 1001).reshuffleUntil, null);
    assert.equal(game.phase, 'ending');
    assert.equal(game.deadline, 6001);
    assert.equal(finishIfDue(game, 6000), false);
    assert.equal(finishIfDue(game, 6001), true);
  }
});

test('the final Cambio turn still ends after a reshuffle and a pause preserves matching time', () => {
  const game = playing();
  game.turns = 4;
  applyAction(game, 'a', { type: 'cambio' }, 1000);
  game.deck = [card(3)];
  openDiscard(game, [card(2), card(9)]);
  applyAction(game, 'b', { type: 'draw' }, 1001);
  applyAction(game, 'b', { type: 'discard' }, 4001);
  assert.equal(game.exhausted, false);
  assert.equal(game.phase, 'ending');
  assert.equal(game.deadline, 9001);
  game.players[1].hand[0] = card(5);
  const match = { type: 'match', target: { playerId: 'b', slot: 0 }, opportunityId: game.opportunity!.id } as const;
  applyAction(game, 'b', match, 5000);
  assert.equal(game.deadline, 12001);
  assert.throws(() => applyAction(game, 'b', match, 7999), /reshuffling/);
  assert.equal(finishIfDue(game, 9001), false);
  applyAction(game, 'b', match, 8000);
  assert.equal(game.deadline, 12001);
  assert.equal(finishIfDue(game, 12001), true);
});

test('repeated reshuffles conserve all physical cards in one- and two-deck games', () => {
  for (const decks of [1, 2] as const) {
    const game = playing(true, decks);
    const cards = () => [...game.deck, ...game.discards, ...(game.drawn ? [game.drawn] : []), ...game.players.flatMap(p => p.hand.filter((c): c is Card => !!c))];
    const originalIds = new Set(cards().map(c => c.id));
    let now = 1000;
    for (let turn = 0; turn < 250; turn++) {
      const id = game.players[game.active].id;
      applyAction(game, id, { type: 'draw' }, now++);
      now = Math.max(now, game.reshuffleUntil ?? 0);
      applyAction(game, id, { type: 'replace', target: { playerId: id, slot: turn % 4 } }, now++);
      now = Math.max(now, game.reshuffleUntil ?? 0);
      assert.equal(game.phase, 'playing');
      assert.equal(cards().length, decks * 54);
      assert.deepEqual(new Set(cards().map(c => c.id)), originalIds);
    }
  }
});
