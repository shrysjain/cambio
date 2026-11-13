import type { CardMove, CardPlace, MotionEvent, SwapEvent } from './game';

const keyFor = (place: CardPlace) => typeof place === 'string' ? place : `${place.playerId}:${place.slot}`;
const highlights = new WeakMap<HTMLElement, Map<string, number>>();
function retainHighlight(card: HTMLElement, name: string) {
  const counts = highlights.get(card) ?? new Map<string, number>();
  counts.set(name, (counts.get(name) ?? 0) + 1); highlights.set(card, counts);
  card.classList.add(name);
}
function releaseHighlight(card: HTMLElement, name: string) {
  const counts = highlights.get(card), count = (counts?.get(name) ?? 1) - 1;
  if (count > 0) counts?.set(name, count);
  else { counts?.delete(name); card.classList.remove(name); }
}

/** Construct only card backs: private faces and labels must never enter public animations. */
function animateMoves(board: HTMLElement, moves: CardMove[], swapping: boolean): () => void {
  const cards = [...board.querySelectorAll<HTMLElement>('[data-card-key]')];
  const ghosts: HTMLElement[] = [], animations: Animation[] = [];
  const timers: ReturnType<typeof setTimeout>[] = [];
  const highlighted = new Set<HTMLElement>(), dimmed = new Set<HTMLElement>();
  const recentClass = swapping ? 'swap-recent' : 'motion-recent';
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const duration = swapping ? 600 : 420;
  const pose = (card: HTMLElement) => {
    const rect = card.getBoundingClientRect();
    const transform = getComputedStyle(card.parentElement!).transform;
    const matrix = transform === 'none' ? null : new DOMMatrixReadOnly(transform);
    return {
      x: rect.left + rect.width / 2, y: rect.top + rect.height / 2,
      width: card.offsetWidth, height: card.offsetHeight,
      angle: matrix ? Math.atan2(matrix.b, matrix.a) * 180 / Math.PI : 0,
    };
  };
  for (const [index, move] of moves.entries()) {
    const a = cards.find(card => card.dataset.cardKey === keyFor(move.from));
    const b = cards.find(card => card.dataset.cardKey === keyFor(move.to));
    if (!a || !b) continue;
    for (const card of [a, b]) if (!highlighted.has(card)) { retainHighlight(card, recentClass); highlighted.add(card); }
    if (reduced) continue;
    const from = pose(a), to = pose(b), self = a === b;
    const ghost = document.createElement('div');
    ghost.className = `playing-card face-down swap-ghost${a.classList.contains('small') ? ' small' : ''}`;
    ghost.setAttribute('aria-hidden', 'true');
    const mark = document.createElement('span');
    mark.className = 'card-back-mark';
    for (let i = 0; i < 4; i++) mark.append(document.createElement('i'));
    ghost.append(mark);
    Object.assign(ghost.style, {
      left: `${from.x - from.width / 2}px`, top: `${from.y - from.height / 2}px`,
      width: `${from.width}px`, height: `${from.height}px`,
    });
    document.body.append(ghost); ghosts.push(ghost);
    if (swapping) { a.classList.add('swap-origin'); dimmed.add(a); }
    const dx = to.x - from.x, dy = to.y - from.y;
    animations.push(ghost.animate([
      { transform: `translate(0px, 0px) rotate(${from.angle}deg) scale(1, 1)`, opacity: 1 },
      { transform: `translate(${dx / 2}px, ${dy / 2 + (self ? -22 : index ? 18 : -18)}px) rotate(${(from.angle + to.angle) / 2}deg) scale(${(1 + to.width / from.width) / 2}, ${(1 + to.height / from.height) / 2})`, offset: .5, opacity: 1 },
      { transform: `translate(${dx}px, ${dy}px) rotate(${to.angle}deg) scale(${to.width / from.width}, ${to.height / from.height})`, opacity: self ? 0 : 1 },
    ], { duration, easing: 'cubic-bezier(.25,.65,.25,1)', fill: 'forwards' }));
  }
  const land = () => {
    for (const animation of animations) animation.cancel();
    for (const ghost of ghosts) ghost.remove();
    for (const card of dimmed) card.classList.remove('swap-origin');
  };
  if (!reduced) timers.push(setTimeout(land, duration));
  let released = false;
  const release = () => { if (released) return; released = true; for (const card of highlighted) releaseHighlight(card, recentClass); };
  timers.push(setTimeout(release, 1800));
  return () => {
    for (const timer of timers) clearTimeout(timer);
    land();
    release();
  };
}

export const animateSwap = (board: HTMLElement, swap: SwapEvent) => animateMoves(board, [
  { from: swap.a, to: swap.b }, { from: swap.b, to: swap.a },
], true);

export const animateMotion = (board: HTMLElement, event: MotionEvent) => animateMoves(board, event.moves, false);
