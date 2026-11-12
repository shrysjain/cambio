'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { cardLabel, rankLabel, type Action, type Card, type GameView, type Target } from '@/lib/game';

type Seat = { code: string; playerId: string; token: string };
type Connection = 'connecting' | 'connected' | 'reconnecting' | 'closed';
const API = process.env.NEXT_PUBLIC_GAME_SERVER || (process.env.NODE_ENV === 'development' ? 'http://127.0.0.1:8787' : '');
const suits = { clubs: '♣', diamonds: '♦', hearts: '♥', spades: '♠', joker: '✦' };
const same = (a: Target | null, b: Target) => !!a && a.playerId === b.playerId && a.slot === b.slot;
const formatCode = (code: string) => code.length === 10 ? `${code.slice(0, 5)} ${code.slice(5)}` : code;

function Icon({ name, size = 18 }: { name: 'copy' | 'arrow' | 'users' | 'lock' | 'close' | 'check' | 'cards' | 'exit'; size?: number }) {
  const paths = {
    copy: <><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h4"/></>,
    arrow: <><path d="M4 12h15m-6-6 6 6-6 6"/></>,
    users: <><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 4v2"/></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><path d="M12 14v3"/></>,
    close: <path d="m6 6 12 12M6 18 18 6"/>,
    check: <path d="m5 12 4 4L19 6"/>,
    cards: <><rect x="8" y="6" width="12" height="16" rx="2"/><path d="m8 17-5-1a2 2 0 0 1-1-2L5 3a2 2 0 0 1 2-1l10 3"/></>,
    exit: <><path d="M9 4H4v16h5m5-12 4 4-4 4m-5-4h9"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
function PlayingCard({ face, onClick, disabled, selected, small, index = 0, position, label, highlight, empty }: {
  face?: Card | null; onClick?: () => void; disabled?: boolean; selected?: boolean;
  small?: boolean; index?: number; position?: number; label?: string; highlight?: boolean; empty?: boolean;
}) {
  const [shown, setShown] = useState(face);
  const [flipping, setFlipping] = useState(false);
  const previousFace = useRef(`${face?.rank}:${face?.suit}`);
  useEffect(() => {
    const key = `${face?.rank}:${face?.suit}`;
    if (previousFace.current === key) return;
    previousFace.current = key;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setShown(face); return; }
    setFlipping(true);
    const swap = setTimeout(() => setShown(face), 85);
    const finish = setTimeout(() => setFlipping(false), 180);
    return () => { clearTimeout(swap); clearTimeout(finish); };
  }, [face?.rank, face?.suit]);
  const red = shown?.suit === 'hearts' || shown?.suit === 'diamonds';
  const content = empty ? null : shown ? <>
    <span className="card-corner"><b>{rankLabel(shown.rank)}</b><span>{suits[shown.suit]}</span></span>
    <span className={`card-suit ${shown.rank === 0 ? 'joker-mark' : ''}`}>{suits[shown.suit]}</span>
    <span className="card-corner bottom"><b>{rankLabel(shown.rank)}</b><span>{suits[shown.suit]}</span></span>
  </> : <span className="card-back-mark" aria-hidden="true"><i/><i/><i/><i/></span>;
  const className = `playing-card ${shown ? 'face-up' : 'face-down'} ${flipping ? 'is-flipping' : ''} ${red ? 'red' : ''} ${selected ? 'selected' : ''} ${small ? 'small' : ''} ${highlight ? 'highlight' : ''} ${empty ? 'empty-slot' : ''}`;
  const style = { '--card-index': index, ...(position === undefined ? {} : { gridRow: position < 4 ? Math.floor(position / 2) + 1 : (position - 4) % 2 + 1, gridColumn: position < 4 ? position % 2 + 1 : Math.floor((position - 4) / 2) + 3 }) } as CSSProperties;
  return onClick ? <button type="button" className={className} onClick={onClick} disabled={disabled || empty} aria-label={label ?? (face ? cardLabel(face) : 'Face-down card')} aria-pressed={selected || undefined} style={style}>{content}</button>
    : <div className={className} role="img" aria-label={label ?? (face ? cardLabel(face) : 'Face-down card')} style={{ '--card-index': index } as CSSProperties}>{content}</div>;
}

const RULE_GROUPS = [
  ['The aim', 'Finish with the lowest total. A = 1, number cards = their number, J = 11, Q = 12, black K = 13, red K = −1, and Joker = 0.'],
  ['Your turn', 'Draw from the deck. Replace one of your cards, or discard the drawn card and optionally use its power. Replaced cards never activate powers.'],
  ['Powers', '7/8: peek at your card. 9/10: peek at someone else’s. J: blind swap. Q: peek at yours, then optionally swap. K: peek at yours and someone else’s, then optionally swap. Swap any two unlocked cards; they do not have to be the cards you viewed.'],
  ['Matching', 'On any turn, match a card to the discard by rank. First valid match wins. Match someone else’s card and give them one of yours. A wrong match goes back and you draw a penalty; you can try again. You do not need to wait for a power to finish.'],
  ['Cambio & the end', 'After two complete rounds, call Cambio at the start of your turn, before drawing. Your hand locks against swaps and matches; everyone else gets one final turn. Peeking at the caller is allowed. An empty hand stays in play. When the deck empties, finish in-progress play, then allow five seconds for matching before scoring.'],
];

export default function Home() {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [seat, setSeat] = useState<Seat | null>(null);
  const [state, setState] = useState<GameView | null>(null);
  const [connection, setConnection] = useState<Connection>('connecting');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [rules, setRules] = useState(false);
  const [matching, setMatching] = useState(false);
  const [selected, setSelected] = useState<Target | null>(null);
  const [copied, setCopied] = useState(false);
  const [dealing, setDealing] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const socket = useRef<WebSocket | null>(null);
  const latest = useRef<GameView | null>(null);
  const selectedVersion = useRef<number>(0);
  const pendingId = useRef<string | null>(null);
  const serverOffset = useRef(0);
  const knownGame = useRef<string>('');
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const room = (params.get('room') ?? '').replace(/[^a-z2-9]/gi, '').toUpperCase().slice(0, 10);
    setCode(room);
    try {
      setName(localStorage.getItem('cambio:name') ?? '');
      const saved = room ? localStorage.getItem(`cambio:seat:${room}`) : null;
      if (saved) setSeat(JSON.parse(saved));
    } catch { /* Storage is optional for joining; reconnect works while the tab stays open. */ }
  }, []);
  useEffect(() => {
    if (!seat || !API) return;
    let disposed = false, retry = 0, timer: ReturnType<typeof setTimeout>;
    let current: WebSocket;
    function connect() {
      if (disposed) return;
      setConnection(retry ? 'reconnecting' : 'connecting');
      const base = API.replace(/^http/, 'ws').replace(/\/$/, '');
      current = new WebSocket(`${base}/rooms/${seat!.code}/ws`);
      socket.current = current;
      current.onopen = () => current.send(JSON.stringify({ type: 'auth', playerId: seat!.playerId, token: seat!.token }));
      current.onmessage = event => {
        if (event.data === 'pong') return;
        let data;
        try { data = JSON.parse(event.data); } catch { return; }
        if (data.type === 'state') {
          const incoming = data.state as GameView;
          retry = 0; serverOffset.current = incoming.serverTime - Date.now();
          latest.current = incoming; setState(incoming); setConnection('connected');
          if (pendingId.current === null) setPending(false);
          const gameKey = `${incoming.code}:${incoming.gameNumber}`;
          if (incoming.phase === 'peek' && knownGame.current && knownGame.current !== gameKey) {
            setDealing(true); setTimeout(() => setDealing(false), 1600);
          }
          knownGame.current = gameKey;
        } else if (data.type === 'ack' && data.id === pendingId.current) {
          pendingId.current = null; setPending(false);
        } else if (data.type === 'error') {
          pendingId.current = null; setPending(false); setError(data.error); setSelected(null);
        }
      };
      current.onclose = event => {
        if (disposed) return;
        pendingId.current = null; setPending(false);
        if ([4001, 4003, 4004].includes(event.code)) {
          setConnection('closed'); setError(event.reason || 'Your connection has closed.');
          if (event.code !== 4001) { try { localStorage.removeItem(`cambio:seat:${seat!.code}`); } catch {} }
          return;
        }
        setConnection('reconnecting');
        timer = setTimeout(connect, Math.min(1000 * 2 ** retry++, 10000));
      };
      current.onerror = () => current.close();
    }
    connect();
    const heartbeat = setInterval(() => { if (current?.readyState === WebSocket.OPEN) current.send('ping'); }, 25000);
    const refresh = () => { if (document.visibilityState === 'visible' && current?.readyState === WebSocket.OPEN) current.send(JSON.stringify({ type: 'sync' })); };
    document.addEventListener('visibilitychange', refresh);
    return () => { disposed = true; clearTimeout(timer); clearInterval(heartbeat); document.removeEventListener('visibilitychange', refresh); current?.close(); socket.current = null; };
  }, [seat]);
  useEffect(() => {
    if (!state?.deadline) return;
    const timer = setInterval(() => setClock(Date.now()), 100);
    return () => clearInterval(timer);
  }, [state?.deadline]);
  useEffect(() => { setSelected(null); }, [state?.activeId, state?.phase]);
  useEffect(() => { setMatching(false); }, [state?.phase]);
  useEffect(() => { if (!state?.opportunity?.open) setMatching(false); }, [state?.opportunity?.open]);
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(''), 6500);
    return () => clearTimeout(timer);
  }, [error]);
  useEffect(() => { if (rules) dialog.current?.showModal(); else dialog.current?.close(); }, [rules]);

  const send = useCallback((action: Action, version?: number) => {
    if (socket.current?.readyState !== WebSocket.OPEN || pendingId.current) return;
    const id = crypto.randomUUID();
    pendingId.current = id; setPending(true); setError('');
    socket.current.send(JSON.stringify({ type: 'action', id, version: version ?? latest.current?.version, action }));
  }, []);
  useEffect(() => {
    function keys(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || rules) return;
      if (event.key === 'Escape') { setMatching(false); setSelected(null); }
      if (event.key.toLowerCase() === 'm' && latest.current && ['playing', 'ending'].includes(latest.current.phase)) { setMatching(m => !m); setSelected(null); }
    }
    window.addEventListener('keydown', keys);
    return () => window.removeEventListener('keydown', keys);
  }, [rules]);

  async function join(create: boolean, event?: FormEvent) {
    event?.preventDefault();
    if (!name.trim()) { setError('Enter your name to take a seat.'); return; }
    const clean = code.replace(/[^a-z2-9]/gi, '').toUpperCase();
    if (!create && clean.length !== 10) { setError('Enter the 10-character room code.'); return; }
    if (!API) { setError('The game server is unavailable. Please try again later.'); return; }
    setBusy(true); setError('');
    try {
      const response = await fetch(`${API.replace(/\/$/, '')}${create ? '/rooms' : `/rooms/${clean}/join`}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim() }), signal: AbortSignal.timeout(10000) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to join. Try again.');
      const next = result as Seat;
      try { localStorage.setItem('cambio:name', name.trim()); localStorage.setItem(`cambio:seat:${next.code}`, JSON.stringify(next)); } catch {}
      window.history.replaceState({}, '', `/?room=${next.code}`);
      knownGame.current = ''; setSeat(next);
    } catch (e) { setError(e instanceof TypeError ? 'Could not reach the game server. Try again in a moment.' : (e as Error).message); }
    finally { setBusy(false); }
  }
  async function copyInvite() {
    if (!state) return;
    try { await navigator.clipboard.writeText(`${window.location.origin}/?room=${state.code}`); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { setError(`Share this room code: ${formatCode(state.code)}`); }
  }
  function leave() {
    setSeat(null); setState(null); latest.current = null; knownGame.current = '';
    setMatching(false); setSelected(null); setError(''); window.history.replaceState({}, '', '/');
  }

  const me = state?.players.find(p => p.id === seat?.playerId);
  const active = state?.players.find(p => p.id === state.activeId);
  const isTurn = !!state && state.activeId === me?.id;
  const online = connection === 'connected';
  const locked = me?.id === state?.calledBy;
  const countdown = state?.deadline ? Math.max(0, Math.ceil((state.deadline - clock - serverOffset.current) / 1000)) : null;
  const canMatch = !!state && !locked && !state.transfer && state.opportunity?.open && (state.phase === 'playing' || (state.phase === 'ending' && (countdown ?? 0) > 0));
  const transferMine = !!state?.transfer && state.transfer.from === me?.id;
  function selectCard(target: Target) {
    if (!state || !me || pending || !online) return;
    if (state.phase === 'peek' && target.playerId === me.id) { send({ type: 'flip-initial', slot: target.slot }); return; }
    if (transferMine) { if (target.playerId === me.id) send({ type: 'give', slot: target.slot }); return; }
    if (matching && canMatch) { send({ type: 'match', target, opportunityId: state.opportunity!.id }); return; }
    if (!isTurn || state.phase !== 'playing') return;
    if (state.players.find(p => p.id === target.playerId)?.hand[target.slot]?.peeking) { send({ type: 'hide-peek', target }); return; }
    if (state.drawn && target.playerId === me.id) { send({ type: 'replace', target }); return; }
    if (state.power?.step === 'own' || state.power?.step === 'other') { send({ type: 'peek', target }); return; }
    if (state.power?.step === 'swap') {
      if (!selected) { setSelected(target); selectedVersion.current = state.version; }
      else if (same(selected, target)) setSelected(null);
      else { send({ type: 'swap', a: selected, b: target }, selectedVersion.current); setSelected(null); }
    }
  }
  function selectable(playerId: string, slot: number): boolean {
    if (!state || !me || pending || !online) return false;
    if (state.phase === 'peek') return playerId === me.id && (slot === 2 || slot === 3) && me.initialCards?.[slot - 2] !== 'done';
    if (state.transfer?.to.playerId === playerId && state.transfer.to.slot === slot) return false;
    if (transferMine) return playerId === me.id;
    if (matching && canMatch) return playerId !== state.calledBy && (playerId === me.id || me.count > 0);
    if (state.transfer || !isTurn || state.phase !== 'playing') return false;
    if (state.players.find(p => p.id === playerId)?.hand[slot]?.peeking) return true;
    if (state.drawn) return playerId === me.id;
    if (state.power?.step === 'own') return playerId === me.id;
    if (state.power?.step === 'other') return playerId !== me.id;
    return state.power?.step === 'swap' && playerId !== state.calledBy;
  }
  function prompt(): { title: string; detail: string } {
    if (!state || !me) return { title: 'Connecting to your table…', detail: 'Your seat will be ready in a moment.' };
    if (!online) return { title: connection === 'closed' ? 'Connection closed' : 'Reconnecting…', detail: 'Your seat and game are saved.' };
    if (transferMine) return { title: 'Choose a card to give', detail: `Select any of your cards to fill ${state.players.find(p => p.id === state.transfer!.to.playerId)?.name}’s empty spot.` };
    if (state.transfer) return { title: 'A match was made', detail: `Waiting for ${state.players.find(p => p.id === state.transfer!.from)?.name} to give a card.` };
    if (matching && canMatch) return { title: 'Choose a card to match', detail: `Match the ${state.discard ? rankLabel(state.discard.rank) : ''} on the discard pile. A wrong match adds a penalty card.` };
    if (state.phase === 'ending') return { title: countdown ? `Last chance to match · ${countdown}s` : 'Finishing the game…', detail: 'No more turns. The lowest hand total wins.' };
    if (state.phase === 'peek') return me.initial === 'waiting' ? { title: 'Get to know your hand', detail: 'Click a bottom card to flip it. Click again to hide it. Each opening peek is one-use.' }
      : me.initial === 'viewing' ? { title: 'Remember your cards', detail: 'Click a revealed card again to hide it, or finish looking below.' }
      : { title: 'Waiting for the table', detail: `${state.players.filter(p => p.initial === 'done').length} of ${state.players.length} players have finished looking.` };
    if (!isTurn) return { title: `${active?.name}’s turn`, detail: state.activePower ? `${active?.name} is using a ${rankLabel(state.activePower)} power. You can still match.` : state.hasDrawn ? `${active?.name} is deciding what to do with their card.` : 'Keep an eye on the discard pile. You can match on any turn.' };
    if (state.drawn) return { title: 'Keep it or discard it', detail: 'Click one of your cards to replace it, or discard the drawn card below.' };
    if (state.power) {
      const step = state.power.step;
      return step === 'own' ? { title: 'Peek at one of your cards', detail: 'Choose a card in your hand.' }
        : step === 'other' ? { title: 'Peek at another player’s card', detail: 'Choose any card in someone else’s hand, including the Cambio caller.' }
        : step === 'view' ? { title: 'Take a look', detail: 'Click the revealed card again to hide it and continue.' }
        : { title: selected ? 'Choose the second card' : 'Swap any two cards', detail: 'They can belong to anyone except the Cambio caller. Click a selected card to cancel.' };
    }
    return { title: 'Your turn', detail: state.turns >= state.players.length * 2 && !state.calledBy ? 'Draw a card, or call Cambio before drawing.' : 'Draw a card from the deck to begin.' };
  }
  const instruction = prompt();

  function hand(player: NonNullable<GameView['players'][number]>, own: boolean, seatIndex: number) {
    const isActive = state?.activeId === player.id && state?.phase === 'playing';
    const protectedHand = state?.calledBy === player.id;
    const opponents = state!.players.filter(p => p.id !== me?.id);
    const arcIndex = opponents.findIndex(p => p.id === player.id);
    const count = opponents.length;
    const arcPosition = count <= 1 ? 0 : arcIndex * 2 / (count - 1) - 1;
    const arcWidth = count === 2 ? 30 : count === 3 ? 38 : 42;
    const arcDepth = count <= 2 ? 80 : count <= 5 ? 180 : 210;
    const arcStyle = own ? undefined : { left: `${50 + arcWidth * arcPosition}%`, top: `${arcDepth * Math.pow(Math.abs(arcPosition), 1.7)}px`, '--hand-tilt': `${-arcPosition * 18}deg` } as CSSProperties;
    return <section key={player.id} style={arcStyle} className={`player-hand ${own ? 'own-hand' : 'opponent-hand'} ${isActive ? 'active-hand' : ''} ${protectedHand ? 'locked-hand' : ''}`} aria-label={`${player.name}${own ? ', your hand' : '’s hand'}${isActive ? ', current turn' : ''}`}>
      <div className="player-heading">
        <span className={`player-avatar avatar-${seatIndex % 5}`}>{player.name.slice(0, 1).toUpperCase()}</span>
        <span className="player-identity"><strong>{player.name}{own && <small>you</small>}</strong><span>{protectedHand ? <><Icon name="lock" size={11}/> Cambio</> : isActive ? `${own ? 'Your turn' : 'Their turn'}${state?.connectedIds.includes(player.id) ? '' : ' · offline'}` : !state?.connectedIds.includes(player.id) ? 'Reconnecting' : `${player.count} ${player.count === 1 ? 'card' : 'cards'}`}</span></span>
        {isActive && <span className="turn-dot" aria-label="Current turn"/>}
      </div>
      <div className={`hand-grid ${player.hand.length > 4 ? 'expanded-hand' : ''}`}>
        {player.hand.map((slot, index) => {
          const target = { playerId: player.id, slot: index };
          const face = online || state?.phase === 'finished' ? slot?.face : null;
          return <PlayingCard key={index} face={face} empty={!slot} small={!own} onClick={() => selectCard(target)} disabled={!selectable(player.id, index)} selected={same(selected, target)} highlight={!!slot && selectable(player.id, index)} position={index} index={seatIndex * 3 + index} label={!slot ? 'Empty card position' : `${own ? 'Your' : player.name + '’s'} card ${index + 1}, ${face ? cardLabel(face) : 'face down'}`}/>;
        })}
        {player.count === 0 && <span className="empty-hand-note">No cards · still in play</span>}
      </div>
    </section>;
  }

  return <div className={`app ${seat ? 'at-table' : ''}`}>
    <header className="site-header">
      <button className="wordmark" onClick={() => { if (seat) leave(); else window.history.replaceState({}, '', '/'); }} aria-label="Cambio home"><Icon name="cards" size={26}/><span>cambio</span></button>
      <div className="header-right">{state && <span className={`connection-status ${online ? '' : 'offline'}`}><i/>{online ? 'Connected' : connection === 'closed' ? 'Disconnected' : 'Reconnecting'}</span>}<button className="text-button" onClick={() => setRules(true)}>How to play</button>{seat && <button className="icon-button" title="Leave table (your seat is saved)" aria-label="Leave table" onClick={leave}><Icon name="exit"/></button>}</div>
    </header>

    {!seat ? <main className="home">
      <section className="welcome-panel">
        <span className="eyebrow"><Icon name="users" size={15}/> Private games with friends</span>
        <h1>Cambio,<br/>with friends.</h1>
        <p className="home-description">Create a private table or join with a room code.<br/>Remember your cards. Aim for the lowest score.</p>
        <form className="join-form" onSubmit={e => join(false, e)}>
          <label htmlFor="player-name">Your name</label>
          <input id="player-name" autoComplete="nickname" maxLength={24} value={name} onChange={e => setName(e.target.value)} placeholder="What should we call you?" disabled={busy}/>
          <button className="button primary create-button" type="button" onClick={() => join(true)} disabled={busy}>{busy ? 'Taking your seat…' : 'Create a private room'}<Icon name="arrow"/></button>
          <div className="form-divider"><span>or join your friends</span></div>
          <div className="join-row"><input aria-label="Room code" className="code-input" maxLength={12} value={formatCode(code)} onChange={e => setCode(e.target.value.replace(/[^a-z2-9]/gi, '').toUpperCase().slice(0, 10))} placeholder="ROOM CODE" disabled={busy}/><button className="button secondary" type="submit" disabled={busy}>Join room</button></div>
        </form>
        <p className="privacy-note"><Icon name="lock" size={13}/> Private rooms · 2–10 players · No account needed</p>
      </section>
      <section className="home-table-art" aria-label="A four-card Cambio hand">
        <div className="art-table"><div className="art-hand"><PlayingCard/><PlayingCard/><PlayingCard face={{ rank: 13, suit: 'hearts' }}/><PlayingCard face={{ rank: 0, suit: 'joker' }}/></div><span className="art-caption">Start with four.<br/>Remember two.</span></div>
        <span className="art-label">Red kings −1 · Jokers 0</span>
      </section>
    </main> : !state ? <main className="loading-view"><span className="spinner"/><h1>Taking your seat…</h1><p>{connection === 'closed' ? error : 'Connecting to your private table.'}</p><button className="button secondary" onClick={leave}>Back to home</button></main>
      : state.phase === 'lobby' ? <main className="lobby">
        <section className="lobby-main"><span className="eyebrow"><Icon name="lock" size={14}/> Private table</span><h1>Make room for friends.</h1><p className="muted">Share the invite, get everyone ready, and deal.</p>
          <button className="invite-box" onClick={copyInvite}><span><small>ROOM CODE</small><strong>{formatCode(state.code)}</strong></span><span className="invite-action"><Icon name={copied ? 'check' : 'copy'}/>{copied ? 'Copied link' : 'Copy invite'}</span></button>
          <div className="lobby-players"><div className="list-heading"><span>At the table</span><span>{state.players.length} / 10</span></div>{state.players.map((p, i) => <div className="lobby-player" key={p.id}><span className={`player-avatar avatar-${i % 5}`}>{p.name[0].toUpperCase()}</span><span className="lobby-player-name">{p.name}{p.id === me?.id && <small>you</small>}{p.id === state.hostId && <small className="host-label">host</small>}</span><span className={`ready-status ${p.ready ? 'is-ready' : ''}`}>{!state.connectedIds.includes(p.id) ? 'Disconnected' : p.ready ? <><Icon name="check" size={14}/> Ready</> : 'Not ready'}</span>{me?.id === state.hostId && p.id !== me.id && !state.connectedIds.includes(p.id) && <button className="text-button remove-player" onClick={() => send({ type: 'remove', playerId: p.id })}>Remove</button>}</div>)}</div>
          <div className="lobby-actions"><button className={`button ${me?.ready ? 'secondary' : 'primary'}`} disabled={pending || !online} onClick={() => send({ type: 'ready' })}>{me?.ready ? <><Icon name="check"/> You’re ready</> : 'Ready to play'}</button>{me?.id === state.hostId && <button className="button primary" onClick={() => send({ type: 'start' })} disabled={pending || !online || state.players.length < 2 || !state.players.every(p => p.ready && state.connectedIds.includes(p.id))}>Shuffle & deal <Icon name="arrow"/></button>}</div><p className="lobby-hint">{state.players.length < 2 ? 'Invite at least one friend to start.' : state.players.every(p => p.ready) ? me?.id === state.hostId ? 'Everyone is ready. Your table is waiting.' : 'Everyone is ready. Waiting for the host to deal.' : 'Everyone needs to be ready before the first deal.'}</p>
        </section><aside className="lobby-rules"><div className="mini-cards"><PlayingCard small/><PlayingCard small face={{ rank: 7, suit: 'spades' }}/></div><h2>The house rules</h2><p>Start with four cards.<br/>Remember your bottom two.<br/>Aim for the lowest score.</p><div className="power-cheatsheet"><span>7 / 8</span><p>Peek at your own</p><span>9 / 10</span><p>Peek at someone else’s</p><span>J</span><p>Blind swap</p><span>Q</span><p>Peek at yours, then swap</p><span>K</span><p>Peek at both, then swap</p></div><button className="text-button" onClick={() => setRules(true)}>Read all rules <Icon name="arrow" size={14}/></button></aside>
      </main> : state.phase === 'finished' ? <main className="results"><span className="eyebrow">Game {state.gameNumber} · Final scores</span><h1>{state.winners.length > 1 ? 'A shared victory.' : `${state.players.find(p => p.id === state.winners[0])?.name} takes the table.`}</h1><p className="muted">Lowest score wins. Ready for another?</p><div className="score-table">{[...state.players].sort((a, b) => a.score! - b.score!).map(p => <div className={`score-row ${state.winners.includes(p.id) ? 'winner' : ''}`} key={p.id}><span className="score-name">{p.name}{p.id === me?.id && <small>you</small>}{state.winners.includes(p.id) && <span className="winner-label">{state.winners.length > 1 ? 'Tied winner' : 'Winner'}</span>}</span><div className="score-cards">{p.hand.filter(Boolean).map((c, i) => <PlayingCard key={i} face={c!.face} small/>)}</div><strong className="score-value">{p.score}</strong><span className={`ready-status ${p.ready ? 'is-ready' : ''}`}>{p.ready ? <><Icon name="check" size={14}/> Ready</> : !state.connectedIds.includes(p.id) ? 'Disconnected' : ''}</span>{me?.id === state.hostId && p.id !== me?.id && !state.connectedIds.includes(p.id) && <button className="text-button" onClick={() => send({ type: 'remove', playerId: p.id })}>Remove</button>}</div>)}</div><button className={`button ${me?.ready ? 'secondary' : 'primary'}`} disabled={pending || !online || state.players.length < 2} onClick={() => send({ type: 'ready' })}>{me?.ready ? <><Icon name="check"/> Ready for the next game</> : 'Ready for the next game'}<Icon name="arrow"/></button><p className="lobby-hint">{state.players.filter(p => p.ready).length} of {state.players.length} ready · The next game starts when everyone is ready.</p><button className="text-button" onClick={leave}>Leave table</button></main>
      : <main className="game-layout">
        <div className="table-toolbar"><div className="room-meta"><span className="private-label"><Icon name="lock" size={12}/> Private table</span><button className="room-code-button" onClick={copyInvite}>{formatCode(state.code)}<Icon name={copied ? 'check' : 'copy'} size={13}/></button></div><div className="game-meta"><span>Game {state.gameNumber}</span><span className="meta-dot">·</span><span>{state.phase === 'peek' ? 'Opening look' : state.phase === 'ending' ? 'Final matches' : state.calledBy ? `${state.finalTurns} final ${state.finalTurns === 1 ? 'turn' : 'turns'}` : `Round ${Math.floor(state.turns / state.players.length) + 1}`}</span></div></div>
        <div className={`card-table ${dealing ? 'dealing' : ''} ${state.players.length > 6 ? 'large-room' : ''}`}>
          <div className={`opponents opponents-${Math.min(state.players.length - 1, 5)}`}>{state.players.filter(p => p.id !== me?.id).map((p, i) => hand(p, false, i))}</div>
          <div className="table-middle"><div className="pile-area"><div className="pile"><div className="deck-stack"><PlayingCard onClick={() => { if (isTurn && state.phase === 'playing' && !state.drawn && !state.power && !state.transfer) { setMatching(false); send({ type: 'draw' }); } }} disabled={!isTurn || state.phase !== 'playing' || !!state.drawn || !!state.power || !!state.transfer || !online || pending || !state.deckCount} label={`Draw pile, ${state.deckCount} cards remaining`}/></div><span className="pile-label">Draw pile <b>{state.deckCount}</b></span></div><div className="pile"><PlayingCard face={state.discard} empty={!state.discard} label={state.discard ? `Discard: ${cardLabel(state.discard)}` : 'Discard pile is empty'}/><span className="pile-label">Discard</span></div></div><div className="table-message" aria-live="polite">{state.phase !== 'peek' && <>{state.calledBy && <span className="cambio-badge"><Icon name="lock" size={12}/>{state.players.find(p => p.id === state.calledBy)?.name} called Cambio</span>}<span>{state.message}</span></>}</div></div>
          <div className="your-area">{me && hand(me, true, state.players.findIndex(p => p.id === me.id))}</div>
          {dealing && <div className="shuffle-indicator" aria-hidden="true"><Icon name="cards" size={20}/> Shuffling & dealing</div>}
        <section className={`action-bar ${matching && canMatch ? 'matching-mode' : ''}`} aria-label="Game actions"><div className="action-instruction" aria-live="polite"><span className="action-indicator">{transferMine ? <Icon name="arrow"/> : matching && canMatch ? '=' : state.phase === 'ending' ? countdown ?? '·' : isTurn && state.phase === 'playing' ? '→' : <Icon name="cards"/>}</span><div><h2>{instruction.title}</h2><p>{instruction.detail}</p></div></div><div className="action-controls">
          {state.phase === 'peek' && me?.initialCards?.some(s => s === 'waiting') && <button className="button primary" onClick={() => send({ type: 'reveal-initial' })} disabled={pending || !online || dealing}>{me.initial === 'waiting' ? 'Look at bottom two' : 'Look at remaining card'}</button>}
          {state.phase === 'peek' && me?.initial === 'viewing' && <button className="button primary" onClick={() => send({ type: 'close-initial' })} disabled={pending || !online}>Done looking <Icon name="check"/></button>}
          {isTurn && state.phase === 'playing' && !state.drawn && !state.power && !state.transfer && <><button className="button secondary cambio-button" title={state.turns < state.players.length * 2 ? 'Available after two complete rounds' : 'Lock your hand and give everyone one last turn'} disabled={pending || !online || !!state.calledBy || state.turns < state.players.length * 2} onClick={() => send({ type: 'cambio' })}>Call Cambio</button><button className="button primary" disabled={pending || !online} onClick={() => { setMatching(false); send({ type: 'draw' }); }}>Draw card <Icon name="arrow"/></button></>}
          {isTurn && state.drawn && <div className="drawn-choice"><PlayingCard face={state.drawn} small/><button className="button primary" onClick={() => { setMatching(false); send({ type: 'discard' }); }} disabled={pending || !online || !!state.transfer}>Discard{state.drawn.rank >= 7 && state.drawn.rank <= 13 ? ' & choose power' : ''}<Icon name="arrow" size={16}/></button></div>}
          {isTurn && state.power && <><button className="button secondary" disabled={pending || !online || !!state.transfer} onClick={() => { setMatching(false); setSelected(null); send({ type: 'skip-power' }); }}>{state.power.step === 'swap' ? 'Skip swap' : 'Skip power'}</button>{state.power.step === 'view' && <button className="button primary" disabled={pending || !online || !!state.transfer} onClick={() => send({ type: 'close-peek' })}>Done looking <Icon name="check"/></button>}</>}
          {(state.phase === 'playing' || state.phase === 'ending') && <button className={`button match-button ${matching && canMatch ? 'is-matching' : ''}`} disabled={!online || pending || !canMatch} onClick={() => { setMatching(m => !m); setSelected(null); }}> {matching && canMatch ? 'Cancel match' : 'Match a card'}<kbd>M</kbd></button>}
        </div></section>
        </div>
        <footer className="table-footer"><span><Icon name="users" size={13}/>{state.players.length} players<span className="meta-dot">·</span>Lowest score wins</span>{me?.id === state.hostId && state.phase !== 'ending' && <button className="text-button" onClick={() => { if (window.confirm('End this game for everyone? The table will score after a final matching window.')) send({ type: 'end-game' }); }}>End game</button>}</footer>
      </main>}

    {error && <div className="error-toast" role="alert"><span>{error}</span><button className="icon-button" aria-label="Dismiss message" onClick={() => setError('')}><Icon name="close" size={16}/></button></div>}
    <dialog ref={dialog} className="rules-dialog" onCancel={() => setRules(false)} onClose={() => setRules(false)} onClick={event => { if (event.target === event.currentTarget) setRules(false); }}><div className="dialog-heading"><div><span className="eyebrow">Our house rules</span><h2>How to play Cambio</h2></div><button className="icon-button" aria-label="Close rules" onClick={() => setRules(false)}><Icon name="close"/></button></div>{RULE_GROUPS.map(([title, text]) => <section key={title}><h3>{title}</h3><p>{text}</p></section>)}<button className="button primary" onClick={() => setRules(false)}>Back to the table</button></dialog>
  </div>;
}
