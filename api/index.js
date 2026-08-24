import crypto from 'crypto';

const ALLOWED_EMAILS = new Set(['jaffadan@gmail.com', 'tracy734g@gmail.com']);
const AUTH_SECRET = process.env.AUTH_SECRET || 'fantasy-2026-draft-auth-secret-key-12345';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '816919087026-400mjujbr7cklrmbulggu1jhf0jf03o5.apps.googleusercontent.com';

function parseCookies(req) {
  const list = {};
  const rc = req.headers?.cookie || req.headers?.Cookie;
  if (!rc) return list;
  rc.split(';').forEach(cookie => {
    const parts = cookie.split('=');
    const key = parts.shift().trim();
    list[key] = decodeURIComponent(parts.join('='));
  });
  return list;
}

function createSessionToken(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', AUTH_SECRET).update(data).digest('base64url');
  return `${data}.${signature}`;
}

function verifySessionToken(token) {
  if (!token || typeof token !== 'string') return null;
  const [data, signature] = token.split('.');
  if (!data || !signature) return null;
  const expectedSignature = crypto.createHmac('sha256', AUTH_SECRET).update(data).digest('base64url');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
      return null;
    }
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

function getAuthenticatedUser(req) {
  const cookies = parseCookies(req);
  const token = cookies.auth_session;
  if (!token) return null;
  const user = verifySessionToken(token);
  if (user && user.email && ALLOWED_EMAILS.has(user.email.toLowerCase())) {
    return user;
  }
  return null;
}

function readRequestBody(req) {
  return new Promise((resolve) => {
    if (req.body && typeof req.body === 'object') {
      return resolve(req.body);
    }
    if (req.body && typeof req.body === 'string') {
      try {
        return resolve(JSON.parse(req.body));
      } catch (e) {
        return resolve({});
      }
    }
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

export default async function handler(req, res) {
  const url = req.url || '';

  // CORS Pre-flight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    res.end();
    return;
  }

  // 1. Auth Config
  if (url.includes('/api/auth/config')) {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({
      success: true,
      googleClientId: GOOGLE_CLIENT_ID,
      allowedEmails: Array.from(ALLOWED_EMAILS)
    }));
    return;
  }

  // 2. Auth Session Check
  if (url.includes('/api/auth/me')) {
    const user = getAuthenticatedUser(req);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      authenticated: Boolean(user),
      user: user ? { email: user.email, name: user.name, picture: user.picture } : null
    }));
    return;
  }

  // 3. Google OAuth Verification & Login
  if (url.includes('/api/auth/google') && req.method === 'POST') {
    try {
      const body = await readRequestBody(req);
      const credential = body.credential;
      if (!credential) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'NO_CREDENTIAL' }));
        return;
      }

      const gRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
      if (!gRes.ok) {
        const errText = await gRes.text();
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'INVALID_GOOGLE_TOKEN', details: errText }));
        return;
      }

      const gPayload = await gRes.json();
      const email = (gPayload.email || '').toLowerCase().trim();
      const name = gPayload.name || email.split('@')[0];
      const picture = gPayload.picture || '';

      if (!ALLOWED_EMAILS.has(email)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: 'UNAUTHORIZED_EMAIL',
          message: `Access denied. ${email} is not authorized to access this draft room.`
        }));
        return;
      }

      const sessionPayload = {
        email,
        name,
        picture,
        exp: Date.now() + 30 * 24 * 60 * 60 * 1000
      };
      const sessionToken = createSessionToken(sessionPayload);

      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': `auth_session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}`
      });
      res.end(JSON.stringify({ success: true, user: { email, name, picture } }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: e.message }));
    }
    return;
  }

  // 4. Logout
  if (url.includes('/api/auth/logout')) {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': 'auth_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'
    });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  // 5. Google Sheets Proxy
  if (url.includes('/api/sync-sheet')) {
    try {
      const sheetId = "1FHfpcyKwtGxmAhxD_e0qSfdEPtteVP-Ahb8B56nzxVQ";
      const mainRes = await fetch(`https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=2026127503`);
      const rookieRes = await fetch(`https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=1188258304`);

      const mainCsv = await mainRes.text();
      const rookieCsv = await rookieRes.text();

      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ success: true, mainCsv, rookieCsv }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ success: false, error: e.message }));
    }
    return;
  }

  // 6. Gemini Player News
  if (url.includes('/api/player-news')) {
    try {
      const urlObj = new URL(url, 'http://localhost');
      const playerName = urlObj.searchParams.get('player');
      const pos = urlObj.searchParams.get('pos') || '';
      const team = urlObj.searchParams.get('team') || '';
      const apiKey = urlObj.searchParams.get('apiKey') || process.env.GEMINI_API_KEY;

      if (!apiKey) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: false, error: 'NO_API_KEY' }));
        return;
      }

      const prompt = `
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
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
}
