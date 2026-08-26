export default async function handler(req, res) {
  try {
    const urlObj = new URL(req.url, 'http://localhost');
    const playerName = urlObj.searchParams.get('player');
    const pos = urlObj.searchParams.get('pos') || '';
    const team = urlObj.searchParams.get('team') || '';
    const clientApiKey = urlObj.searchParams.get('apiKey');
    const apiKey = process.env.GEMINI_API_KEY || clientApiKey;

    if (!apiKey) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ success: false, error: 'NO_API_KEY', message: 'No Gemini API key configured on server or client.' }));
      return;
    }

    let prompt;
    if (pos === 'DST' || (playerName && (playerName.includes('Defense') || playerName.includes('Broncos') || playerName.includes('Steelers') || playerName.includes('Eagles') || playerName.includes('Ravens') || playerName.includes('49ers') || playerName.includes('Vikings') || playerName.includes('Texans') || playerName.includes('Bills') || playerName.includes('Jets') || playerName.includes('Cowboys') || playerName.includes('Chiefs') || playerName.includes('Lions') || playerName.includes('Chargers') || playerName.includes('Packers') || playerName.includes('Browns') || playerName.includes('Bears') || playerName.includes('Seahawks') || playerName.includes('Buccaneers') || playerName.includes('Dolphins') || playerName.includes('Colts') || playerName.includes('Rams') || playerName.includes('Saints') || playerName.includes('Jaguars') || playerName.includes('Falcons') || playerName.includes('Patriots') || playerName.includes('Bengals') || playerName.includes('Titans') || playerName.includes('Commanders') || playerName.includes('Giants') || playerName.includes('Cardinals') || playerName.includes('Raiders') || playerName.includes('Panthers')))) {
      prompt = `
You are a real-time fantasy football defense/special teams analyst and high-stakes auction draft strategist.
Analyze the NFL Team Defense & Special Teams (DST) unit: ${playerName} (${team} Defense).

LEAGUE CONTEXT:
- 12 Teams, $200 Auction Cap ($2,400 total league spend).
- Starting Defense: 1 DST slot.
- Scoring: Sacks = 1 pt, Interceptions/Fumble Recoveries = 2 pts, Defensive TDs = 6 pts, Safeties = 2 pts, Turnover on Downs = 1 pt. Standard points/yards allowed brackets.
- DST Auction Valuation Rule: Never spend more than $1-$3 on any DST.

SEARCH & EVALUATE:
Search specifically for the ${playerName} DEFENSIVE unit: defensive coordinator scheme changes, pass-rush pressure rate / sack floor, secondary coverage health/injuries, turnover generation, return game touchdowns, and early season streaming schedule (Weeks 1-4).

Return ONLY a valid JSON object matching this schema (no markdown code blocks, pure JSON):
{
  "headline": "Short defensive headline (max 12 words)",
  "summary": "2-3 concise sentences detailing pass rush strength, secondary health, turnover outlook, and fantasy streaming viability.",
  "predictiveValue": 1,
  "targetBidRange": "$1-$2",
  "maxBidCeiling": 3,
  "valueCategory": "PRIME TARGET" | "FAIR VALUE" | "STREAM / LATE $1" | "DO NOT DRAFT",
  "hiddenEdge": "1-2 sentences on early season schedule match-ups, pass rush win rate, or turnover regression.",
  "injuryStatus": "Healthy" | "Minor / Probable" | "Questionable" | "Elevated Risk" | "Key Defensive Injuries",
  "draftSentiment": "RISING" | "FALLING" | "NEUTRAL",
  "auctionAdvice": "One actionable tactical sentence on whether to pay $1-$2 for this defense or stream off waivers.",
  "source": "Primary defensive beat reporter or analyst name",
  "confidence": "HIGH" | "MEDIUM"
}
`;
    } else if (pos === 'K') {
      prompt = `
You are a real-time fantasy football kicking specialist and auction draft strategist.
Analyze the NFL starting kicker: ${playerName} (${pos}, ${team}).

LEAGUE CONTEXT:
- 12 Teams, $200 Auction Cap ($2,400 total league spend).
- Starting Kicker: 1 K slot.
- Scoring: Base FG = 3 pts, 40-49 yd FG = 4 pts (+1 bonus), 50+ yd FG = 5 pts (+2 bonus), Extra Point = 1 pt.
- Kicker Auction Valuation Rule: Elite big legs on high-scoring offenses are worth $1-$3 max; never bid >$3.

SEARCH & EVALUATE:
Search for recent news, preseason competition, 50+ yard accuracy, offensive drive volume, indoor dome advantage, and injury health for kicker ${playerName} on the ${team}.

Return ONLY a valid JSON object matching this schema (no markdown code blocks, pure JSON):
{
  "headline": "Short kicker headline (max 12 words)",
  "summary": "2-3 concise sentences detailing leg range, indoor stadium factors, offensive scoring environment, and job security.",
  "predictiveValue": 1,
  "targetBidRange": "$1-$2",
  "maxBidCeiling": 3,
  "valueCategory": "PRIME TARGET" | "FAIR VALUE" | "STREAM / LATE $1" | "DO NOT DRAFT",
  "hiddenEdge": "1-2 sentences on 50+ yard field goal volume, dome schedule, or offensive red zone stall tendencies.",
  "injuryStatus": "Healthy" | "Minor / Probable" | "Questionable" | "Out / IR",
  "draftSentiment": "RISING" | "FALLING" | "NEUTRAL",
  "auctionAdvice": "One actionable sentence on whether to secure for $1-$2 or take last $1 kicker.",
  "source": "Primary news source or kicker beat reporter",
  "confidence": "HIGH" | "MEDIUM"
}
`;
    } else {
      prompt = `
You are a high-stakes fantasy football auction draft analyst, analytics director, and NFL beat insider.
Analyze NFL player: ${playerName} (${pos}, ${team}).

YOUR USER'S EXACT LEAGUE RULES & SCORING SYSTEM:
1. Format: 12 Teams, $200 Auction Budget ($2,400 total league spend).
2. Roster: 15 roster spots (9 Starters: 1 QB, 2 RB, 2 WR, 2 FLEX [RB/WR/TE], 1 K, 1 DST, 6 Bench).
3. NO MANDATORY TE SLOT: Tight ends are ONLY eligible in the 2 FLEX spots alongside WRs and RBs. Do NOT overvalue mid/low TEs; only elite difference-makers (Bowers, McBride, Kittle) warrant draft capital above $10-$15.
4. 6-POINT PASSING TOUCHDOWNS: Passing TDs are 6 pts (not standard 4 pts). This substantially boosts the predictive value of high-volume and dual-threat quarterbacks (Josh Allen, Lamar Jackson, Jalen Hurts, Jayden Daniels, Mahomes).
5. DISTANCE BONUS SCORING MATRIX:
   - 20-29 yards: +0.5 pts
   - 30-39 yards: +1.0 pts
   - 40-49 yards: +1.5 pts
   - 50-59 yards: +2.0 pts
   - 60-69 yards: +2.5 pts
   - 70-79 yards: +3.0 pts
   - 80-89 yards: +3.5 pts
   - 90-99 yards: +4.0 pts
   - 100+ yards: +4.5 pts
   Explosive big-play/home-run threats (Gibbs, Achane, Ja'Marr Chase, Nico Collins, Malik Nabers, Brian Thomas Jr.) get massive value multipliers.
6. 0.5 PPR, 1 pt per 10 rush/rec yds, 1 pt per 25 pass yds, 2 pt bonus at 200 rush/rec or 400 pass yds.

CRITICAL HIDDEN INFORMATION TO SEARCH & EVALUATE:
- Offensive Line & Protection Grade: Starting tackle/guard injuries, pass-block win rate, run-blocking continuity.
- Scheme & Playcalling Tendencies: Pass Rate Over Expected (PROE), no-huddle pace, red-zone condensed sets vs spread.
- High-Leverage Roles: Goal-line carry share vs vulture risk (goal-line backs / QB sneaks), 2-minute drill and 3rd down passing snap rates.
- Target Funnel & Vacated Volume: Uncontested alpha target trees vs messy committee rotations.
- Beat Reporter & Camp Intelligence: Practice participation (Full / Limited / DNP), 1st team reps, contract year motivation, soft-tissue injury recurrence risk (hamstrings, calves, groins have high 3-week reinjury rate).

CALCULATE PREDICTIVE VALUE:
Provide a calibrated integer dollar valuation ($1-$65) based strictly on this 12-team, $200 budget, 0.5 PPR, 6pt PaTD, Distance Bonus, 2-FLEX (no dedicated TE) system.

Return ONLY a valid JSON object matching this schema (no markdown code blocks, pure JSON):
{
  "headline": "Short punchy breaking news/role headline (max 12 words)",
  "summary": "2-3 concise sentences detailing current health, camp performance, snap volume, or target share outlook.",
  "predictiveValue": 42,
  "targetBidRange": "$38-$44",
  "maxBidCeiling": 48,
  "valueCategory": "SMASH VALUE" | "PRIME TARGET" | "FAIR VALUE" | "OVERPRICED TRAP" | "SLEEPER GEM" | "DO NOT DRAFT",
  "hiddenEdge": "1-2 sentences of hidden game-winning intel (O-line ranking, goal-line touch share vs vulture risk, 2-min drill usage, scheme PROE, soft-tissue risk).",
  "injuryStatus": "Healthy" | "Minor / Probable" | "Questionable" | "Elevated Risk" | "Out / IR",
  "draftSentiment": "RISING" | "FALLING" | "NEUTRAL",
  "auctionAdvice": "Actionable tactical bidding advice with exact price enforcement and nomination strategy.",
  "source": "Primary beat reporter or analytics source",
  "confidence": "HIGH" | "MEDIUM"
}
`;
    }

    const makeRequestBody = (includeSearch = true) => {
      const body = {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2 }
      };
      if (includeSearch) {
        body.tools = [{ googleSearch: {} }];
      }
      return JSON.stringify(body);
    };

    const modelsToTry = [
      { model: 'gemini-3.7-flash', search: true },
      { model: 'gemini-3.7-flash', search: false }
    ];

    let lastError = null;
    let parsed = null;

    for (const attempt of modelsToTry) {
      try {
        const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${attempt.model}:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: makeRequestBody(attempt.search)
        });

        if (geminiRes.ok) {
          const resJson = await geminiRes.json();
          const candidate = resJson.candidates?.[0];
          const rawText = candidate?.content?.parts?.map(p => p.text).join('') || '';

          let cleanJson = rawText.trim();
          if (cleanJson.startsWith('```json')) {
            cleanJson = cleanJson.replace(/^```json\s*/, '').replace(/\s*```$/, '');
          } else if (cleanJson.startsWith('```')) {
            cleanJson = cleanJson.replace(/^```\s*/, '').replace(/\s*```$/, '');
          }

          parsed = JSON.parse(cleanJson);
          if (candidate?.groundingMetadata?.groundingChunks) {
            parsed.searchSources = candidate.groundingMetadata.groundingChunks
              .filter(c => c.web?.title && c.web?.uri)
              .map(c => ({ title: c.web.title, uri: c.web.uri }))
              .slice(0, 3);
          }
          break;
        } else {
          const errText = await geminiRes.text();
          lastError = errText;
          if (geminiRes.status === 429 || geminiRes.status === 404 || geminiRes.status === 400) {
            continue;
          } else {
            break;
          }
        }
      } catch (e) {
        lastError = e.message;
      }
    }

    if (!parsed) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ success: false, error: lastError || 'All model fallbacks failed' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ success: true, data: parsed }));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ success: false, error: e.message }));
  }
}
