# ⚡ Fantasy2026 Draft — Auction Command Center & Live Intelligence

A high-performance local web application designed for your 12-team, \$200 auction cap fantasy football league with custom 0.5 PPR distance-bonus scoring, 15-player rosters (9 active starters: 1 QB, 2 RB, 2 WR, 2 Flex [RB/WR/TE], 1 K, 1 DST, and 6 reserves), real-time inflation/max-bid calculation, and live AI injury/health verification.

---

## 🚀 How to Run

### Option 1: Double Click
Double click **`start.bat`** in this directory. It will launch the local server and open `http://localhost:3000` in your browser.

### Option 2: With Node.js
```bash
node server.js
```
Then open [http://localhost:3000](http://localhost:3000) in Chrome or Edge.

### Option 3: With Python
```bash
python server.py
```

---

## 🏆 Key Features

1. **⚡ Live Auction Command Center & Draft Room**:
   - Live on-the-clock serpentine nomination tracker.
   - Dynamic real-time inflation & deflation calculation based on remaining league cash vs baseline player valuations.
   - 1-click player nomination, instant winning bid logger, and instant Undo (Alt+U).
   - "Should I Bid?" tactical advisor showing custom bid ceilings and need severity.

2. **📊 Master Player Cheat Sheet & Tiers**:
   - Filter by Position (ALL, RB, WR, TE, FLEX, QB, K, DST, ROOKIES).
   - Filter by Status (Available Only, Drafted, Starred/Targets, Do Not Draft).
   - Filter by Tier (Tier 1 Elite, Tier 2 High-End, Tier 3 Solid, Tier 4 Upside, Tier 5 Depth).
   - Sort by Proj Points, Baseline \$, Dynamic Inflated \$, Target Range, Hard Max, or AAV.
   - Detailed Player Card modal with scouting notes, injury flags, and offensive quality.

3. **🛡️ My Team Roster & Budget Strategy**:
   - Visual 9 Starters Grid (1 QB, 2 RB, 2 WR, 2 Flex, 1 K, 1 DST) + 6 Bench Slots.
   - Real-time Legal Max Bid enforcement ($1 reserved for every open starter).
   - Positional spending allocation chart and automatic Bye Week conflict detector.
   - Total projected starting lineup points.

4. **👥 All 12 League Teams Matrix**:
   - Grid of all 12 teams with remaining cash, max bids, starter/bench counts, and click-to-view roster breakdown.
   - Rename any team to your league-mates' real names.

5. **🌟 Rookie Hub (35 Drafted Rookies)**:
   - Dedicated view for all 35 rookies from Tab 2 of the Google Sheet with rookie tiers, scheme fits, snap projections, and tactical scouting notes.

6. **🔄 Google Sheets Sync & Backup**:
   - Live sync with your Google Spreadsheet (`https://docs.google.com/spreadsheets/d/1FHfpcyKwtGxmAhxD_e0qSfdEPtteVP-Ahb8B56nzxVQ/...`).
   - Copy-paste CSV/TSV table importer.
   - Export full draft board to CSV and JSON.

7. **🎯 In-Season Intelligence & CBS Sports Playwright Sync**:
   - **Weekly Lineup Optimizer**: Customized 1 QB, 2 RB, 2 WR, 2 Flex, 1 K, 1 DST start/sit engine with **Floor Mode** (safe points for favorites) and **Ceiling Mode** (distance bonus boom chasing for underdogs).
   - **Matchup Context & Opponent Scouting**: Win probability meter, point spread margin, and tactical posture recommendations (e.g. holding high-upside rookie stashes when heavily favored).
   - **Defensive Blocking Radar**: Identifies opponent roster vulnerabilities and alerts you to potential waiver blocks.
   - **Waiver Wire & \$100 FAAB Advisor**: Real-time target/snap spike flags, injury handcuff alerts, and suggested FAAB bids.
   - **Bench Drop & Stash Protector**: Protects untouchable rookies/IR stashes while identifying cuttable bench depth.
   - **Playwright Automation**: Run `python scripts/cbs_sync.py --login` to save your CBS session once, and `python scripts/cbs_sync.py --sync` (or the in-app "Sync CBS Live" button) for instant headless updates from `https://nefjbffl.football.cbssports.com/`.

---

## ⚙️ League Rules & Custom Scoring Specs

- **Auction Cap**: \$200 per team (\$2,400 total).
- **Rosters**: 15 total (9 starters, 6 bench). Minimum 9 starters drafted on draft day.
- **Starters**: 1 QB, 2 RB, 2 WR, 2 Flex (RB/WR/TE), 1 K, 1 DST.
- **Passing**: 6 pt PaTD, 0.04 pt/yd (1 pt/25yd) + 2pt bonus @ 400+ yds, -2 INT, 2pt Pa2P.
- **Rushing & Receiving**: 6 pt RuTD/ReTD, 0.1 pt/yd (1 pt/10yd) + 2pt bonus @ 200+ yds, 0.5 PPR, -1 Fumble Lost.
- **TD Distance Bonuses**: +0.5 (20-29yd), +1.0 (30-39yd), +1.5 (40-49yd), +2.0 (50-59yd), +2.5 (60-69yd), +3.0 (70-79yd), +3.5 (80-89yd), +4.0 (90-99yd), +4.5 (100+yd).
- **Kicking**: FG 3 pts (+1 pt for 40-50yd, +2 pt for 51+yd), XP 1 pt.
- **Defense / ST**: Custom points against (8 to -2) and yards allowed brackets (6 to 1).
- **Waivers / Drop-Add**: \$100 FAAB regular season budget.
