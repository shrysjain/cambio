export type Suit = 'clubs' | 'diamonds' | 'hearts' | 'spades' | 'joker';
export type Card = { rank: number; suit: Suit };
export type Target = { playerId: string; slot: number };
export type QueenRule = 'look-then-swap' | 'swap-then-look';
export type SwapEvent = { id: string; actorId: string; a: Target; b: Target; at: number };
export type CardPlace = Target | 'draw' | 'discard';
export type CardMove = { from: CardPlace; to: CardPlace };
export type MotionEvent = { id: string; actorId: string; kind: 'draw' | 'discard' | 'replace' | 'match' | 'penalty' | 'give'; moves: CardMove[]; at: number };
export type Player = {
  id: string; name: string; hand: (Card | null)[]; ready: boolean;
  initial: 'waiting' | 'viewing' | 'done';
  initialCards: ['waiting' | 'viewing' | 'done', 'waiting' | 'viewing' | 'done'];
};
export type Power = {
  rank: number; step: 'own' | 'other' | 'view' | 'swap' | 'received';
  reveals: { target: Target; card: Card }[];
  received?: { target: Target; card: Card }[];
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
  lastSwap?: SwapEvent | null;
  motions?: MotionEvent[];
  queenRule?: QueenRule;
};
export type Action =
  | { type: 'ready' | 'start' | 'reveal-initial' | 'close-initial' | 'draw' | 'discard' | 'close-peek' | 'skip-power' | 'cambio' | 'end-game' }
  | { type: 'replace' | 'peek' | 'hide-peek'; target: Target }
  | { type: 'flip-initial'; slot: number }
  | { type: 'swap'; a: Target; b: Target }
  | { type: 'match'; target: Target; opportunityId: string }
  | { type: 'give'; slot: number }
  | { type: 'remove'; playerId: string }
  | { type: 'set-queen-rule'; rule: QueenRule };

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
  game.players.push({ id, name, hand: [], ready: false, initial: 'waiting', initialCards: ['waiting', 'waiting'] });
  game.version++;
}
export function newGame(code: string, id: string, name: string, now = Date.now()): Game {
  return {
    code, hostId: id, players: [{ id, name, hand: [], ready: false, initial: 'waiting', initialCards: ['waiting', 'waiting'] }],
    phase: 'lobby', deck: [], discards: [], active: 0, turns: 0, drawn: null,
    power: null, turnComplete: false, opportunity: null, transfer: null,
    calledBy: null, finalTurns: null, exhausted: false, deadline: null,
    winners: [], gameNumber: 0, version: 0, message: 'Waiting for friends.', updatedAt: now, flash: null, lastSwap: null, queenRule: 'look-then-swap',
  };
}
function begin(game: Game): void {
  const candidates = game.players.filter(p => game.winners.includes(p.id));
  const starter = candidates.length ? candidates[randomIndex(candidates.length)] : game.players[randomIndex(game.players.length)];
  game.active = game.players.findIndex(p => p.id === starter.id);
  game.deck = shuffledDeck();
  for (const p of game.players) {
    p.hand = []; p.ready = false; p.initial = 'waiting'; p.initialCards = ['waiting', 'waiting'];
  }
  for (let i = 0; i < 4; i++) for (const p of game.players) p.hand.push(game.deck.pop()!);
  game.phase = 'peek'; game.discards = []; game.turns = 0;
  game.drawn = null; game.power = null; game.turnComplete = false;
  game.opportunity = null; game.transfer = null; game.calledBy = null;
  game.finalTurns = null; game.exhausted = false; game.deadline = null;
  game.winners = []; game.flash = null; game.lastSwap = null; game.motions = []; game.gameNumber++;
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
function recordMotion(game: Game, actorId: string, kind: MotionEvent['kind'], moves: CardMove[], now: number): void {
  const place = (p: CardPlace): CardPlace => typeof p === 'string' ? p : { playerId: p.playerId, slot: p.slot };
  // Explicitly copy positions only; never serialize action extras or card values.
  game.motions = [...(game.motions ?? []), {
    id: crypto.randomUUID(), actorId, kind, at: now,
    moves: moves.map(m => ({ from: place(m.from), to: place(m.to) })),
  }].slice(-12);
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
function updateInitial(game: Game, player: Player): void {
  player.initial = player.initialCards.every(s => s === 'done') ? 'done' : player.initialCards.every(s => s === 'waiting') ? 'waiting' : 'viewing';
  if (game.players.every(p => p.initial === 'done')) {
    game.phase = 'playing'; game.message = `${game.players[game.active].name} goes first.`;
  }
}
export function applyAction(game: Game, id: string, action: Action, now = Date.now()): void {
  const player = playerById(game, id);
  ensure(action && typeof action.type === 'string', 'Invalid action.');
  // Deadline admission is checked before all actions, not only by a timer callback.
  if (game.phase === 'ending' && game.deadline !== null && now >= game.deadline) {
    ensure(action.type === 'give', 'The matching window has closed.');
  }
  if (action.type === 'set-queen-rule') {
    ensure(id === game.hostId && (game.phase === 'lobby' || game.phase === 'finished'), 'Only the host can change the Queen rule between games.');
    ensure(action.rule === 'look-then-swap' || action.rule === 'swap-then-look', 'Choose a valid Queen rule.');
    if ((game.queenRule ?? 'look-then-swap') !== action.rule) {
      game.queenRule = action.rule;
      for (const p of game.players) p.ready = false;
      game.message = `Queen power: ${action.rule === 'look-then-swap' ? 'look then swap' : 'swap then look'}. Everyone must ready up again.`;
    }
  } else if (action.type === 'ready') {
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
    player.initialCards ??= [player.initial, player.initial];
    ensure(game.phase === 'peek' && player.initialCards.some(s => s === 'waiting'), 'Your initial peek is already complete.');
    player.initialCards = player.initialCards.map(s => s === 'waiting' ? 'viewing' : s) as Player['initialCards'];
    updateInitial(game, player);
  } else if (action.type === 'flip-initial') {
    player.initialCards ??= [player.initial, player.initial];
    ensure(game.phase === 'peek' && (action.slot === 2 || action.slot === 3), 'Only your bottom two cards can be viewed initially.');
    const i = action.slot - 2;
    ensure(player.initialCards[i] !== 'done', 'You have already finished looking at that card.');
    player.initialCards[i] = player.initialCards[i] === 'waiting' ? 'viewing' : 'done';
    updateInitial(game, player);
  } else if (action.type === 'close-initial') {
    ensure(game.phase === 'peek' && player.initial === 'viewing', 'Reveal your bottom two cards first.');
    player.initialCards = ['done', 'done']; updateInitial(game, player);
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
      recordMotion(game, id, 'penalty', [
        { from: action.target, to: action.target },
        ...(penalty ? [{ from: 'draw' as const, to: { playerId: id, slot: player.hand.length - 1 } }] : []),
      ], now);
      game.message = `${player.name} missed on ${owner.name}’s card ${action.target.slot + 1}${penalty ? ` and drew penalty card ${player.hand.length}` : '; the deck is empty'}.`;
      if (game.exhausted && game.phase === 'playing' && !game.drawn && !game.power) ending(game, now);
    } else {
      game.opportunity.open = false;
      owner.hand[action.target.slot] = null;
      game.discards.push(card); // Covers the discard without opening another opportunity.
      if (owner.id !== id) game.transfer = { from: id, to: action.target };
      recordMotion(game, id, 'match', [{ from: action.target, to: 'discard' }], now);
      game.message = `${player.name} matched ${owner.id === id ? 'their own' : `${owner.name}’s`} card ${action.target.slot + 1}.`;
    }
  } else if (action.type === 'give') {
    ensure(game.transfer?.from === id, 'There is no card for you to give.');
    const card = player.hand[action.slot];
    ensure(card, 'Choose one of your cards to give.');
    const recipient = playerById(game, game.transfer.to.playerId);
    ensure(recipient.id !== game.calledBy, 'The caller’s hand is locked.');
    recipient.hand[game.transfer.to.slot] = card;
    player.hand[action.slot] = null;
    recordMotion(game, id, 'give', [{ from: { playerId: id, slot: action.slot }, to: game.transfer.to }], now);
    game.message = `${player.name} gave card ${action.slot + 1} to ${recipient.name}’s position ${game.transfer.to.slot + 1}.`;
    game.transfer = null;
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
      recordMotion(game, id, 'draw', [{ from: 'draw', to: 'draw' }], now);
    } else if (action.type === 'replace') {
      ensure(game.drawn && !game.power && action.target.playerId === id, 'Choose one of your cards to replace.');
      const { card } = targetCard(game, action.target, true);
      player.hand[action.target.slot] = game.drawn;
      publishDiscard(game, card);
      recordMotion(game, id, 'replace', [{ from: action.target, to: 'discard' }, { from: 'draw', to: action.target }], now);
      game.message = `${player.name} replaced card ${action.target.slot + 1}.`;
      finishTurn(game, now);
    } else if (action.type === 'discard') {
      ensure(game.drawn && !game.power, 'Draw a card first.');
      const card = game.drawn;
      publishDiscard(game, card); game.drawn = null;
      recordMotion(game, id, 'discard', [{ from: 'draw', to: 'discard' }], now);
      if (card.rank >= 7 && card.rank <= 13) {
        const step = card.rank === 11 || (card.rank === 12 && game.queenRule === 'swap-then-look') ? 'swap' : card.rank === 9 || card.rank === 10 ? 'other' : 'own';
        game.power = { rank: card.rank, step, reveals: [] };
        game.message = `${player.name} can use a ${rankLabel(card.rank)} power.`;
      } else {
        game.message = `${player.name} discarded.`; finishTurn(game, now);
      }
    } else if (action.type === 'peek') {
      const power = game.power;
      ensure(power && (power.step === 'own' || power.step === 'other' || power.step === 'received'), 'There is no card to peek at now.');
      if (power.step !== 'received') ensure(power.step === 'own' ? action.target.playerId === id : action.target.playerId !== id, power.step === 'own' ? 'Choose one of your cards.' : 'Choose another player’s card.');
      const { card } = targetCard(game, action.target, false);
      if (power.step === 'received') ensure(power.received?.some(r => r.target.playerId === action.target.playerId && r.target.slot === action.target.slot && r.card.rank === card.rank && r.card.suit === card.suit), 'Choose one of the cards you received in this swap. That card may have moved.');
      power.reveals.push({ target: action.target, card });
      power.step = power.rank === 13 && power.step === 'own' ? 'other' : 'view';
    } else if (action.type === 'close-peek') {
      ensure(game.power?.step === 'view', 'Finish choosing your peek.');
      const rank = game.power.rank;
      game.power.reveals = [];
      if ((rank === 12 && game.queenRule !== 'swap-then-look') || rank === 13) game.power.step = 'swap';
      else finishTurn(game, now);
    } else if (action.type === 'hide-peek') {
      const power = game.power;
      ensure(power && power.reveals.some(r => r.target.playerId === action.target.playerId && r.target.slot === action.target.slot), 'That card is not being peeked at.');
      power.reveals = power.reveals.filter(r => r.target.playerId !== action.target.playerId || r.target.slot !== action.target.slot);
      if (power.step === 'view' && power.reveals.length === 0) {
        if ((power.rank === 12 && game.queenRule !== 'swap-then-look') || power.rank === 13) power.step = 'swap';
        else finishTurn(game, now);
      }
    } else if (action.type === 'skip-power') {
      ensure(game.power, 'There is no power to skip.');
      finishTurn(game, now);
    } else if (action.type === 'swap') {
      ensure(game.power?.step === 'swap', 'There is no swap available.');
      ensure(action.a.playerId !== action.b.playerId || action.a.slot !== action.b.slot, 'Choose two different cards.');
      const a = targetCard(game, action.a, true), b = targetCard(game, action.b, true);
      a.player.hand[action.a.slot] = b.card; b.player.hand[action.b.slot] = a.card;
      game.lastSwap = {
        id: crypto.randomUUID(), actorId: id, at: now,
        a: { playerId: a.player.id, slot: action.a.slot },
        b: { playerId: b.player.id, slot: action.b.slot },
      };
      game.message = `${player.name} swapped ${a.player.name}’s card ${action.a.slot + 1} with ${b.player.name}’s card ${action.b.slot + 1}.`;
      if (game.power.rank === 12 && game.queenRule === 'swap-then-look') {
        const received = [game.lastSwap.a, game.lastSwap.b].filter(t => t.playerId === id).map(target => ({ target, card: player.hand[target.slot]! }));
        if (received.length === 1) game.power = { rank: 12, step: 'view', reveals: received };
        else if (received.length === 2) game.power = { rank: 12, step: 'received', reveals: [], received };
        else finishTurn(game, now);
      } else finishTurn(game, now);
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
  playerById(game, id);
  const isActive = game.players[game.active]?.id === id;
  const power = isActive ? game.power : null;
  return {
    code: game.code, hostId: game.hostId, phase: game.phase,
    activeId: game.players[game.active]?.id, turns: game.turns,
    gameNumber: game.gameNumber, version: game.version,
    players: game.players.map(p => ({
      id: p.id, name: p.name, ready: p.ready, initial: p.initial,
      initialCards: p.id === id ? p.initialCards ?? [p.initial, p.initial] : null,
      count: p.hand.filter(Boolean).length,
      score: game.phase === 'finished' ? score(p) : null,
      hand: p.hand.map((card, slot) => {
        if (!card) return null;
        const initial = game.phase === 'peek' && (slot === 2 || slot === 3) && (p.initialCards?.[slot - 2] ?? p.initial) === 'viewing';
        const powerPeek = game.power?.reveals.some(r => r.target.playerId === p.id && r.target.slot === slot && r.card.rank === card.rank && r.card.suit === card.suit) ?? false;
        const peeking = isActive && powerPeek;
        // Publish only who is looking at this position. Card faces stay private.
        const peekedBy = initial ? p.id : powerPeek ? game.players[game.active].id : null;
        const flash = game.flash && game.flash.until > now && game.flash.target.playerId === p.id && game.flash.target.slot === slot && game.flash.card.rank === card.rank && game.flash.card.suit === card.suit;
        // Power reveals are separate snapshots: target movements cannot silently reveal a new card.
        return { face: game.phase === 'finished' || (initial && p.id === id) || flash || peeking ? card : null, peeking, peekedBy };
      }),
    })),
    deckCount: game.deck.length, discard: game.discards.at(-1) ?? null,
    opportunity: game.opportunity, calledBy: game.calledBy,
    finalTurns: game.finalTurns, deadline: game.deadline,
    winners: game.winners, message: game.message,
    drawn: isActive ? game.drawn : null, hasDrawn: !!game.drawn,
    power: power ? { rank: power.rank, step: power.step, reveals: power.reveals,
      received: (power.received ?? []).filter(r => {
        const card = game.players.find(p => p.id === r.target.playerId)?.hand[r.target.slot];
        return card?.rank === r.card.rank && card?.suit === r.card.suit;
      }).map(r => r.target),
    } : null,
    activePower: game.power?.rank ?? null,
    transfer: game.transfer, exhausted: game.exhausted, serverTime: now,
    lastSwap: game.lastSwap ?? null,
    motions: game.motions ?? [],
    queenRule: game.queenRule ?? 'look-then-swap',
  };
}
export type GameView = ReturnType<typeof viewFor> & { connectedIds: string[] };
