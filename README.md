# memebot

A fully automatic Solana meme-coin trading bot. Rules only — no AI in the trade
loop. It paper-trades with **real** Jupiter quotes until it proves it has an
edge, then optionally goes live with a bankroll you choose and cannot exceed.

## Read this first

Most meme-coin bots lose money. Liquidity is thin, most tokens go to zero,
and every buy/sell costs real slippage. This bot is built to *prove* an edge
before it risks real money (see [Readiness gate](#readiness-gate) below), and
to cap the loss at whatever bankroll you fund it with if it turns out it
doesn't have one. Treat the bankroll as tuition, not an investment.

Two honest numbers to set expectations:
- Round trips on a small meme-coin position (buy then sell a few dollars of a
  thinly-traded token) typically cost a meaningful chunk of the position in
  Jupiter price impact plus network fees — this bot measures that for real on
  every paper trade instead of assuming a flat fee, so its win rate needs to
  clear that cost, not just "be positive," to actually make money.
- Paper trading is a ceiling, not a floor. It uses real quotes so the P&L is
  honest about slippage, but it can't capture everything (e.g. failed/dropped
  transactions, execution latency under real load). Live results will
  typically be a bit worse than paper results, not better.

## 1. Accounts you need

| What | Why | Link |
|---|---|---|
| Node.js 20+ | runs the bot | https://nodejs.org |
| Telegram + a bot token | control it and get alerts | message https://t.me/BotFather -> `/newbot` |
| Solana Tracker Data API key | copy-trading (top traders / wallet history), free tier 2,500 req/month | https://www.solanatracker.io/data-api |
| Phantom wallet (only for going live) | the bot's own wallet — make a **new** account, never your main one | https://phantom.com |
| Helius RPC key (optional) | faster/more reliable RPC when live | https://www.helius.dev |
| Anthropic API key (optional) | lets you ask the bot free-form questions in Telegram; without it, a built-in keyword Q&A covers the common ones | https://console.anthropic.com |

No key is ever typed into chat with an AI. They go into `.env` via
`node setup-from-phone.js` or `node set-key.js NAME value`.

## 2. Setup

```
npm install
node setup-from-phone.js     # open the printed URL on your phone, same Wi-Fi,
                              # paste your Telegram token and Solana Tracker key
npm test                     # the full money/risk/exits test suite should pass
```

Start it:

```
node src/main.js             # runs once, exits on crash
./run-memebot.sh             # mac/linux: restarts it automatically on crash
run-memebot.cmd              # windows: same, restarts automatically
```

To autostart at login: on macOS, copy `com.memebot.plist.example` to
`~/Library/LaunchAgents/com.memebot.plist`, replace `REPLACE_WITH_FULL_PATH`
with this folder's absolute path, and run `launchctl load ~/Library/LaunchAgents/com.memebot.plist`.
On Windows, drop a shortcut to `run-memebot.cmd` in your Startup folder
(`shell:startup`).

Pair Telegram: `npm run status` prints a 6-digit pairing code. Send
`/start <code>` to your bot within 15 minutes. From then on only that chat
can control the bot.

In Obsidian, open the folder this created — `brain/` by default, or wherever
`BRAIN_DIR` in `.env` points — as a vault (or a folder inside an existing
vault). `Home.md` is the dashboard; `Control.md` is how you steer it by hand.

Then leave it running. Check `npm run status` for the readiness gate.

## 3. How it trades

**Research** (every 45s): pulls candidates from DexScreener (token profiles,
boosts) and GeckoTerminal (trending/new Solana pools), hydrates them with
live pair data, and runs them through hard filters — liquidity, volume, age,
market cap, buy/sell pressure, **mint and freeze authority revoked** (checked
on-chain), a RugCheck safety score, and a real Jupiter sell quote at the
position size to catch honeypots (if a token can't be sold back to SOL
without huge price impact, it's skipped). Survivors get a 0-100 score across
momentum, buy pressure, volume turnover, safety, and age; a score of 60+ buys.

**Position sizing**: 16% of the *current* bankroll (compounds as it grows),
floor $5, ceiling $250. Daily loss cap: the greater of $15 or 30% of
bankroll. After any loss: a cooldown before the next buy, and that specific
token is blocked from rebuying for 4 hours. At most 5 positions open at once.

**Exits** (checked every 15s): take profit at 2.5x (sells everything, unless
5-minute momentum is still very strong, in which case it banks 75% and lets
25% ride); 25% stop loss from entry; 30% trailing stop from the peak; 4-hour
max hold. A missing price is treated as a data hiccup, not a rug — after 5
misses in a row it forces an exit anyway. A trade's outcome (WIN/LOSE) is
judged on the whole position, not the last partial sale.

**Copy-trading**: once a day, pulls the top traders on the highest-volume
tokens from that day's scan (not the global leaderboard, which is mostly
scalper bots), reconstructs each wallet's round trips, and starts following
wallets with 15+ round trips, a 20+ minute median hold, and a 50%+ win rate.
A token newly held by 2+ followed wallets jumps the research queue (still has
to pass every safety filter). If the wallets that held it at entry mostly
leave, the bot sells.

**Paper vs. live**: paper fills use real Jupiter quotes for the exact size,
minus a real (not flat-percentage) fee estimate, so paper P&L reflects real
slippage. Live fills actually build, sign, and send the Jupiter swap, then
read the real on-chain token balance rather than trusting the quote.

## 4. Rounds, bankroll, and the kill switch

**Paper mode** never halts. It runs in rounds: a round ends at $0 (LOST) or
at a rising target — $200 for round 1, +$100 per round won — either way the
bankroll resets to a fresh `BANKROLL_USD` and a rounds-won/lost scoreboard
keeps score. This is how the bot proves an edge without you having to babysit
losses.

**Live mode** has one ongoing bankroll and a hard kill switch: if realized
losses reach the bankroll you funded it with, it sells every open position
back to SOL, writes a report to your Desktop, and halts. It does not delete
itself unless you explicitly enable `DELETE_ON_KILL=true`.

A single-instance PID lock means you can never accidentally run two copies
against the same bankroll.

## 5. Readiness gate

`npm run status` reports GO only when **all** of these hold:

- 30+ closed trades
- 14+ days of history
- cumulative P&L is at least +$10 after fees
- replaying the current exit rules over 40+ real recorded price paths shows
  +8%/trade or better
- 3+ rounds won, and more rounds won than lost
- profitable in 2+ separate calendar weeks
- not halted

None of this is a promise of future profit — it's a bar the bot has to clear
on its own recorded, real-quote data before you fund it for real.

## 6. Going live

1. Create a **new** Phantom account (never your main wallet).
2. Fund it with ~$50 in SOL for trading plus ~$10 extra for fees.
3. `node set-key.js WALLET_PRIVATE_KEY <exported key>` — run this only on
   your own computer, never paste the key anywhere else.
4. `node set-key.js MODE live`
5. Restart the bot.

The 0.01 SOL fee buffer and the kill switch still apply. If it loses the
funded bankroll, it liquidates, reports, and halts — it will not keep going
without you restarting it.

## 7. Learning tools

- `npm run replay` — re-runs the current (and a grid of alternative) exit
  rules over every recorded real price path.
- `npm run entries` — buckets entry features (liquidity, volume, buy/sell
  ratio, etc.) against outcome to show what's actually predictive.
- `npm run simulate` — Monte Carlo bankroll projection sampling from real
  replayed trade outcomes.
- `npm run sweep` — grid-searches exit parameters and simulates each.

## 8. Proposals

`node propose.js "<title>" "<evidence>" key=value` records a config change
with the old and new values. Approve it with `/approve N` in Telegram or by
ticking its box under **Approve proposals** in `Control.md`. Approving
re-applies the rule, runs the full test suite, and reverts automatically if
anything fails. Risk limits, position size, and the daily loss cap can never
be proposed or approved — they're hardcoded.

## 9. Telegram

Commands: `/status` `/positions` `/money` `/pause` `/resume` `/stop confirm`
`/proposals` `/approve N` `/reject N`. Plain-text messages get built-in
keyword answers (how much made/lost, rounds, sims, holdings, readiness, why a
token was sold, lessons) whether or not `ANTHROPIC_API_KEY` is set. A morning
report goes out at 07:00 local time.

## 10. Obsidian

`Home.md` refreshes every 5 minutes with the current status. `Journal/`
gets a dated entry appended as things happen. `Tokens/<symbol>.md` is written
for every trade with what it bought, why, and a lesson if it lost.
`Wallets/` covers followed copy-trade wallets. `Lessons.md`, `Rules.md`
(current config + tune history), and `Proposals.md` round it out.
`Control.md` is read every scan cycle: tick **pause trading**, list mints or
symbols under **Never buy**, list wallet addresses under **Wallets to
follow**, or tick a proposal under **Approve proposals**.

## 11. Tests

`npm test` runs the full `node --test` suite — every money rule (exits,
compounding position sizing, the risk gate, the daily cap, the kill switch,
round accounting), position accounting across partial sells, scoring bounds,
copy-trade wallet qualification, replay, proposals (locked keys refused,
revert on a failing test run), Telegram pairing and command parsing, the
Obsidian Control.md parser, and the ledger's money tally.

## 12. Keys and safety

Keys never go through chat with an AI, and there's no code path that would
send them anywhere. `set-key.js` validates format before writing anything.
The wallet private key can only be set from a terminal on the machine
running the bot.
