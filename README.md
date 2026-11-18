# Cambio

A desktop-first multiplayer Cambio game for friends. Next.js serves the interface; a Cloudflare Durable Object owns each room's game state and WebSocket connections. No account, database subscription, or separate realtime service is required.

## Run locally

Use Node.js 24 (or Node.js 22+).

```sh
npm ci
```

Open two terminals in this directory:

```sh
# Terminal 1 — local Cloudflare server, no Cloudflare login required
npm run dev:api
```

```sh
# Terminal 2 — Next.js
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). Create a room and invite another browser/profile. One active tab owns a player seat; opening the same seat elsewhere closes the old connection. Local game data lives under `.wrangler/` and is never committed.

The local server defaults to port 8787 automatically in development. To override it, copy `.env.example` to `.env.local` and edit `NEXT_PUBLIC_GAME_SERVER`.

## Focused verification

```sh
npm test             # 34 focused rules/privacy/layout/session/recovery tests; normally under a second
npm run check        # TypeScript for both the frontend and Worker
npm run build        # Production Next.js build
```

With `npm run dev:api` running, an optional real-network check plays complete 2-, 6-, and 10-player games, reconnects a seat, checks private state, scores, and starts a rematch:

```sh
npm run test:network
# Or just one room size:
node scripts/smoke.mjs 2
```

These create disposable rooms only on the local development server. Do not point the script at a live game server with real players. Network checks include the actual five-second end-of-game window, so they take longer than the unit checks. Browser layout checks are manual in Safari; browser automation is not part of the default test command.

## First deployment: Cloudflare, then Vercel

The repository is ready for a normal GitHub → Vercel import. The game server is a separate deployment. No secrets belong in the frontend environment.

### 1. Deploy the game server from your terminal

Stay on the Cloudflare Workers **Free** plan. SQLite-backed Durable Objects are configured in `wrangler.jsonc` and created by its migration; you do not need to manually create a database.

```sh
npm run login:cloudflare
npm run account:cloudflare
npm run deploy:api
```

The first command opens Cloudflare's authorization page. Sign in and authorize Wrangler. `whoami` confirms the account. If you have multiple accounts, Wrangler asks which to use; alternatively set the chosen `account_id` in `wrangler.jsonc` (the account ID is not a secret).

During the first deployment, Cloudflare may ask you to choose a free `workers.dev` subdomain. Accept the free setup. Copy the HTTPS Worker URL printed by the deploy command, for example:

```text
https://cambio-game.YOUR-SUBDOMAIN.workers.dev
```

Check `https://YOUR-WORKER-URL/health`; it should return `{"ok":true,"service":"cambio"}`. Do not add `/health` to the frontend environment variable.

### 2. Import the GitHub repository in Vercel

In Vercel: **Add New → Project → import `shrysjain/cambio`**.

| Setting | Value |
| --- | --- |
| Framework preset | Next.js |
| Root directory | Repository root (`./`) |
| Install command | Default (`npm install` / lockfile detection) |
| Build command | `npm run build` (auto-detected) |
| Output directory | Leave at the Next.js default; do not set `out` or `dist` |
| Node.js | 24.x |
| Environment variable | `NEXT_PUBLIC_GAME_SERVER` = the HTTPS Worker URL from step 1 |

Add the variable for Production and Preview as needed **before building**. `NEXT_PUBLIC_*` values are built into the browser bundle; changing this variable later requires a redeployment. The URL is public configuration, not a credential.

### 3. Allow your Vercel hostname on the Worker

The Worker accepts exact origins, not a wildcard. The custom hostname `https://cambio.shrysjain.me` and local development origins are already in `wrangler.jsonc`.

For the initial `https://YOUR-PROJECT.vercel.app` URL, add that exact origin to the comma-separated `ALLOWED_ORIGINS` value in `wrangler.jsonc`, then run:

```sh
npm run deploy:api
```

Keep `wrangler.jsonc` as the source of truth for this setting: dashboard-only edits can be overwritten by a later CLI deployment. Add specific preview deployment hostnames only when you need them. URLs have no trailing slash in `ALLOWED_ORIGINS`.

### 4. Connect the personal subdomain

In the Vercel project: **Settings → Domains → add `cambio.shrysjain.me`**. Add the exact CNAME Vercel displays wherever `shrysjain.me` DNS is managed. You only need to configure this subdomain; moving the main website or changing nameservers is unnecessary.

### 5. One small live check

Create a room at the final URL, open the invitation in a second browser/profile, ready up, and play through an initial peek and a turn. This verifies the deployed frontend environment, origin allowlist, and live WebSocket path. Keep the separate local checks out of deployment builds.

## Game and implementation notes

- Four starting cards; each bottom card can be flipped once for an untimed initial peek. Hide both to finish. Everyone finishes before the first turn.
- Normal turns draw from the deck, then replace or discard. Only drawn/discarded cards activate optional powers.
- Click the draw pile to flip your drawn card in place; only you see it. Then click the discard pile to discard it, or click one of your own cards to replace that card. The discard button remains available as an alternative, including when the discard pile starts empty.
- Hand slots keep fixed anchors: removing a card leaves its position empty, and penalty cards append without recentering or rotating the existing layout. Hovering/selecting does not lift a card out of its slot.
- Every power swap broadcasts the two public positions and animates card backs exchanging places for all connected players. No card values are included in the swap event. With reduced motion, the positions are highlighted instead; game actions do not wait for the animation.
- Draws, discards, replacements, matches, penalties, and card transfers also show public card-back movements and position highlights. Each slot has a small permanent number. Opponents’ layouts face across the table (their bottom two are your top two), and extra cards extend outward without moving existing slots. Turn outlines include penalty columns.
- New rooms use four-character alphanumeric codes, with automatic collision retries. Existing ten-character invitations and saved seats remain valid.
- Between games, a session scoreboard tracks outright wins, shared winning ties, and cumulative points for each participant. Totals persist across rematches/reconnects in the room, including previous participants. Existing rooms begin tracking at their next completed game; past games are not reconstructed.
- Result titles preserve the completed winners' names even after seats are removed. The browser tab displays “Your turn · Cambio” only during your connected active turn, without notifications.
- Desktop tables use bounded hand areas, tilt-aligned turn highlights, and a separate crowded-room arrangement for 7–10 players. Extra cards scroll horizontally inside each hand without shifting the original slots. Long names truncate with full-name hover text. Two recent match/penalty/transfer actions remain visible briefly so fast matches can be distinguished. Layout geometry is checked across 1024–1920px desktop widths, 640–1080px heights, and hands up to a full deck; smaller windows retain a readable minimum table size.
- Disconnected seats and card positions remain intact and eligible to win. After 20 continuous seconds offline, the host can resolve a blocking opening peek, skip an abandoned turn (discarding any drawn card without its power), or complete an owed transfer using a randomly selected card. Reconnection resets the grace period and the server rechecks presence before recovery. Removal remains between games only.
- The home screen offers code entry and an active-room browser. Listings show host, player count, and game number, with private locks; codes and seat tokens are never listed. Browsed joins verify the code belongs to the selected room. Active or full rooms offer “Watch”; the room code is still required. Joining during play adds a spectator to the next-game waiting list. Directory updates use the existing Durable Object binding.
- Spectators receive a separate server-generated public view: visible discards, public match attempts, card positions and movements, peek highlights, turns, presence, and final scores. Private peeks and drawn cards are never sent to them. They cannot issue game actions or inherit host privileges. Connected queued spectators take available seats in arrival order after scoring, up to ten players; existing players keep their seats. New seats do not enter the previous result or session totals, and everyone must ready up again. Seated players can switch to spectating between games to free a seat; completed results and session totals remain intact, readiness resets, and host controls stay with a seated player. “Just watch” leaves the queue; “Join next game” rejoins at the end. Spectators have a twenty-second reconnect grace period and a room limit of twenty.
- 7/8 peek at yours; 9/10 peek at another player's; Jack blind-swaps; Queen peeks at yours then optionally swaps; King peeks at yours and another player's then optionally swaps. Any two unlocked cards may be swapped. Peek targets and swap targets are independent.
- The host can choose **1 deck** (54 cards, 2 Jokers) or **2 decks** (108 cards, 4 Jokers) in the lobby and between games. Changing the count resets ready checks and persists for rematches. Existing rooms default to one deck. Each physical card has a unique identity so identical copies cannot inherit private peeks or swap permissions.
- The host can choose the Queen rule before the first deal and between games: **Look then swap** (the default) or **Swap then look**. In the latter, a blind swap reveals the card the actor receives; swapping two of your own cards lets you choose exactly one of those two to peek at, while swapping only opponents' cards grants no peek. Only the actor sees the value, with the usual public position highlight. Changing the rule clears ready checks and the setting persists across rematches. Existing rooms default to Look then swap.
- Initial and power peeks highlight the viewed position with an eye badge for everyone while it is being viewed. Only the authorized player sees the face; click again to hide it. If matching moves that card, its old reveal cannot expose the replacement card.
- Matching works off-turn, including during a power. A correct match removes the card; matching someone else's requires giving them one of yours. A failed attempt returns the card and adds a penalty, and the player can try again. One successful match consumes that discard opportunity. The first valid server-received attempt wins; latency can affect close races.
- A = 1, numbered cards score at face value, J = 11, Q = 12, black K = 13, red K = −1, two Jokers = 0. Lowest score wins, ties stay ties, and there is no caller penalty.
- Cambio becomes available after two complete rounds, on your turn before drawing. The caller's hand is protected from matching/swaps but may be peeked at. Others get one final turn.
- The host can toggle **Reshuffle discards** in the lobby and between games (off by default, including existing rooms). Changing it resets ready checks and persists for rematches. When enabled, an empty draw pile refills with the shuffled discard pile except for its top card. Normal draws and penalties use the recycled cards; the visible discard and matching opportunity stay intact.
- Zero cards does not end the game. When reshuffling is off, or there are no buried discards to recycle after in-progress play finishes, exhausting the deck (including through a penalty) gives a five-second final matching window. The final Cambio turn uses the same window even when reshuffling is on.
- Rematches start when everyone readies. The previous winner starts, randomly among tied winners, with a random fallback.
- Guest reconnect credentials stay in that browser's local storage; the server stores their hashes. Room codes are private invitations, not player credentials.
- Disconnected seats wait for reconnection during play. The host can end a stuck game, and remove disconnected seats between games. Host control passes to a connected player when the host leaves.
- Rooms expire after 24 hours without game/join activity. This is a casual friends-only release; public rooms, accounts, and a polished mobile layout are deferred.

## Files

- `lib/game.ts`: pure authoritative rules and player-specific views.
- `lib/membership.ts`: spectator membership, next-game queue, reconnect grace, and seat promotion.
- `worker/index.ts`: room invitations, hashed seat credentials, serialized actions, persistence, alarms, and hibernating WebSockets.
- `app/page.tsx`, `app/globals.css`: desktop interface, arc layout, private flips, and reduced-motion support.
- `tests/game.test.ts`: focused rules and privacy checks.
- `scripts/spectator-smoke.mjs`: local spectator privacy, queue, scoring, and rematch network check.
- `scripts/smoke.mjs`: optional local multiplayer network check.
- `PLAN.md`: design rationale and planning record. This README describes the implemented behavior and setup.


## Isolated connection diagnostics

Visit `/connection-check` on the deployed Vercel site. The 20-second check compares direct HTTP, relayed HTTP, direct WebSocket, and relayed WebSocket. The optional six-minute run checks sustained echoes and planned reconnects. Copy results to share timings, failures, browser version, timestamp, and build; reports contain no room/seat credentials. Keep the tab foregrounded while measuring.

- Direct HTTP: browser → existing Worker `/health`.
- Relayed HTTP: browser → Vercel `/api/connection-check/http` → fixed Worker `/health`. No caching; an eight-second upstream timeout; validates the response.
- Direct WebSocket: browser → Worker `/diagnostics/echo`.
- Relayed WebSocket: browser → Vercel `/api/connection-check/ws` → Worker `/diagnostics/echo`. `@vercel/functions` upgrades the browser socket; `ws` holds the upstream socket. Only bounded diagnostic ping nonces are forwarded and only validated Worker echoes return. There is no user-selectable upstream and no room API forwarding.
- The Worker echo handler runs outside Durable Objects, uses no storage, accepts at most thirty tiny messages per connection, and closes after fifty seconds. The Vercel relay deliberately closes after forty-five seconds, below its sixty-second function limit. The page reconnects on those explicitly planned closures. Unexpected failures are reported rather than hidden by retries.
- These diagnostic probes remain independent from gameplay and do not create seats or touch rooms. Normal gameplay now uses the automatic connection fallback described below; the probes continue to compare each path explicitly.
- Local `npm test` covers the relay over real local sockets. `node scripts/connection-check-smoke.mjs [frontend-origin]` checks deployed HTTP and real Worker-backed echoes without a browser. Set `GAME_SERVER` to select a local Worker for the script. The Next.js WebSocket upgrade API needs the Vercel runtime; plain `next dev` intentionally returns an explanatory 503 for that diagnostic endpoint.

## Automatic game connection fallback

Normal gameplay prefers the existing direct Worker URL. A short health probe selects the same-origin Vercel relay when direct access fails. Room browsing, creation, joining, and game WebSockets share the selected path. A direct socket failure also switches to relay; selection sticks in session storage for that tab. The indicator shows “Connected · relay”. The connection-check page remains independent and can still compare both paths.

The relay is `/api/game/[...path]` and permits only health, room listing/creation, joins, and room WebSockets. It forwards text messages without interpreting private game state. The Worker and Durable Objects remain the only game authority and persistent storage. Auth close codes pass through unchanged. Pending UI selections clear on reconnect; the frontend reloads authoritative state and never automatically replays an uncertain action or room creation/join POST. Read-only network failures may retry through the relay. Existing action IDs continue to protect against duplicates.

Relayed sockets rotate after four minutes using close code 1012, below the five-minute Vercel Function duration. The client promptly reconnects with the same stored credentials. Idle/hung connections are checked with ping/pong. Close codes for invalid credentials, removed seats, expired rooms, and another-tab ownership remain terminal.

For HTTP health and writes, Vercel adds its short-lived server OIDC token plus its trusted edge client IP. The Worker verifies the RS256 signature using pinned Vercel issuer keys, audience, expiration, and the exact production project subject before using that IP for rate limiting. Neither value is returned to browsers or stored in game state. Vercel OIDC must be enabled for the production `shreyasjain/cambio` project; no shared secret is required. Unauthenticated forwarded IP headers are ignored. Other installations must update the pinned owner/project identity in `lib/relay-identity.ts`.

Run `node scripts/fallback-smoke.mjs` for the production protocol check (creates a disposable test room). Unit checks cover transport selection, no duplicate POSTs, cancellation, route restrictions, signed relay identity, initial auth buffering, close-code preservation, and planned reconnects. Browser checks are optional.

## Action response latency

Accepted actions persist the authoritative room, credentials, and handled action IDs once in `schedule()` before acknowledgments or state broadcasts. Alarm scheduling also completes before responding. The room directory is a separate background publication through `ctx.waitUntil()`; a slow directory cannot hold up the action acknowledgment.

A persisted publication marker avoids repeated directory requests across hibernation. Host name, seat count, phase, game number, and visibility changes publish promptly; unchanged summaries refresh their activity timestamp at most once every five minutes. Publications are serialized and coalesced to the newest pending snapshot, so an older online update cannot overtake a later disconnect. Failed publication leaves the success marker unchanged and retries on a later room event. Directory metadata uses a separate storage key and never overwrites room state.

`node scripts/action-latency.mjs direct` (or `relay`) creates an isolated two-player room and measures action-send to acknowledgment and authoritative-state receipt, covering ready/start, opening flips, draws, discards, and powers. It prints only timing samples, not room credentials or card values. Set `GAME_SERVER`/`GAME_SITE` to target a local environment. Network conditions and room placement affect results; use this as a controlled spot check rather than a universal latency guarantee.

## Session identity and returning players

Session scores use a score identity separate from temporary game seats. The browser keeps a random guest token in local storage (with an in-memory fallback); rooms retain only its hash and score association. Creation/join and authenticated reconnects associate that browser with its score history. Removing a seat still deletes its seat credentials; the guest token cannot authenticate a socket or reclaim private cards. Returning players receive a fresh seat and credentials while their session totals continue, including after a display-name change.

Within a room, same-name history is the fallback for another device, cleared storage, or older clients. Names match case-insensitively with surrounding whitespace removed. Existing duplicate rows are merged on room use, and also render merged immediately in the public score view: wins, ties, signed points, and games played are summed, while the room's total game count remains unchanged. The migration is idempotent, retains old ID aliases for winner lookup, and persists with the authoritative room state. Two active memberships cannot share the same score identity. The previous winner's returning seat remains eligible to start the next game.

`node scripts/session-identity-smoke.mjs` against the local Worker checks removed/rejoined seats, renaming, revoked credentials, subsequent game totals, and same-name fallback. No accounts or cross-room score tracking are added.


## Permanent anonymous statistics

Completed games and anonymous player results are now recorded in Cloudflare D1, independently of room expiry. Export uses a durable retry outbox and idempotent transactions in the background; game-state persistence still completes before responses. No dashboard or public query endpoint is added. See [docs/analytics.md](docs/analytics.md) for data definitions, anonymity limits, retry behavior, and query/export commands; [docs/analytics-queries.sql](docs/analytics-queries.sql) contains ready-to-run examples.
