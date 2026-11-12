import { addPlayer, applyAction, finishIfDue, newGame, viewFor, type Action, type Game } from '../lib/game.ts';

interface Env { ROOMS: DurableObjectNamespace; ALLOWED_ORIGINS: string }
type StoredRoom = { game: Game; credentials: Record<string, string>; handled: Record<string, string[]> };
type Session = { playerId?: string; created: number; bucket: number; count: number };
const DAY = 24 * 60 * 60 * 1000;
const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers });
const hash = async (text: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(n => n.toString(16).padStart(2, '0')).join('');
function equal(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function nameFrom(data: unknown): string {
  const name = (data as { name?: unknown })?.name;
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 24 || /[\x00-\x1f\x7f]/.test(name)) throw new Error('Use a name between 1 and 24 characters.');
  return name.trim();
}
function roomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return [...crypto.getRandomValues(new Uint8Array(10))].map(n => chars[n % chars.length]).join('');
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const allowed = env.ALLOWED_ORIGINS.split(',').map(s => s.trim()).includes(origin ?? '');
    const cors: Record<string, string> = allowed ? { 'Access-Control-Allow-Origin': origin!, 'Vary': 'Origin', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } : {};
    if (origin && !allowed) return json({ error: 'This website is not allowed to connect to the game server.' }, 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    let response: Response;
    try {
      if (url.pathname === '/health') response = json({ ok: true, service: 'cambio' });
      else if (request.method === 'POST' && (url.pathname === '/rooms' || /^\/rooms\/[A-Z2-9]{10}\/join$/.test(url.pathname))) {
        if (Number(request.headers.get('Content-Length') ?? 0) > 2048) return json({ error: 'Request too large.' }, 413);
        const body = await request.text();
        if (body.length > 2048) return json({ error: 'Request too large.' }, 413);
        const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
        const limiter = env.ROOMS.get(env.ROOMS.idFromName(`rate:${await hash(ip)}`));
        const rate = await limiter.fetch('https://internal/limit', { method: 'POST' });
        if (!rate.ok) response = json({ error: 'Too many room requests. Try again in a minute.' }, 429);
        else {
          const create = url.pathname === '/rooms';
          const code = create ? roomCode() : url.pathname.split('/')[2];
          const room = env.ROOMS.get(env.ROOMS.idFromName(`room:${code}`));
          response = await room.fetch(`https://internal/${create ? 'create' : 'join'}?code=${code}`, { method: 'POST', body });
        }
      } else if (request.method === 'GET' && /^\/rooms\/[A-Z2-9]{10}\/ws$/.test(url.pathname)) {
        if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'WebSocket connection required.' }, 426);
        const room = env.ROOMS.get(env.ROOMS.idFromName(`room:${url.pathname.split('/')[2]}`));
        return room.fetch(new Request('https://internal/ws', request));
      } else response = json({ error: 'Not found.' }, 404);
    } catch { response = json({ error: 'The request could not be completed. Please try again.' }, 400); }
    response = new Response(response.body, response);
    for (const [key, value] of Object.entries(cors)) response.headers.set(key, value);
    return response;
  },
} satisfies ExportedHandler<Env>;

export class GameRoom {
  constructor(private ctx: DurableObjectState, private env: Env) {
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }
  async fetch(request: Request): Promise<Response> {
    return this.ctx.blockConcurrencyWhile(async () => {
      try {
        const url = new URL(request.url);
        if (url.pathname === '/limit') {
          const now = Date.now();
          const old = await this.ctx.storage.get<{ at: number; count: number }>('rate');
          const rate = !old || now - old.at > 60000 ? { at: now, count: 0 } : old;
          if (++rate.count > 30) return json({ error: 'Rate limited.' }, 429);
          await this.ctx.storage.put('rate', rate);
          await this.ctx.storage.setAlarm(now + 65000);
          return json({ ok: true });
        }
        let stored = await this.ctx.storage.get<StoredRoom>('room');
        if (stored && Date.now() - stored.game.updatedAt > DAY) { await this.ctx.storage.deleteAll(); stored = undefined; }
        if (url.pathname === '/create' || url.pathname === '/join') {
          if (url.pathname === '/create' && stored) return json({ error: 'Room code collision. Create another room.' }, 409);
          if (url.pathname === '/join' && !stored) return json({ error: 'That room does not exist or has expired. Check the code.' }, 404);
          const name = nameFrom(JSON.parse(await request.text()));
          const playerId = crypto.randomUUID(), token = crypto.randomUUID() + crypto.randomUUID();
          if (!stored) stored = { game: newGame(url.searchParams.get('code')!, playerId, name), credentials: {}, handled: {} };
          else addPlayer(stored.game, playerId, name);
          stored.credentials[playerId] = await hash(token);
          stored.game.updatedAt = Date.now();
          await this.ctx.storage.put('room', stored);
          await this.schedule(stored);
          this.broadcast(stored);
          return json({ code: stored.game.code, playerId, token });
        }
        if (!stored) return json({ error: 'Room not found.' }, 404);
        if (url.pathname === '/ws') {
          if (this.ctx.getWebSockets().length >= 40) return json({ error: 'Too many room connections.' }, 429);
          const pair = new WebSocketPair();
          this.ctx.acceptWebSocket(pair[1]);
          pair[1].serializeAttachment({ created: Date.now(), bucket: Date.now(), count: 0 } satisfies Session);
          await this.schedule(stored);
          return new Response(null, { status: 101, webSocket: pair[0] });
        }
        return json({ error: 'Not found.' }, 404);
      } catch (error) { return json({ error: error instanceof Error ? error.message : 'Unable to join the room.' }, 400); }
    });
  }
  private connected(): string[] {
    return [...new Set(this.ctx.getWebSockets().filter(s => s.readyState === 1).map(s => (s.deserializeAttachment() as Session)?.playerId).filter((id): id is string => !!id))];
  }
  private broadcast(stored: StoredRoom) {
    const connectedIds = this.connected();
    for (const ws of this.ctx.getWebSockets().filter(s => s.readyState === 1)) {
      const id = (ws.deserializeAttachment() as Session)?.playerId;
      if (!id) continue;
      if (!stored.credentials[id]) { ws.close(4003, 'Your seat was removed.'); continue; }
      try { ws.send(JSON.stringify({ type: 'state', state: { ...viewFor(stored.game, id), connectedIds } })); }
      catch { ws.close(1011, 'Reconnect to continue.'); }
    }
  }
  private async schedule(stored: StoredRoom) {
    const now = Date.now(), times = [stored.game.updatedAt + DAY];
    if (stored.game.phase === 'ending' && stored.game.deadline && !stored.game.transfer) times.push(Math.max(now + 1, stored.game.deadline));
    if (stored.game.flash && stored.game.flash.until > now) times.push(stored.game.flash.until);
    for (const ws of this.ctx.getWebSockets().filter(s => s.readyState === 1)) {
      const a = ws.deserializeAttachment() as Session;
      if (!a?.playerId) times.push(Math.max(now + 1, a.created + 15000));
    }
    await this.ctx.storage.setAlarm(Math.min(...times));
  }
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    await this.ctx.blockConcurrencyWhile(async () => {
      try {
        if (typeof message !== 'string' || message.length > 4096) { ws.close(1009, 'Message too large.'); return; }
        const a = ws.deserializeAttachment() as Session;
        const now = Date.now();
        if (now - a.bucket > 1000) { a.bucket = now; a.count = 0; }
        if (++a.count > 30) { ws.close(1008, 'Too many actions.'); return; }
        ws.serializeAttachment(a);
        const payload = JSON.parse(message);
        const stored = await this.ctx.storage.get<StoredRoom>('room');
        if (!stored) { ws.close(4004, 'Room expired.'); return; }
        if (payload.type === 'auth') {
          if (typeof payload.playerId !== 'string' || typeof payload.token !== 'string' || payload.token.length > 128 || !stored.credentials[payload.playerId] || !equal(stored.credentials[payload.playerId], await hash(payload.token))) {
            ws.close(4003, 'Your seat could not be authenticated.'); return;
          }
          // One connection owns a seat; old tabs cannot keep issuing actions.
          for (const old of this.ctx.getWebSockets()) if (old !== ws && (old.deserializeAttachment() as Session)?.playerId === payload.playerId) old.close(4001, 'Your seat is open in another tab.');
          a.playerId = payload.playerId; ws.serializeAttachment(a);
          if (!this.connected().includes(stored.game.hostId)) stored.game.hostId = a.playerId!;
          await this.ctx.storage.put('room', stored);
          this.broadcast(stored); await this.schedule(stored); return;
        }
        if (!a.playerId || !stored.credentials[a.playerId]) { ws.close(4003, 'Sign in to your seat first.'); return; }
        if (payload.type === 'sync') { this.broadcast(stored); return; }
        if (payload.type !== 'action' || typeof payload.id !== 'string' || payload.id.length > 80) throw new Error('Invalid action.');
        if (finishIfDue(stored.game, now)) await this.ctx.storage.put('room', stored);
        const handled = stored.handled[a.playerId] ?? [];
        if (!handled.includes(payload.id)) {
          const action = payload.action as Action;
          const connected = this.connected();
          if (action.type === 'start' && stored.game.players.some(p => !connected.includes(p.id))) throw new Error('Wait for everyone to reconnect, or remove absent players.');
          if (action.type === 'remove' && connected.includes(action.playerId)) throw new Error('Only disconnected players can be removed.');
          if (['peek', 'swap', 'replace', 'give'].includes(action.type) && payload.version !== stored.game.version) throw new Error('The table changed. Please select the card again.');
          // Changes happen on a clone: a rejected command cannot partially mutate live state.
          const next = structuredClone(stored);
          applyAction(next.game, a.playerId, action, now);
          if (action.type === 'remove') { delete next.credentials[action.playerId]; delete next.handled[action.playerId]; }
          next.handled[a.playerId] = [...handled, payload.id].slice(-128);
          await this.ctx.storage.put('room', next);
          await this.schedule(next);
          ws.send(JSON.stringify({ type: 'ack', id: payload.id }));
          this.broadcast(next);
        } else { ws.send(JSON.stringify({ type: 'ack', id: payload.id })); this.broadcast(stored); }
      } catch (error) {
        const msg = error instanceof Error && !/Cannot read|undefined|null|JSON/.test(error.message) ? error.message : 'That action could not be completed. Please try again.';
        ws.send(JSON.stringify({ type: 'error', error: msg }));
        const stored = await this.ctx.storage.get<StoredRoom>('room');
        if (stored) this.broadcast(stored);
      }
    });
  }
  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    // 1005/1006 are received status markers, not legal outgoing close codes.
    if (ws.readyState === 1) ws.close(code === 1005 || code === 1006 || code === 1015 ? 1000 : code, 'Connection closed.');
    await this.ctx.blockConcurrencyWhile(async () => {
      const stored = await this.ctx.storage.get<StoredRoom>('room');
      if (!stored) return;
      const connected = this.connected();
      if (!connected.includes(stored.game.hostId) && connected.length) stored.game.hostId = connected[0];
      if (stored.game.phase === 'lobby' || stored.game.phase === 'finished') for (const p of stored.game.players) if (!connected.includes(p.id)) p.ready = false;
      await this.ctx.storage.put('room', stored);
      this.broadcast(stored);
    });
  }
  async webSocketError(ws: WebSocket): Promise<void> { await this.webSocketClose(ws, 1011, 'Reconnect to continue.'); }
  async alarm(): Promise<void> {
    await this.ctx.blockConcurrencyWhile(async () => {
      const stored = await this.ctx.storage.get<StoredRoom>('room');
      if (!stored) { await this.ctx.storage.deleteAll(); return; }
      const now = Date.now();
      if (now - stored.game.updatedAt >= DAY) {
        for (const ws of this.ctx.getWebSockets()) ws.close(4004, 'Room expired after 24 hours of inactivity.');
        await this.ctx.storage.deleteAll(); return;
      }
      for (const ws of this.ctx.getWebSockets()) {
        const a = ws.deserializeAttachment() as Session;
        if (!a.playerId && now - a.created >= 15000) ws.close(4003, 'Authentication timed out.');
      }
      let changed = finishIfDue(stored.game, now);
      if (stored.game.flash && now >= stored.game.flash.until) { stored.game.flash = null; changed = true; }
      if (changed) await this.ctx.storage.put('room', stored);
      this.broadcast(stored); await this.schedule(stored);
    });
  }
}
