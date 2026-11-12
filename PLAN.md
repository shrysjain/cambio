# Cambio — product and technical plan

Planning record · November 12, 2026 · Desktop implementation is underway; deployment is handled by the user. See README.md for the implemented behavior and setup.

## Product intent

A browser-based Cambio table for friends: join quickly, understand the current action, and play the house rules accurately. The cards and their spatial relationships are the main interface. Prioritize responsive interaction, clear state, and reliable reconnects.

Confirmed direction:

- Private games first; public rooms are a later possibility.
- Desktop is the first-release target. Prioritize 2–6 players and enforce a hard maximum of 10. Mobile refinement is deferred so it does not delay launch.
- Room codes or private invitations should keep casual visitors out of existing games.
- Next.js is the preferred frontend, with Vercel hosting at `cambio.shrysjain.me`.
- Recurring hosting cost must be $0. Cloudflare is the selected backend after comparing managed cloud and the available Raspberry Pi.
- During infrastructure setup, walk the user through each required step and state precisely what account configuration or information is needed. Do not assume prior Cloudflare experience.
- The user owns GitHub/Vercel project setup and deployment. Push code in meaningful commits to `git@github.com:shrysjain/cambio.git`; do not operate Vercel or attempt more CLI logins. Provide the Cloudflare commands and exact Vercel settings when the code and local checks are ready.
- Use Safari for visual and interaction checks. Complete a small local layout/playthrough review before the first deployment.
- Keep validation concise and relevant. Prefer a small set of meaningful rules/concurrency/privacy checks and focused manual playthroughs; avoid broad repetitive suites and unnecessary waiting. Planning/document changes need no test runs.
- Apply Apple's design foundations to the web: clarity, accessibility, hierarchy, feedback, and restraint. Native iOS/macOS navigation conventions are not requirements for this website.

## House rules supplied by the user

| Area | Confirmed rule |
| --- | --- |
| Initial hand | Four cards; no initial face-up discard. Each bottom card flips in place when clicked and hides on a second click. Each can be viewed once, for as long as desired. A convenience action can reveal both or finish looking. Play starts once everyone has finished. |
| Drawing | Draw only from the draw pile, never the discard pile. |
| Normal turn | Draw, then either replace one of your cards or discard the drawn card and optionally activate its power. |
| Powers | Only a newly drawn, discarded card can supply its power. A replaced card never activates its power. Powers may be skipped. Peeks flip the actual target card privately; click it again to hide it. |
| 7 / 8 | Look at one of your cards. |
| 9 / 10 | Look at another player's card. |
| Jack | Blind swap. |
| Queen | Look at one of your cards, then swap. |
| King | Look at one of your cards and one of another player's cards, then swap. |
| Swap targets | Any two cards can be exchanged, including cards in two other players' hands. They do not have to be the cards viewed. Swaps are optional. Caller protection still applies. |
| Other values | Ace = 1, numbered cards = face value, Jack = 11, Queen = 12, black King = 13. |
| Red King | Worth −1. |
| Joker | Two Jokers, each worth 0. |
| Matching | Matching by rank is available on any player's turn. You may match your own card or another player's card. |
| Matching window | The current discard remains matchable until covered. Replacement discards count. Matching need not wait for a discarded card's power to finish. Only one successful matcher gets each opportunity. |
| Matching another player | On a successful match, choose any of your cards to fill the other player's vacated position. |
| Matching race | Only the quickest successful matcher gets the match opportunity. A failed attempt does not stop that player from trying again. |
| Wrong match | Return the attempted card to its original position and draw a penalty card into the matcher's hand. This also applies when the attempted card belongs to another player. The matcher may try again. |
| Calling Cambio | Optional after two complete rounds around the table, only on your turn and before drawing. Everyone else gets one final turn after a call. |
| Caller protection | The caller's hand cannot be swapped with or matched from by anyone. Powers may still peek at it. |
| Deck exhaustion | Drawing the final deck card makes the current turn the final turn. Resolve the turn, then allow five seconds for matching before scoring. If a penalty draw exhausts the deck, finish whatever is in progress, then allow the same five-second matching window and score. No new turn starts once exhaustion is pending. |
| Empty hand | Matching away your last card does not end the game. Remain in play and take turns normally with a current hand total of zero. |
| Scoring | Lowest hand total wins. Ties remain ties. There is no penalty if the Cambio caller does not win. |
| Rematch | After scores, every player can ready up; the next game starts once everyone is ready. |
| Starting player | Random in the room's first game. The previous winner starts the next game; select randomly among tied winners. If that starter cannot be resolved, choose randomly among eligible players. |

Do not substitute a published Cambio/Cabo ruleset for these house rules.

### End-condition clarifications

The user confirmed both remaining end conditions: an empty hand stays in play with zero points, and a penalty draw exhausting the deck finishes in-progress play before the five-second matching window and scoring. No unanswered core end-condition questions remain. Proposed edge-case defaults below still need to be distinguished from confirmed rules.

### Proposed edge-case defaults for review

These are implementation recommendations, not additional confirmed house rules:

- Give the final turn after a Cambio call the same five-second matching period as a turn ending through deck exhaustion. New turns cannot start during this period.
- A successful match consumes that discard opportunity; its covering card does not recursively open another match opportunity. Wrong attempts do not consume the opportunity.
- Matching does not cancel the power of a drawn card that has already been discarded. That power belongs to the active turn, independently of the card's later position in the pile.
- Choose a card to give to an opponent as a short mandatory follow-up after winning that match. Reserve the vacated slot while the transfer is unresolved; do not leave a half-applied transfer when scoring. Final scoring waits for already-accepted effects/transfers to complete; no new attempts are accepted after the deadline.
- If matching changes a selected power target before commitment, validate against the current state and request a new selection when necessary. Do not grant extra peeks or silently affect a different card.
- Show an attempted match face-up briefly to everyone, whether correct or incorrect, as at a physical table; do not keep its value visible in permanent history. Confirm this detail if the user's physical game differs.
- Use a single game score sheet and ready-up rematches initially; cumulative totals are a future option unless requested. Rematching does not require creating a new room or host approval once all eligible players have readied.
- Specify disconnected-player readiness and room membership separately. Do not silently remove a player or count them as ready to start a rematch.

Ten players consume 40 cards before play. With a conventional 52-card deck plus the confirmed two Jokers and no initial discard, 14 remain. Larger rooms will have short games under the exhaustion rule; preserve the requested hard cap rather than adding a second deck without discussion.

## First version scope — proposed

Flow: home → private lobby → shuffle/deal → initial peek → game table → scores/ready up → shuffle/deal for the next game.

- Enter a display name, create a room, or join using an invitation/code.
- Host shares an invitation, sees players arrive, and starts when everyone is ready.
- Show a concise, fixed house-rules summary in the lobby.
- Implement one complete house ruleset before adding configurable variants.
- Restore a player's seat after refresh or a temporary connection loss.
- Show whose turn it is, the current step, selectable targets, connection state, and relevant public action feedback. Keep matching available outside the normal turn controls.
- End a game once, reveal/score according to the agreed rules, and show each player's readiness for another game with the same group. Reset readiness for every new game. Start after everyone readies, with the previous winner/random tied winner as starter and a random fallback.
- Recommend admitting new players in the lobby, with mid-game joining/spectating deferred.
- Defer accounts, rankings, matchmaking, chat/voice, cosmetics, bots, and a general-purpose rules editor.

Future public rooms should be an explicit room-visibility choice. Existing private rooms should remain invitation-only by default. Accounts and persistent statistics can be reconsidered when they have a concrete use.

## Framework and hosting comparison

### Frontend

Recommend Next.js with TypeScript and React. Keep the interactive table on the client and the authoritative game state on the backend. Use CSS Grid/Flexbox, CSS custom properties, and semantic HTML controls. Plain CSS/CSS Modules are sufficient; decide on additional UI libraries only for a specific need.

The Next.js preference fits the project. Server rendering is useful for the entry pages but is not a requirement for live gameplay. Avoid using framework features to add services the game does not need.

### Backend candidates

These are architectural judgments based on the linked provider documentation, checked November 12, 2026.

| Option | Fit | $0 boundary | Main trade-off |
| --- | --- | --- | --- |
| Cloudflare Worker + SQLite-backed Durable Object per room | Leading recommendation: the room has one authority, live connections, and its own durable storage. | Workers and Durable Objects each have free quotas; exceeding a Durable Object free limit causes operations of that type to fail. | Cloudflare-specific room/storage adapter; two deployment targets including Vercel. |
| Raspberry Pi + TypeScript/Node WebSocket server + SQLite | Good if owning the infrastructure is desirable; conventional server runtime. | No rented server; existing hardware, power, and home internet still have costs. | Home power/network outages, OS updates, backups, restart supervision, and deployment are our responsibility. |
| Vercel Functions + external transactional state store | Technically viable, including WebSockets. | Must remain within Vercel Hobby and the chosen store's free allowances. | Connections expire at function duration limits; room members may reach different instances, so shared state and coordination are required. |
| Supabase | Stronger fit if accounts, profiles, and persistent relational data become central. | Free Realtime allowance includes 200 peak connections and 2 million monthly messages; low-activity free projects can pause after seven days. | Authoritative game transitions still need transactional server logic and private data projections; Realtime alone does not implement the game. |

Render is another conventional Node hosting option, but its free service sleeps after 15 minutes without inbound traffic, wakes in about a minute, and has ephemeral local storage. That is an awkward first-join/recovery experience for an occasional game, so it is not shortlisted.

Cloudflare's documented Durable Object free allowances include 100,000 request units/day, 13,000 GB-s/day, 100,000 SQLite rows written/day, and 5 GB storage. The separate Workers Free request allowance is 100,000/day. These are shared account/service allowances, not guarantees of a particular player capacity. Hibernation avoids keeping rooms active merely because sockets are connected; persist state because in-memory state resets when an object hibernates. Clean up expired rooms and avoid frequent polling or storage writes for visual timers.

The Pi's strongest advantage is runtime control and conventional Node hosting, not savings over a cloud plan that is already $0 at this scale. A Cloudflare Tunnel is one potential route to the Pi: it connects outbound without opening an inbound origin listener. Check domain/DNS prerequisites if this option is selected.

Decision: the user selected Cloudflare. A small friends-only workload appears suitable for the cloud free tier, but confirm usage with a representative multiplayer session before launch. Keep the game engine independent of hosting so the Pi remains a practical alternative. Guide the user through required setup when implementation reaches that stage.

Sources:

- [Vercel custom-domain configuration](https://vercel.com/docs/domains/working-with-domains/add-a-domain)
- [Vercel Hobby: personal, non-commercial use and limits](https://vercel.com/docs/plans/hobby)
- [Vercel WebSockets: connection lifetimes and external state](https://vercel.com/docs/functions/websockets)
- [Cloudflare Durable Objects pricing and free limits](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Durable Object WebSocket hibernation and state restoration](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
- [Cloudflare Tunnel connection model](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/)
- [Supabase free allowances](https://supabase.com/docs/guides/platform/billing-on-supabase)
- [Supabase free-project pausing](https://supabase.com/docs/guides/platform/free-project-pausing)
- [Render free-service limitations](https://render.com/docs/free)

## Architecture — proposed cloud version

```text
Browser: Next.js / React
  ├─ page/assets ← Vercel at cambio.shrysjain.me
  └─ HTTPS + WebSocket → Cloudflare Worker
                          └─ one Durable Object per room
                               ├─ authoritative game engine
                               ├─ player-specific state views
                               └─ durable room state in SQLite-backed storage
```

For a Pi backend, replace the Worker/Durable Object adapter with a Node WebSocket server and SQLite. Keep the frontend protocol and pure TypeScript rules engine.

Essential behavior:

- The server shuffles and deals, validates actions, controls turn/power phases, enforces locking, and computes scores.
- Browsers submit intentions such as draw/select/swap, not an edited game state or a claimed card value.
- Each player receives only public data and the private information currently permitted by the rules. Hidden deck/hand values must not be delivered in HTML, React payloads, general broadcasts, or public logs. A matching selection cannot highlight correct ranks or disable wrong ranks: that would disclose information and prevent the confirmed penalty mechanic.
- A guest seat gets a server-issued reconnect credential, separate from the room invitation. A display name or room code alone cannot reclaim someone else's seat.
- Invitations should be unguessable; human-friendly codes need lookup rate limits and an optional lobby lock. Choose the exact code/invite scheme before implementation.
- Apply and persist accepted transitions atomically; use action IDs and state versions to handle retries, double taps, stale actions, and competing messages.
- Restore room/phase/deadline state after hibernation, reconnect, restart, or deployment. Reconnecting must not reopen an initial peek already closed or restart a final matching countdown. Initial peeks have no time limit; store whether the player has not revealed, is viewing, or has finished.
- A peek can be withheld from a client until authorized, but a value already delivered cannot be made unknowable. The interface should stop displaying it when its reveal ends, including in screen-reader labels and history.
- Keep spatial card slots stable. Do not automatically rearrange cards or add remembered-card labels unless the agreed rules permit it.
- Matching needs its own flow, available on every player's turn and while ordinary turn actions are pending, subject to the agreed discard window. Recommend the first valid attempt received by the authoritative room server wins. Resolve attempts atomically against a specific discard opportunity, so two players cannot both win and a match-created discard cannot accidentally reopen the same opportunity. Wrong attempts apply the penalty and leave matching available. Network latency affects races; do not describe server arrival order as perfectly fair or trust client-reported timestamps.
- Disconnect policy, host succession, and abandoned-room expiry need explicit defaults. Recommend a short reconnect grace period and host transfer without ending a game just because the lobby host disconnects; exact timing remains open.

No separate Redis, global database, or account service is needed for the proposed private-room version on Durable Objects.

## Design direction — proposed

Thesis: a quiet card table where positions stay trustworthy and the next action is clear.

The visual identity comes from legible playing cards, a restrained green associated with a card table, and the spatial arrangement of hands. Use a small geometric card-back pattern as the signature asset. Spend visual emphasis on the current action and cards. The product does not need a marketing hero, decorative metrics, or repeated branding.

### Compact token proposal

Colors below are custom semantic tokens, not copies of Apple's dynamic system color values. Ratios are calculated using WCAG relative luminance; text/accent/signal ratios are against the surface token. Final component combinations still need verification.

| Role | Light | Dark | Contrast, light / dark |
| --- | --- | --- | --- |
| Canvas | `#F2F4F3` | `#111815` | Background only |
| Surface/card | `#FFFFFF` | `#1C2821` | Background only |
| Primary ink | `#17231D` | `#EDF3EF` | 16.22:1 / 13.58:1 |
| Secondary ink | `#536158` | `#B1BFB5` | 6.52:1 / 7.99:1 |
| Action accent | `#216B45` | `#88D5A6` | 6.45:1 / 8.81:1 |
| Error/red suit | `#A52F35` | `#FF9498` | 6.87:1 / 7.23:1 |

Use white text on the light-theme accent button (6.45:1); use `#17231D` text on the dark-theme accent button (9.36:1). Pair red with suit shapes or explicit status words. Different meanings must not depend on color alone.

Type: system UI font stack for controls and body; 1rem body default (normally 16 CSS px), 0.875rem supporting labels, 1.25rem section titles, and 1.75rem page titles. Cards use large rank glyphs and suit shapes. Use tabular numerals for scores; a separate display/utility font is unnecessary initially. Scale with browser settings rather than fixed screenshot dimensions.

Layout, updated after Safari review: maximize the desktop table by moving controls onto its lower-right area beside your hand, rather than keeping a full-width banner below it. Keep the shared piles central and your hand in a stable two-by-two arrangement below. Arrange opponents in an arc with evenly spaced horizontal positions and gentle inward card-group tilts (up to 18 degrees); names remain upright. Highlight the active section with a subtle light panel and explicit “Your turn” / “Their turn” text. Use Safari for visual review.

```text
Regular width                       Compact width
┌─────────────────────────────┐     ┌───────────────────┐
│ Room · Copy invite    Rules │     │ Room        Rules │
│        Opponent hands       │     │  Opponent hands   │
│                             │     │  in a clear grid  │
│ Opponent  Draw Discard Other │     │                   │
│                             │     │   Draw   Discard  │
│       Turn / action prompt  │     │   Action prompt   │
│          Your hand          │     │     Your hand     │
│        Contextual actions   │     │ Contextual actions│
└─────────────────────────────┘     └───────────────────┘
```

The four-card arrangement shown by the eventual design must match the initial bottom-two peek. These wireframes describe regions, not final seat placement. At 7–10 players, allow a scrollable opponent region rather than shrinking cards below usable touch sizes. Matching other players' cards is confirmed and time-sensitive, so a hidden multi-step target picker would disadvantage phone users. Prototype direct card targeting at six players first, then explicitly evaluate the extra scrolling at ten. Do not promise equal visibility at all room sizes.

Motion: a clean 2D shuffle and deal is explicitly requested. Show a small flat deck with a brief packet offset/slide, settle it, then stagger face-down cards into their stable hand slots. Keep the total opening sequence around 1.5–2 seconds as a proposed starting point, rather than animating every card serially in a ten-player room. No 3D perspective, elaborate physics, particle effects, or repeated decorative motion. Routine card movement/reveal transitions can start around 120–180 ms. Respect reduced motion with immediate placement or a short fade; no player should wait for another browser's animation to finish. Animation completion must not control game deadlines or delay an accepted action.

### Interaction details

- Native HTML buttons, visible focus, keyboard selection, and touch targets at least 44 × 44 CSS px as our web design target.
- Clear prompts such as “Peek at one of your cards” and, in a separate phase, “Swap any two cards.”
- Separate the card being drawn, cards being peeked at, and cards being selected to swap. Never assume a peek target is a swap target.
- Initial peek: each bottom card is a one-use click-to-flip/click-to-hide target. “Look at bottom two” and “Done looking” are convenience actions. Viewing is untimed. Once closed, a card's initial peek cannot be reopened; show “Waiting for the table” until all players complete their looks. Keep values private and do not trigger the first turn from animation callbacks.
- Power peeks flip the target in place for the peeking player only, using a quick 180 ms two-dimensional flip. The face changes at the animation midpoint. Clicking again hides that card; King peeks can be hidden individually while retaining the other peek. A moved card's snapshot must not reveal the replacement card. No separate private-card tray is needed.
- Prefer tap/click selection with clear selected states. Dragging can be considered later; it should not be required.
- Matching should use a clearly entered mode with one-tap card attempts and an optional keyboard equivalent. Keep that mode active after a failed attempt, show the penalty, and do not add a confirmation step to each race. It must remain available off-turn. Validate how entering matching interacts with a partially completed peek/swap before implementing the flow.
- Keep selection reversible until an action commits. Avoid routine confirmation dialogs, but give committing actions clear labels and deliberate placement.
- During an unresolved network action, provide immediate local feedback and prevent duplicate submission. Do not optimistically reveal a card or assert a successful swap before server acceptance.
- Show turn and connection feedback near the table. Keep the rules available without forcing a tutorial before joining.
- At the end of the final turn, show a small visible five-second matching countdown in the existing action area. Use a server deadline, avoid an interrupting modal, and show a persistent “Game ending” state even with reduced motion. Stop accepting new attempts at the deadline and finish accepted effects before publishing scores.
- First-release visual checks target desktop Safari. Maintain visible focus and support browser zoom; allow scrolling rather than clipping. Phone-specific layouts and a full mobile accessibility pass are deferred per the user's launch priority.
- Follow the system color preference; support keyboard-only play and screen-reader labels that do not leak hidden values. Reduced transparency is satisfied by keeping surfaces opaque.

### Design basis and critique

Read from the apple-design skill:

- `design-principles.md › Simplicity`: “Be clear and direct.” Every visible element should serve joining, playing, or understanding state.
- `layout.md › Visual hierarchy`: “Use progressive disclosure to make layouts cleaner and easier to interact with.” Keep secondary controls/rules out of the central play area.
- `buttons.md › Best practices`: “Always include a press state for a custom button.” Provide pointer, keyboard, selected, pending, and disabled feedback deliberately.
- `feedback.md › Best practices`: “Consider integrating status feedback into your interface.” Keep network/turn feedback in context.
- `motion.md › Best practices`: “Make motion optional.” Maintain equivalent information with reduced motion.
- `onboarding.md › Best practices`: “Teach through interactivity.” Use contextual guidance for unfamiliar powers.
- `accessibility.md › Vision`, `typography.md › Supporting Dynamic Type`, and `color.md › Inclusive color` inform scaling, contrast, and non-color cues; translate these to browser zoom, CSS/ARIA, and web inputs.

Craft judgment: a generic dashboard or literal oval casino table would add structure unrelated to this memory game. Stable hand positions, clear power phases, and usable targets make this proposal specific to Cambio. Remove a persistent activity sidebar: show only a compact latest public action, with optional history only if players need it. Do not expose private peeks through that history.

This is a design proposal, not a verified interface. Contrast calculations above are real; responsiveness, keyboard behavior, hidden-information handling, and actual visual quality require implementation and review.

## Implementation sequence — for later

1. Review the proposed edge-case defaults and finalize a short rules specification with worked examples for matching during powers, opponent-card transfer, caller protection, empty-hand turns, final draw, and scoring. The core end conditions are confirmed.
2. Use the selected Cloudflare backend. Sketch the table at compact and regular widths, including a power selection and 10-player case.
3. Build the pure TypeScript rules engine. Test meaningful game transitions, hidden-information projections, locking, scoring, and all terminal paths before relying on UI behavior.
4. Add rooms, guest seats, persistence, WebSockets, reconnect, and duplicate/concurrent-action handling. Verify two separate clients first.
5. Build the responsive table and complete one game from joining through rematch. Validate keyboard, zoom, reduced motion, and private reveals before visual polish.
6. Exercise 2, 6, and 10 players; slow/dropped connections; reconnect during powers; rapid duplicate actions; simultaneous matches, wrong-match retries, and opponent-card transfers; final-draw and Cambio overlap; and backend restarts/hibernation.
7. Deploy a test environment, measure free-tier usage, then connect `cambio.shrysjain.me` and playtest with friends. Add the subdomain to Vercel and use the project-specific CNAME shown by its dashboard. The backend can initially use its provider URL, avoiding additional domain setup.

Completion criteria: a group can open an invitation, finish a game under the agreed rules, recover from ordinary connection loss, and play again without manual server intervention or hidden-card leakage from the application.

## Decisions outstanding

- Core rules and end conditions are confirmed. Review the explicitly proposed edge-case defaults before implementing them.
- Backend selected: Cloudflare Worker with SQLite-backed Durable Objects. Account/setup steps remain for implementation, with explicit guidance for the user.
- Guest reconnect/abandonment policy and invitation/code model. Ready-up rematches and winner-based starters are confirmed; cumulative totals have not been requested.
- Final visual direction after reviewing compact and regular table sketches.

The user authorized implementation, local verification, meaningful commits, and pushes to the named GitHub repository. The user will create/import the Vercel project and handle deployment with the provided instructions. No infrastructure has been provisioned by the agent.
