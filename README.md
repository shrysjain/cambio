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
npm test             # 21 focused rules/privacy/layout tests; normally under a second
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
- 7/8 peek at yours; 9/10 peek at another player's; Jack blind-swaps; Queen peeks at yours then optionally swaps; King peeks at yours and another player's then optionally swaps. Any two unlocked cards may be swapped. Peek targets and swap targets are independent.
- The host can choose the Queen rule before the first deal and between games: **Look then swap** (the default) or **Swap then look**. In the latter, a blind swap reveals the card the actor receives; swapping two of your own cards lets you choose exactly one of those two to peek at, while swapping only opponents' cards grants no peek. Only the actor sees the value, with the usual public position highlight. Changing the rule clears ready checks and the setting persists across rematches. Existing rooms default to Look then swap.
- Initial and power peeks highlight the viewed position with an eye badge for everyone while it is being viewed. Only the authorized player sees the face; click again to hide it. If matching moves that card, its old reveal cannot expose the replacement card.
- Matching works off-turn, including during a power. A correct match removes the card; matching someone else's requires giving them one of yours. A failed attempt returns the card and adds a penalty, and the player can try again. One successful match consumes that discard opportunity. The first valid server-received attempt wins; latency can affect close races.
- A = 1, numbered cards score at face value, J = 11, Q = 12, black K = 13, red K = −1, two Jokers = 0. Lowest score wins, ties stay ties, and there is no caller penalty.
- Cambio becomes available after two complete rounds, on your turn before drawing. The caller's hand is protected from matching/swaps but may be peeked at. Others get one final turn.
- Zero cards does not end the game. Exhausting the deck, including through a penalty, finishes in-progress play and gives a five-second final matching window. The final Cambio turn uses the same window.
- Rematches start when everyone readies. The previous winner starts, randomly among tied winners, with a random fallback.
- Guest reconnect credentials stay in that browser's local storage; the server stores their hashes. Room codes are private invitations, not player credentials.
- Disconnected seats wait for reconnection during play. The host can end a stuck game, and remove disconnected seats between games. Host control passes to a connected player when the host leaves.
- Rooms expire after 24 hours without game/join activity. This is a casual friends-only release; public discovery, accounts, cumulative scores, and a polished mobile layout are deferred.

## Files

- `lib/game.ts`: pure authoritative rules and player-specific views.
- `worker/index.ts`: room invitations, hashed seat credentials, serialized actions, persistence, alarms, and hibernating WebSockets.
- `app/page.tsx`, `app/globals.css`: desktop interface, arc layout, private flips, and reduced-motion support.
- `tests/game.test.ts`: focused rules and privacy checks.
- `scripts/smoke.mjs`: optional local multiplayer network check.
- `PLAN.md`: design rationale and planning record. This README describes the implemented behavior and setup.
