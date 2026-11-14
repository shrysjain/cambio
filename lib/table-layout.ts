import type { MotionEvent } from './game';
/** Slot coordinates stay anchored even when a hand gains or loses cards. */
export function handPosition(slot: number, opposite = false) {
  const row = slot < 4 ? Math.floor(slot / 2) : (slot - 4) % 2;
  const column = slot < 4 ? slot % 2 : Math.floor((slot - 4) / 2) + 2;
  return opposite ? { row: 1 - row, column: 1 - column } : { row, column };
}

export const handColumns = (slots: number) => Math.max(2, Math.ceil(slots / 2));

export function handViewport(slots: number, cardWidth: number, gap: number, cap: number, opposite: boolean) {
  const base = cardWidth * 2 + gap;
  const total = handColumns(slots) * (cardWidth + gap) - gap;
  const visible = Math.min(total, Math.max(base, cap));
  return { base, total, visible, left: opposite ? base - visible : 0, canvas: opposite ? total - base : 0, origin: (opposite ? visible - base / 2 : base / 2) + 10 };
}

/** Seat geometry depends on the table, never on changing hand sizes. */
export function tableLayout(opponents: number, width: number, height: number) {
  const crowded = opponents >= 6;
  const cardWidth = crowded ? 36 : 44, cardHeight = crowded ? 50 : 60;
  const ownWidth = height < 700 || crowded ? 50 : 66, ownHeight = ownWidth === 50 ? 68 : 90;
  const actionWidth = Math.min(320, width / 2 - 130);
  const ownCap = crowded ? Math.min(320, width * .32) : Math.min(380, width - 32 - actionWidth - 20 - (width / 2 - (ownWidth * 2 + 8) / 2));
  const seats = Array.from({ length: opponents }, (_, i) => {
    if (crowded) {
      if (i < 5) return { x: width * (.14 + .18 * i), y: 16, tilt: (i - 2) * 5, cap: 122 };
      const side = i - 5;
      return { x: width * (side % 2 ? .92 : .14), y: height * (side < 2 ? .37 : .68), tilt: side % 2 ? 8 : -8, cap: 122 };
    }
    const t = opponents <= 1 ? 0 : i * 2 / (opponents - 1) - 1;
    const cap = opponents <= 1 ? 240 : opponents <= 3 ? 180 : opponents === 4 ? 140 : Math.min(140, Math.max(100, (width - 600) / 5));
    const margin = cap + 20;
    return { x: opponents === 1 ? width / 2 : margin + (width - 2 * margin) * (t + 1) / 2,
      y: 16 + (opponents <= 2 ? 65 : opponents === 3 ? 100 : 120) * Math.abs(t) ** 1.7, tilt: t * 18, cap };
  });
  return { crowded, cardWidth, cardHeight, ownWidth, ownHeight, ownCap, seats };
}

export function resultTitle(winners: string[], names: { id: string; name: string }[]) {
  if (winners.length > 1) return 'A shared victory';
  return `${names.find(p => p.id === winners[0])?.name ?? 'The winner'} takes the table`;
}

export const turnTitle = (phase: string | undefined, activeId: string | undefined, yourId: string | undefined, connected: boolean) => connected && phase === 'playing' && !!yourId && activeId === yourId ? 'Your turn · Cambio' : 'Cambio';

export function matchActivity(event: MotionEvent, players: { id: string; name: string }[]) {
  if (!['match', 'penalty', 'give'].includes(event.kind)) return null;
  const from = event.moves[0]?.from, to = event.moves[0]?.to;
  if (!from || typeof from === 'string') return null;
  const name = (id: string) => players.find(p => p.id === id)?.name ?? 'Player';
  const owner = from.playerId === event.actorId ? 'their own' : `${name(from.playerId)}’s`;
  if (event.kind === 'give' && to && typeof to !== 'string') return `${name(event.actorId)} gave #${from.slot + 1} to ${name(to.playerId)}’s #${to.slot + 1}`;
  return `${name(event.actorId)} ${event.kind === 'match' ? 'matched' : 'missed'} ${owner} #${from.slot + 1}${event.kind === 'penalty' ? ' · penalty card' : ''}`;
}
