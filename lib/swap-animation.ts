import type { SwapEvent } from './game';

/** Animate public positions using newly constructed card backs, never cloned faces. */
export function animateSwap(board: HTMLElement, swap: SwapEvent): () => void {
  const cards = [...board.querySelectorAll<HTMLElement>('[data-card-key]')];
  const a = cards.find(card => card.dataset.cardKey === `${swap.a.playerId}:${swap.a.slot}`);
  const b = cards.find(card => card.dataset.cardKey === `${swap.b.playerId}:${swap.b.slot}`);
  if (!a || !b) return () => {};

  const ghosts: HTMLElement[] = [];
  const animations: Animation[] = [];
  const timers: ReturnType<typeof setTimeout>[] = [];
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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
  const positions = [pose(a), pose(b)];
  for (const [index, original] of [a, b].entries()) {
    original.classList.add('swap-recent');
    if (reduced) continue;
    const from = positions[index], to = positions[1 - index];
    const ghost = document.createElement('div');
    ghost.className = `playing-card face-down swap-ghost${original.classList.contains('small') ? ' small' : ''}`;
    ghost.setAttribute('aria-hidden', 'true');
    const mark = document.createElement('span');
    mark.className = 'card-back-mark';
    for (let i = 0; i < 4; i++) mark.append(document.createElement('i'));
    ghost.append(mark);
    Object.assign(ghost.style, {
      left: `${from.x - from.width / 2}px`, top: `${from.y - from.height / 2}px`,
      width: `${from.width}px`, height: `${from.height}px`,
    });
    document.body.append(ghost);
    ghosts.push(ghost);
    original.classList.add('swap-origin');
    const dx = to.x - from.x, dy = to.y - from.y;
    animations.push(ghost.animate([
      { transform: `translate(0px, 0px) rotate(${from.angle}deg) scale(1, 1)` },
      { transform: `translate(${dx / 2}px, ${dy / 2 + (index ? 22 : -22)}px) rotate(${(from.angle + to.angle) / 2}deg) scale(${(1 + to.width / from.width) / 2}, ${(1 + to.height / from.height) / 2})`, offset: .5 },
      { transform: `translate(${dx}px, ${dy}px) rotate(${to.angle}deg) scale(${to.width / from.width}, ${to.height / from.height})` },
    ], { duration: 600, easing: 'cubic-bezier(.25,.65,.25,1)', fill: 'forwards' }));
  }
  const land = () => {
    for (const animation of animations) animation.cancel();
    for (const ghost of ghosts) ghost.remove();
    a.classList.remove('swap-origin'); b.classList.remove('swap-origin');
  };
  if (!reduced) timers.push(setTimeout(land, 600));
  timers.push(setTimeout(() => { a.classList.remove('swap-recent'); b.classList.remove('swap-recent'); }, 2000));
  return () => {
    for (const timer of timers) clearTimeout(timer);
    land();
    a.classList.remove('swap-recent'); b.classList.remove('swap-recent');
  };
}
