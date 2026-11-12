export type Suit = 'clubs' | 'diamonds' | 'hearts' | 'spades' | 'joker';
export type Card = { rank: number; suit: Suit };
export type Target = { playerId: string; slot: number };
export type Player = {
  id: string; name: string; hand: (Card | null)[]; ready: boolean;
  initial: 'waiting' | 'viewing' | 'done';
};
export type Power = {
  rank: number; step: 'own' | 'other' | 'view' | 'swap';
  reveals: { target: Target; card: Card }[];
};
export type Game = {
  code: string; hostId: string; players: Player[];
  phase: 'lobby' | 'peek' | 'playing' | 'ending' | 'finished';
  deck: Card[]; discards: Card[]; active: number; turns: number;
  drawn: Card | null; power: Power | null; turnComplete: boolean;
  opportunity: { id: string; open: boolean } | null;
  transfer: { from: string; to: Target } | null;
  calledBy: string | null; finalTurns: number | null; exhausted: boolean;
  deadline: number | null; winners: string[]; gameNumber: number;
  version: number; message: string; updatedAt: number;
  flash: { target: Target; card: Card; until: number } | null;
};
export type Action =
  | { type: 'ready' | 'start' | 'reveal-initial' | 'close-initial' | 'draw' | 'discard' | 'close-peek' | 'skip-power' | 'cambio' | 'end-game' }
  | { type: 'replace' | 'peek'; target: Target }
  | { type: 'swap'; a: Target; b: Target }
  | { type: 'match'; target: Target; opportunityId: string }
  | { type: 'give'; slot: number }
  | { type: 'remove'; playerId: string };

export function value(card: Card): number {
  return card.rank === 13 && (card.suit === 'hearts' || card.suit === 'diamonds') ? -1 : card.rank;
}
export function score(player: Player): number {
  return player.hand.reduce((sum, c) => sum + (c ? value(c) : 0), 0);
}
export function shuffledDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of ['clubs', 'diamonds', 'hearts', 'spades'] as const)
    for (let rank = 1; rank <= 13; rank++) deck.push({ rank, suit });
  deck.push({ rank: 0, suit: 'joker' }, { rank: 0, suit: 'joker' });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}
function randomIndex(n: number): number {
  const numbers = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / n) * n;
  do { crypto.getRandomValues(numbers); } while (numbers[0] >= limit);
  return numbers[0] % n;
}
function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
export function playerById(game: Game, id: string): Player {
  const p = game.players.find(p => p.id === id);
  ensure(p, 'Your seat is no longer in this room.');
  return p;
}
export function addPlayer(game: Game, id: string, name: string): void {
  ensure(game.phase === 'lobby' || game.phase === 'finished', 'This game has started. Join after it finishes.');
  ensure(game.players.length < 10, 'This room is full (10 players).');
  ensure(!game.players.some(p => p.name.toLowerCase() === name.toLowerCase()), 'That name is already taken in this room.');
  game.players.push({ id, name, hand: [], ready: false, initial: 'waiting' });
  game.version++;
}
export function newGame(code: string, id: string, name: string, now = Date.now()): Game {
  return {
    code, hostId: id, players: [{ id, name, hand: [], ready: false, initial: 'waiting' }],
    phase: 'lobby', deck: [], discards: [], active: 0, turns: 0, drawn: null,
    power: null, turnComplete: false, opportunity: null, transfer: null,
    calledBy: null, finalTurns: null, exhausted: false, deadline: null,
    winners: [], gameNumber: 0, version: 0, message: 'Waiting for friends.', updatedAt: now, flash: null,
  };
}
function begin(game: Game): void {
  const candidates = game.players.filter(p => game.winners.includes(p.id));
  const starter = candidates.length ? candidates[randomIndex(candidates.length)] : game.players[randomIndex(game.players.length)];
  game.active = game.players.findIndex(p => p.id === starter.id);
  game.deck = shuffledDeck();
  for (const p of game.players) {
    p.hand = []; p.ready = false; p.initial = 'waiting';
  }
  for (let i = 0; i < 4; i++) for (const p of game.players) p.hand.push(game.deck.pop()!);
  game.phase = 'peek'; game.discards = []; game.turns = 0;
  game.drawn = null; game.power = null; game.turnComplete = false;
  game.opportunity = null; game.transfer = null; game.calledBy = null;
  game.finalTurns = null; game.exhausted = false; game.deadline = null;
  game.winners = []; game.flash = null; game.gameNumber++;
  game.message = 'Look at your bottom two cards. Hide them when you are ready.';
}
function publishDiscard(game: Game, card: Card): void {
  game.discards.push(card);
  game.opportunity = { id: crypto.randomUUID(), open: true };
}
function takeCard(game: Game): Card | null {
  const card = game.deck.pop() ?? null;
  if (!game.deck.length) game.exhausted = true;
  return card;
}
function appendCard(player: Player, card: Card): void {
  // Preserve existing slots, including gaps. New penalties have a predictable location.
  player.hand.push(card);
}
function ending(game: Game, now: number): void {
  if (game.phase === 'ending') return;
  game.phase = 'ending'; game.deadline = now + 5000;
  game.drawn = null; game.power = null;
  game.message = 'Final chance to match. Scoring in five seconds.';
}
function finishTurn(game: Game, now: number): void {
  game.drawn = null; game.power = null; game.turnComplete = true;
  if (game.transfer) return;
  game.turns++;
  if (game.finalTurns !== null) game.finalTurns--;
  if (game.exhausted || game.finalTurns === 0) { ending(game, now); return; }
  game.active = (game.active + 1) % game.players.length;
  game.turnComplete = false;
}
export function finishIfDue(game: Game, now = Date.now()): boolean {
  if (game.phase !== 'ending' || game.deadline === null || now < game.deadline || game.transfer) return false;
  game.phase = 'finished';
  const lowest = Math.min(...game.players.map(score));
  game.winners = game.players.filter(p => score(p) === lowest).map(p => p.id);
  for (const p of game.players) p.ready = false;
  game.flash = null;
  game.message = game.winners.map(id => playerById(game, id).name).join(' & ') + (game.winners.length > 1 ? ' tie for the win.' : ' wins.');
  game.version++; game.updatedAt = now;
  return true;
}
function targetCard(game: Game, target: Target, mutable: boolean): { player: Player; card: Card } {
  ensure(target && typeof target.playerId === 'string' && Number.isInteger(target.slot) && target.slot >= 0, 'Choose a card.');
  const player = playerById(game, target.playerId);
  const card = player.hand[target.slot];
  ensure(card, 'That card has moved. Choose again.');
  if (mutable) ensure(player.id !== game.calledBy, 'The Cambio caller’s hand is locked.');
  ensure(!game.transfer || game.transfer.to.playerId !== target.playerId || game.transfer.to.slot !== target.slot, 'That card is part of a pending transfer.');
  return { player, card };
}
export function applyAction(game: Game, id: string, action: Action, now = Date.now()): void {
  const player = playerById(game, id);
  ensure(action && typeof action.type === 'string', 'Invalid action.');
  // Deadline admission is checked before all actions, not only by a timer callback.
  if (game.phase === 'ending' && game.deadline !== null && now >= game.deadline) {
    ensure(action.type === 'give', 'The matching window has closed.');
  }
  if (action.type === 'ready') {
    ensure(game.phase === 'lobby' || game.phase === 'finished', 'The game is already in progress.');
    player.ready = !player.ready;
    if (game.phase === 'finished' && game.players.length >= 2 && game.players.every(p => p.ready)) begin(game);
  } else if (action.type === 'start') {
    ensure(id === game.hostId, 'Only the host can start the first game.');
    ensure(game.phase === 'lobby' && game.players.length >= 2 && game.players.every(p => p.ready), 'At least two players must be ready.');
    begin(game);
  } else if (action.type === 'remove') {
    ensure(id === game.hostId && (game.phase === 'lobby' || game.phase === 'finished'), 'Players can only be removed by the host between games.');
    ensure(action.playerId !== id, 'You cannot remove your own seat.');
    game.players = game.players.filter(p => p.id !== action.playerId);
  } else if (action.type === 'reveal-initial') {
    ensure(game.phase === 'peek' && player.initial === 'waiting', 'Your initial peek is already complete.');
    player.initial = 'viewing';
  } else if (action.type === 'close-initial') {
    ensure(game.phase === 'peek' && player.initial === 'viewing', 'Reveal your bottom two cards first.');
    player.initial = 'done';
    if (game.players.every(p => p.initial === 'done')) {
      game.phase = 'playing'; game.message = `${game.players[game.active].name} goes first.`;
    }
  } else if (action.type === 'end-game') {
    ensure(id === game.hostId && (game.phase === 'playing' || game.phase === 'peek'), 'Only the host can end a running game.');
    ensure(!game.transfer, 'Finish the pending card transfer first.');
    if (game.drawn) { publishDiscard(game, game.drawn); game.drawn = null; }
    ending(game, now);
  } else if (action.type === 'match') {
    ensure(game.phase === 'playing' || game.phase === 'ending', 'Matching is not open.');
    ensure(player.id !== game.calledBy, 'Your hand is locked after calling Cambio.');
    ensure(game.opportunity?.open && game.opportunity.id === action.opportunityId, 'Someone got there first, or the discard changed.');
    ensure(!game.transfer, 'Finish the card transfer first.');
    const { player: owner, card } = targetCard(game, action.target, true);
    if (owner.id !== id) ensure(player.hand.some(Boolean), 'You need a card to give them.');
    const top = game.discards.at(-1)!;
    game.flash = { target: action.target, card, until: now + 1200 };
    if (card.rank !== top.rank) {
      const penalty = takeCard(game);
      if (penalty) appendCard(player, penalty);
      game.message = `${player.name} missed the match${penalty ? ' and drew a penalty card' : '; the deck is empty'}.`;
      if (game.exhausted && game.phase === 'playing' && !game.drawn && !game.power) ending(game, now);
    } else {
      game.opportunity.open = false;
      owner.hand[action.target.slot] = null;
      game.discards.push(card); // Covers the discard without opening another opportunity.
      if (owner.id !== id) game.transfer = { from: id, to: action.target };
      game.message = `${player.name} matched${owner.id === id ? '' : ` ${owner.name}’s card`}.`;
    }
  } else if (action.type === 'give') {
    ensure(game.transfer?.from === id, 'There is no card for you to give.');
    const card = player.hand[action.slot];
    ensure(card, 'Choose one of your cards to give.');
    const recipient = playerById(game, game.transfer.to.playerId);
    ensure(recipient.id !== game.calledBy, 'The caller’s hand is locked.');
    recipient.hand[game.transfer.to.slot] = card;
    player.hand[action.slot] = null;
    game.transfer = null;
    game.message = `${player.name} gave a card to ${recipient.name}.`;
    if (game.turnComplete && game.phase === 'playing') finishTurn(game, now);
    if (game.phase === 'ending') finishIfDue(game, now);
  } else {
    ensure(game.phase === 'playing' && game.players[game.active].id === id, 'It is not your turn.');
    ensure(!game.transfer, 'Wait for the matching card transfer to finish.');
    if (action.type === 'draw') {
      ensure(!game.drawn && !game.power && !game.turnComplete, 'Finish your current action.');
      const card = takeCard(game);
      ensure(card, 'The draw pile is empty.');
      game.drawn = card; game.message = `${player.name} drew a card.`;
    } else if (action.type === 'replace') {
      ensure(game.drawn && !game.power && action.target.playerId === id, 'Choose one of your cards to replace.');
      const { card } = targetCard(game, action.target, true);
      player.hand[action.target.slot] = game.drawn;
      publishDiscard(game, card);
      game.message = `${player.name} replaced a card.`;
      finishTurn(game, now);
    } else if (action.type === 'discard') {
      ensure(game.drawn && !game.power, 'Draw a card first.');
      const card = game.drawn;
      publishDiscard(game, card); game.drawn = null;
      if (card.rank >= 7 && card.rank <= 13) {
        const step = card.rank === 11 ? 'swap' : card.rank === 9 || card.rank === 10 ? 'other' : 'own';
        game.power = { rank: card.rank, step, reveals: [] };
        game.message = `${player.name} can use a ${rankLabel(card.rank)} power.`;
      } else {
        game.message = `${player.name} discarded.`; finishTurn(game, now);
      }
    } else if (action.type === 'peek') {
      const power = game.power;
      ensure(power && (power.step === 'own' || power.step === 'other'), 'There is no card to peek at now.');
      ensure(power.step === 'own' ? action.target.playerId === id : action.target.playerId !== id, power.step === 'own' ? 'Choose one of your cards.' : 'Choose another player’s card.');
      const { card } = targetCard(game, action.target, false);
      power.reveals.push({ target: action.target, card });
      power.step = power.rank === 13 && power.step === 'own' ? 'other' : 'view';
    } else if (action.type === 'close-peek') {
      ensure(game.power?.step === 'view', 'Finish choosing your peek.');
      const rank = game.power.rank;
      game.power.reveals = [];
      if (rank === 12 || rank === 13) game.power.step = 'swap';
      else finishTurn(game, now);
    } else if (action.type === 'skip-power') {
      ensure(game.power, 'There is no power to skip.');
      finishTurn(game, now);
    } else if (action.type === 'swap') {
      ensure(game.power?.step === 'swap', 'There is no swap available.');
      ensure(action.a.playerId !== action.b.playerId || action.a.slot !== action.b.slot, 'Choose two different cards.');
      const a = targetCard(game, action.a, true), b = targetCard(game, action.b, true);
      a.player.hand[action.a.slot] = b.card; b.player.hand[action.b.slot] = a.card;
      game.message = `${player.name} swapped two cards.`; finishTurn(game, now);
    } else if (action.type === 'cambio') {
      ensure(!game.calledBy && !game.drawn && !game.power, 'Call Cambio before drawing.');
      ensure(game.turns >= game.players.length * 2, 'Two complete rounds must pass before calling Cambio.');
      game.calledBy = id; game.finalTurns = game.players.length - 1;
      game.message = `${player.name} called Cambio. Everyone else gets one last turn.`;
      game.active = (game.active + 1) % game.players.length;
    } else throw new Error('Unknown action.');
  }
  game.version++; game.updatedAt = now;
}

export function rankLabel(rank: number): string {
  return ({ 0: 'Joker', 1: 'A', 11: 'J', 12: 'Q', 13: 'K' } as Record<number, string>)[rank] ?? String(rank);
}
export function cardLabel(card: Card): string {
  return card.rank === 0 ? 'Joker' : `${rankLabel(card.rank)} of ${card.suit}`;
}

export function viewFor(game: Game, id: string, now = Date.now()) {
  const you = playerById(game, id);
  const isActive = game.players[game.active]?.id === id;
  const power = isActive ? game.power : null;
  return {
    code: game.code, hostId: game.hostId, phase: game.phase,
    activeId: game.players[game.active]?.id, turns: game.turns,
    gameNumber: game.gameNumber, version: game.version,
    players: game.players.map(p => ({
      id: p.id, name: p.name, ready: p.ready, initial: p.initial,
      count: p.hand.filter(Boolean).length,
      score: game.phase === 'finished' ? score(p) : null,
      hand: p.hand.map((card, slot) => {
        if (!card) return null;
        const initial = p.id === id && game.phase === 'peek' && you.initial === 'viewing' && (slot === 2 || slot === 3);
        const flash = game.flash && game.flash.until > now && game.flash.target.playerId === p.id && game.flash.target.slot === slot && game.flash.card.rank === card.rank && game.flash.card.suit === card.suit;
        // Power reveals are separate snapshots: target movements cannot silently reveal a new card.
        return { face: game.phase === 'finished' || initial || flash ? card : null };
      }),
    })),
    deckCount: game.deck.length, discard: game.discards.at(-1) ?? null,
    opportunity: game.opportunity, calledBy: game.calledBy,
    finalTurns: game.finalTurns, deadline: game.deadline,
    winners: game.winners, message: game.message,
    drawn: isActive ? game.drawn : null, hasDrawn: !!game.drawn,
    power: power ? { rank: power.rank, step: power.step, reveals: power.reveals } : null,
    activePower: game.power?.rank ?? null,
    transfer: game.transfer, exhausted: game.exhausted, serverTime: now,
  };
}
export type GameView = ReturnType<typeof viewFor> & { connectedIds: string[] };
