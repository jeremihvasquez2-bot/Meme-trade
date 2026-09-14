# memebot

A fully automatic Solana meme-coin trading bot. Rules only — no AI in the trade
loop. It paper-trades with **real** Jupiter quotes until it proves it has an
edge, talks to you on Telegram, keeps its memory in Obsidian as Markdown, and
cannot lose more than the bankroll you give it.

### Read this first

Most meme-coin bots lose money. This one is built to *prove* it has an edge
before it touches real money, and to cap the loss at your bankroll if it
doesn't. Treat the bankroll as tuition.

Some numbers it will not hide from you:

- A round trip on an $8 position costs roughly **8–9%** — buy slippage, sell
  slippage and two lots of network fees. Paper fills are priced off the same
  Jupiter quotes a live fill would hit, for the exact size, so this cost shows
  up in paper P&L instead of being discovered with real money.
- At that cost and these exit rules it needs roughly a **40% win rate** to
  break even. `npm run simulate` prints the exact break-even rate for the data
  it has actually recorded.
- **Most meme coins go to zero.** The strategy is not "pick winners", it is
  "cut the losers at −25% and let a few winners reach 2.5x".
- **Paper results are the ceiling, not the floor.** Live adds failed
  transactions, MEV, and a real queue between the quote and the fill.

---

## 1. What you need

| What | Why | Where |
|---|---|---|
| **Node.js** (LTS, 20+) | runs the bot | https://nodejs.org |
| **Telegram** + a bot token | control it from your phone | https://t.me/BotFather → `/newbot` |
| **Solana Tracker Data API key** | finds top traders to follow (free tier: 2,500 requests/month) | https://www.solanatracker.io/data-api |
| **Phantom wallet** (live only) | the bot's own wallet — a **new** account, never your main one | https://phantom.com |
| **Obsidian** (optional) | read its journal, token notes and lessons; steer it from a note | https://obsidian.md |
| **Helius RPC key** (optional) | faster, more reliable Solana access when live | https://www.helius.dev |
| **Anthropic API key** (optional) | plain-language answers in Telegram; without it a built-in Q&A covers the common questions | https://console.anthropic.com |

No key ever goes into a chat with an AI. They go into a local `.env` via
`node set-key.js` or the phone setup page.

## 2. Setting it up

```sh
npm install                 # no dependencies, but this sets the project up
cp .env.example .env        # Windows: copy .env.example .env
npm test                    # 246 tests should pass
```

Put your keys in from your phone:

```sh
node setup-from-phone.js
```

It prints a URL and a six-digit code. Open the URL on a phone on the same
Wi-Fi, enter the code, paste your Telegram token and Solana Tracker key. The
page only exists while that command runs, and it will never accept the wallet
private key.

Start it:

```sh
run-memebot.cmd             # Windows  (mac/linux: ./run-memebot.sh)
```

The runner restarts the bot if it crashes. To have it start when you log in:
`node scripts/install-autostart.js` (undo with `--remove`).

Pair Telegram:

```sh
npm run status              # prints a pairing code
```

Send your bot `/start <code>`. From then on only that chat can command it.

In Obsidian, open the folder it created (`Agents/MEMEBOT` in your vault, or
set `BRAIN_DIR` in `.env` to wherever you want the notes).

Then leave it alone.

## 3. What it does, all day

**Every 45 seconds** it pulls candidates from DexScreener (token profiles,
boosts latest and top) and GeckoTerminal (trending pools pages 1–2, new pools
pages 1–3), hydrates them through DexScreener, and throws away everything that
fails any of these:

| Filter | Range |
|---|---|
| Liquidity | $15k – $500k |
| 1h volume | ≥ $20k |
| Age | 20 min – 72 h |
| Market cap | $50k – $5M |
| 5-min buy/sell ratio | ≥ 1.2 |
| Mint authority | revoked |
| Freeze authority | revoked |
| RugCheck | score ≤ 2000, no "danger" risks |
| Jupiter sell quote for our size | exists, ≤ 8% price impact |

That last one is the honeypot check: a token you can buy but cannot sell is
the classic rug, so it asks for a real quote to get the money back out *before*
putting any in.

Survivors are scored 0–100 on momentum, buy pressure, volume turnover, safety
quality and age. It buys at 60 or above.

**Every 15 seconds** it checks every open position:

- take profit at **2.5x** — sells the lot, unless 5-minute buy pressure is
  still very strong (buy/sell ≥ 2, m5 ≥ +3%, 5m volume ≥ $5k), in which case
  it sells 75% and lets 25% ride
- **25%** stop loss
- **30%** trailing stop from the peak
- **4h** maximum hold
- a missing price is a *strike*, not a rug: after 5 in a row it sells on-chain
  anyway (live) or writes it off (paper)

WIN or LOSE is judged on the whole trade, not the last sale. Selling 75% at
2.5x and riding the rest to zero is still a win, and the alert says so.

**Money rules that cannot be changed by the bot:** position size is 16% of the
current bankroll (so it compounds), minimum $5, maximum $250; daily loss cap is
the larger of $15 and 30% of the bankroll; 3 open positions at most; a cooldown
after every loss; no re-buying a token for 4h after losing on it; a PID lock so
two copies can never share one bankroll.

**Once a day** it looks for wallets worth following: the top traders on the ten
busiest liquid tokens from the last scan (Solana Tracker), *not* the global
leaderboards — those are scalper bots nobody can copy. Each candidate wallet's
trade history is rebuilt into round trips, and it is only followed if it has
≥ 15 round trips, a median hold ≥ 20 minutes and a win rate ≥ 50%. Followed
wallets' holdings are polled every 60 seconds; a token newly held by 2+ of them
jumps the queue with a score boost — but still has to pass every safety filter.
If the wallets that held it at entry mostly leave, the bot leaves too.

## 4. How it learns

It records the **real price path** — one tick every 15 seconds: price, 5-minute
change, buys, sells, volume — for every open position *and* for every candidate
that passed safety but was not bought (shadow paths, 6 hours each), together
with the features it had at entry.

| Command | What it tells you |
|---|---|
| `npm run replay` | re-runs the actual exit code over every recorded path, then a grid of alternative targets, stops and trails |
| `npm run entries` | buckets entry features against outcome — what actually came before the winners |
| `npm run simulate` | Monte Carlo over the real exit code with the measured cost: how often $50 reaches the target, how often it goes to zero |
| `npm run sweep` | the grid again, judged on round win rate rather than average return |
| `npm run status` | the money, and the readiness gate |

Changes to the rules go through **proposals**:

```sh
node propose.js "Tighter trail" "replay over 120 paths: +11.2%/trade vs +8.1%" TRAILING_STOP_PCT=0.22
```

Nothing happens until you approve it — `/approve 1` in Telegram, or tick the
box in `Control.md`. Applying it re-runs the whole test suite and reverts the
change if anything fails. **Risk limits, position size and the kill switch can
never be proposed** — those only change when you edit `.env` yourself.

## 5. Telegram

Commands: `/status` `/positions` `/money` `/pause` `/resume` `/stop confirm`
`/proposals` `/approve N` `/reject N`.

Or just ask in plain English — "how much have you made", "what are you
holding", "are you ready", "why did you sell PEPE", "what have you learned",
"run the sims". Those are answered by built-in keyword matching with no API key
at all; an Anthropic key only adds answers to the questions it doesn't know.

Every notification opens with where the money is:

```
💰 WALLET $58.40 of $50.00 ($8.20 in 1 open trade)
ROUND 1 → target $200.00 · ROUNDS WON 0 – LOST 0
```

and closes with the score:

```
MADE $22.10 · LOST $13.70 · NET +$8.40
RECORD: 4 WIN – 6 LOSE
```

Sell alerts start `🟢 WIN` or `🔴 LOSE` and give both this sale's dollars and
the whole trade's dollars. There is a morning report at 07:00.

## 6. The Obsidian brain

In the folder you choose:

- **MEMEBOT.md** — the home note, refreshed every 5 minutes
- **Journal/** — one note per day, appended as things happen
- **Tokens/** — one note per token traded, with frontmatter (`pnl`,
  `peak_multiple`, `hold`, `outcome`) and a body saying why it was bought, what
  safety looked like at entry, the timeline, and a lesson drawn by rule
- **Wallets/** — one note per followed wallet and why it is followed
- **Lessons.md**, **Rules.md** (the live config plus every change ever made),
  **Proposals.md**
- **Control.md** — read on every scan. Tick `pause trading`, list mints under
  *Never buy*, list wallets under *Wallets to follow*, tick proposals to
  approve. No restart needed.

## 7. Rounds, and the readiness gate

In paper mode the bot never halts — it plays **rounds**. A round ends at $0
(LOST) or at a target (WON, starting at $200 and rising $100 per win). Either
way it resets to a fresh bankroll and the scoreboard remembers. A bot that
wins rounds at a rising bar is doing something; a bot that wins one is lucky.

`npm run status` shows the gate. Every line must be GO before you fund it:

- ≥ 30 closed trades
- ≥ 14 days running
- cumulative P&L ≥ +$10 **after fees**
- replay of the current rules over ≥ 40 real recorded paths ≥ +8%/trade
- ≥ 3 rounds won, and more won than lost
- profitable in ≥ 2 separate ISO weeks
- not halted

The monthly profit target is shown as a line, not a gate. A target is a hope,
and hopes do not get to unlock a wallet.

## 8. Going live

1. A **new** Phantom account — never your main one.
2. Fund it with about $50 of SOL plus ~$10 for fees.
3. At the PC, in your own terminal (never in a chat):
   ```sh
   node set-key.js WALLET_PRIVATE_KEY <key>
   node set-key.js MODE live
   ```
4. Restart the bot.

Live fills go: Jupiter quote → `/swap` build → signed locally with the key from
`.env` → sent → confirmed. After a buy it reads the real token balance from the
chain rather than trusting the quote. Sells are clamped to the on-chain balance,
and a full exit sells the entire balance. It keeps a 0.01 SOL fee buffer and
caps the priority fee at 500,000 lamports.

**The kill switch.** If realised losses reach the bankroll in live mode, it
sells every open position back to SOL through Jupiter, writes a final report to
your Desktop listing every trade, and halts. Setting
`KILL_SWITCH_DELETE_PROJECT=true` makes it delete the whole project folder
instead of just stopping — off by default, because the recorded data is worth
more than the closure.

## 9. Layout

```
src/
  main.js        the loops and the schedule        engine.js    every trade, in one place
  research.js    scan → filter → score            filters.js   the hard filters
  scoring.js     the 0–100 score                  exits.js     the exit rules (pure)
  exec.js        paper and live fills             wallet.js    local ed25519 signing
  state.js       bankroll, rounds, tallies        risk.js      the gate every buy walks through
  paths.js       the price-path recorder          replay.js    re-run the rules over real data
  montecarlo.js  how often $50 reaches the target copytrade.js wallets worth following
  brain.js       the Obsidian notes               telegram.js  pairing, commands, alerts
  proposals.js   rule changes, approved by you    readiness.js the gate
  sources/       dexscreener, geckoterminal, jupiter, rugcheck, rpc, solanatracker
tools/           status, replay, entries, simulate, sweep
test/            246 tests over every money rule
```

There are no dependencies. Everything is ESM JavaScript on Node's own
standard library — `node --test` for the tests, `fetch` for HTTP, `node:crypto`
for signing. Nothing in `node_modules` can quietly change how your money moves.

## 10. Honest expectations

- The scan is written against the documented shapes of DexScreener,
  GeckoTerminal, RugCheck, Jupiter and the Solana RPC. Expect to fix a field
  name or two the first time you run it against the live APIs.
- Paper P&L is honest about slippage and fees. It is still not honest about
  failed transactions, MEV or the seconds between the quote and the fill.
- A grid search over 80 recorded paths will always find something that looks
  better than what you have. That is what overfitting looks like from the
  inside. Wait for more data than you think you need, and prefer a change that
  is good across a whole neighbourhood of the grid.
- If it never reaches GO, it has done its job: it found out that it has no edge
  for $0.
