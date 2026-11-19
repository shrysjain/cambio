import { addPlayer, DISCONNECT_GRACE_MS, type Game } from './game';

const betweenGames = (game: Game) => game.phase === 'lobby' || game.phase === 'finished';

export function joinRoom(game: Game, id: string, name: string, now = Date.now()) {
  if ([...game.players, ...(game.spectators ?? [])].some(p => p.name.toLowerCase() === name.toLowerCase())) throw new Error('That name is already taken in this room.');
  if (betweenGames(game) && game.players.length < 10 && !(game.spectators ?? []).some(s => s.queuedAt !== null)) {
    if (game.phase === 'finished') game.resultPlayerIds ??= game.players.map(p => p.id);
    addPlayer(game, id, name);
  } else {
    game.spectators ??= [];
    if (game.spectators.length >= 20) throw new Error('The spectator area is full. Try again later.');
    game.spectators.push({ id, name, queuedAt: now, disconnectedAt: now });
    game.version++;
  }
}

export function switchToSpectating(game: Game, id: string, now = Date.now()) {
  if (!betweenGames(game)) throw new Error('You can switch to spectating only between games.');
  const player = game.players.find(p => p.id === id);
  if (!player) throw new Error('Only seated players can switch to spectating.');
  if ((game.spectators?.length ?? 0) >= 20) throw new Error('The spectator area is full. Try again later.');
  if (game.phase === 'finished') {
    game.resultPlayerIds ??= game.players.map(p => p.id);
    game.resultPlayers ??= structuredClone(game.players.filter(p => game.resultPlayerIds!.includes(p.id)));
  }
  game.players = game.players.filter(p => p.id !== id);
  game.spectators ??= [];
  game.spectators.push({ id, name: player.name, queuedAt: null });
  for (const p of game.players) p.ready = false;
  if (game.disconnectedAt) delete game.disconnectedAt[id];
  game.updatedAt = now;
  game.version++;
}

export function setQueued(game: Game, id: string, queued: boolean, now = Date.now()) {
  const spectator = game.spectators?.find(s => s.id === id);
  if (!spectator) throw new Error('Only spectators can join or leave the waiting list.');
  if (typeof queued !== 'boolean') throw new Error('Choose whether to join the waiting list.');
  game.updatedAt = now;
  spectator.queuedAt = queued ? spectator.queuedAt ?? now : null;
  game.version++;
}

/** Scores are finalized before this runs; new seats never enter the previous result. */
export function promoteQueued(game: Game, connectedIds: string[]) {
  if (!betweenGames(game)) return [];
  const available = 10 - game.players.length;
  const candidates = (game.spectators ?? []).filter(s => s.queuedAt !== null && connectedIds.includes(s.id))
    .sort((a, b) => a.queuedAt! - b.queuedAt!).slice(0, Math.max(0, available));
  if (!candidates.length) return [];
  if (game.phase === 'finished') game.resultPlayerIds ??= game.players.map(p => p.id);
  for (const member of candidates) addPlayer(game, member.id, member.name);
  const ids = candidates.map(s => s.id);
  game.spectators = game.spectators!.filter(s => !ids.includes(s.id));
  return ids;
}

export function syncSpectators(game: Game, connectedIds: string[], now = Date.now()) {
  const expired: string[] = [];
  game.spectators = (game.spectators ?? []).filter(s => {
    if (connectedIds.includes(s.id)) delete s.disconnectedAt;
    else s.disconnectedAt ??= now;
    if (s.disconnectedAt !== undefined && now - s.disconnectedAt >= DISCONNECT_GRACE_MS) { expired.push(s.id); return false; }
    return true;
  });
  if (expired.length) game.version++;
  return expired;
}

export function assignConnectedHost(game: Game, connectedIds: string[]) {
  if (!game.players.some(p => p.id === game.hostId) || !connectedIds.includes(game.hostId)) {
    const replacement = game.players.find(p => connectedIds.includes(p.id)) ?? game.players[0];
    game.hostId = replacement?.id ?? '';
  }
}
