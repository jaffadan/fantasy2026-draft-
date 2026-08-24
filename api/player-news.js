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
You are a real-time fantasy football defense/special teams analyst and high-stakes auction draft expert.
Analyze the NFL Team Defense & Special Teams (DST) unit: ${playerName} (${team} Defense).
Search specifically for the ${playerName} DEFENSIVE unit, defensive coordinator scheme changes, pass rush (sacks/pressures), secondary coverage health, turnover generation, special teams return touchdowns, and streaming schedule.

Return ONLY a valid JSON object matching this schema (no markdown code blocks, pure JSON):
{
  "headline": "Short defensive unit headline (e.g. 'Front-Seven Pressure Floor High; Favorable Early Schedule') (max 12 words)",
  "summary": "2-3 concise sentences detailing their pass rush strength, secondary health, turnover outlook, and fantasy streaming viability.",
  "injuryStatus": "Healthy" | "Minor / Probable" | "Questionable" | "Elevated Risk" | "Key Defensive Injuries",
  "draftSentiment": "RISING" | "FALLING" | "NEUTRAL",
  "auctionAdvice": "One actionable tactical sentence on whether to pay up for this defense ($1-$3 range) or stream.",
  "source": "Primary defensive beat reporter or analyst name",
  "confidence": "HIGH" | "MEDIUM"
}
`;
    } else if (pos === 'K') {
      prompt = `
You are a real-time fantasy football kicking specialist and auction draft analyst.
Analyze the NFL starting kicker: ${playerName} (${pos}, ${team}).
Search for the most recent news, field goal accuracy from 50+ yards, preseason kicking competitions, offensive drive volume, indoor dome advantage, and injury health for kicker ${playerName} on the ${team}.

Return ONLY a valid JSON object matching this schema (no markdown code blocks, pure JSON):
{
  "headline": "Short kicker headline (max 12 words)",
  "summary": "2-3 concise sentences detailing their leg range, indoor stadium factors, offensive scoring environment, and job security.",
  "injuryStatus": "Healthy" | "Minor / Probable" | "Questionable" | "Out / IR",
  "draftSentiment": "RISING" | "FALLING" | "NEUTRAL",
  "auctionAdvice": "One actionable tactical sentence on how to price this kicker in a $200 auction draft ($1-$3 range).",
  "source": "Primary news source or reporter name",
  "confidence": "HIGH" | "MEDIUM"
}
`;
    } else {
      prompt = `
You are a real-time fantasy football beat reporter and high-stakes auction draft analyst.
Search for the most recent news, injury updates, practice reports, depth chart developments, and preseason buzz for NFL player: ${playerName} (${pos}, ${team}).

Return ONLY a valid JSON object matching this schema (no markdown code blocks, pure JSON):
{
  "headline": "Short breaking news headline (max 12 words)",
  "summary": "2-3 concise sentences detailing their current health, training camp performance, snap volume, or target share outlook.",
  "injuryStatus": "Healthy" | "Minor / Probable" | "Questionable" | "Elevated Risk" | "Out / IR",
  "draftSentiment": "RISING" | "FALLING" | "NEUTRAL",
  "auctionAdvice": "One actionable tactical sentence on how to price this player in a 12-team 0.5 PPR $200 auction cap draft.",
  "source": "Primary news source or reporter name",
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
