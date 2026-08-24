/**
 * Gemini Live Player Intelligence & Breaking News Module
 * Uses Google Gemini (gemini-2.5-flash / gemini-3.7-flash) with Google Search grounding
 * to fetch real-time injury news, camp reports, and draft stock alerts.
 */

const GEMINI_API_KEY_STORAGE = 'fantasy_draft_gemini_api_key';
const AI_PROVIDER_STORAGE = 'fantasy_draft_ai_provider'; // 'gemini' or 'local'
const LOCAL_AI_URL_STORAGE = 'fantasy_draft_local_ai_url'; // default 'http://localhost:11434'
const LOCAL_AI_MODEL_STORAGE = 'fantasy_draft_local_ai_model'; // default 'llama3.2'
const NEWS_CACHE_STORAGE = 'fantasy_draft_gemini_news_cache_v1';

export class GeminiNewsService {
  constructor() {
    this.provider = localStorage.getItem(AI_PROVIDER_STORAGE) || 'gemini';
    this.apiKey = localStorage.getItem(GEMINI_API_KEY_STORAGE) || '';
    this.localUrl = localStorage.getItem(LOCAL_AI_URL_STORAGE) || 'http://localhost:11434';
    this.localModel = localStorage.getItem(LOCAL_AI_MODEL_STORAGE) || 'llama3.2:1b';
    this.cache = this.loadCache();
    this.model = 'gemini-3.7-flash';
    this.fallbackModel = 'gemini-3.7-flash';
    this.consecutiveFailures = 0;
    this.maxFailures = 3;
    this.isCircuitBroken = false;
    this.attemptedPlayerIds = new Set();

    // Background High-Speed Parallel Pre-fetching Engine
    this.isPrefetching = false;
    this.prefetchQueue = [];
    this.prefetchWorkersCount = 5; // 5 concurrent parallel workers
    this.activeWorkers = 0;
    this.onProgressCallback = null;
    this.activityLog = []; // Live stream of AI pulls
    this.latencies = [];
  }

  logActivity(entry) {
    this.activityLog.unshift(entry);
    if (this.activityLog.length > 150) this.activityLog.pop();
    if (entry.latencyMs) {
      this.latencies.push(entry.latencyMs);
      if (this.latencies.length > 50) this.latencies.shift();
    }
  }

  getAvgLatency() {
    if (this.latencies.length === 0) return 650;
    const sum = this.latencies.reduce((a, b) => a + b, 0);
    return Math.round(sum / this.latencies.length);
  }

  clearCache() {
    this.cache = {};
    this.activityLog = [];
    localStorage.removeItem(NEWS_CACHE_STORAGE);
    this.resetFailures();
  }

  onProgress(callback) {
    this.onProgressCallback = callback;
  }

  getPreloadedCount(totalPlayers = 310) {
    const cachedCount = Object.keys(this.cache).length;
    return {
      cached: cachedCount,
      total: totalPlayers,
      percentage: Math.min(100, Math.round((cachedCount / totalPlayers) * 100))
    };
  }

  /**
   * Start high-speed parallel background pre-warming (5 parallel workers)
   */
  startBackgroundPrefetch(players, priorityFirst = true) {
    if (!this.isConfigured() || this.isCircuitBroken) return;

    // Filter undrafted players that aren't already cached
    const uncached = players.filter(p => !p.drafted && !this.cache[p.id]);

    if (uncached.length === 0) {
      if (this.onProgressCallback) this.onProgressCallback(this.getPreloadedCount(players.length));
      return;
    }

    // Sort queue: Starred first, then by rank 1 -> end
    if (priorityFirst) {
      this.prefetchQueue = [...uncached].sort((a, b) => {
        if (a.isStarred && !b.isStarred) return -1;
        if (!a.isStarred && b.isStarred) return 1;
        return (a.rank || 999) - (b.rank || 999);
      });
    } else {
      this.prefetchQueue = [...uncached];
    }

    if (this.isPrefetching) return;
    this.isPrefetching = true;

    // Concurrency: 2 workers for local (Ollama serializes internally), 3 for Gemini
    const concurrency = this.provider === 'local' ? 2 : 3;

    for (let i = 0; i < concurrency; i++) {
      this.spawnWorker(players.length, i * 250); // slight stagger for initial burst
    }
  }

  pausePrefetch() {
    this.isPrefetching = false;
  }

  resumePrefetch(players) {
    this.startBackgroundPrefetch(players);
  }

  async spawnWorker(totalPlayersCount, startDelay = 0) {
    if (startDelay > 0) {
      await new Promise(r => setTimeout(r, startDelay));
    }

    const workerId = this.activeWorkers;
    this.activeWorkers++;
    console.log(`[Worker ${workerId}] Started. Queue size: ${this.prefetchQueue.length}`);

    while (this.isPrefetching && !this.isCircuitBroken && this.prefetchQueue.length > 0) {
      const player = this.prefetchQueue.shift();
      if (!player) break;

      if (!this.cache[player.id]) {
        try {
          const startMs = performance.now();
          await this.fetchPlayerNews(player, false);
          const elapsed = Math.round(performance.now() - startMs);
          console.log(`[Worker ${workerId}] ✅ ${player.name} (${player.pos}) - ${elapsed}ms`);
        } catch (e) {
          console.warn(`[Worker ${workerId}] ❌ Skipped ${player.name}: ${e.message}`);
          // Don't break—keep going with the next player unless circuit is broken
          if (this.isCircuitBroken) {
            console.warn(`[Worker ${workerId}] Circuit breaker tripped! Stopping.`);
            break;
          }
        }
      }

      if (this.onProgressCallback) {
        this.onProgressCallback(this.getPreloadedCount(totalPlayersCount));
      }

      // Minimal inter-request gap per worker (100ms for local, 600ms for Gemini)
      const perWorkerGap = this.provider === 'local' ? 100 : 600;
      await new Promise(r => setTimeout(r, perWorkerGap));
    }

    this.activeWorkers--;
    console.log(`[Worker ${workerId}] Finished. Active workers remaining: ${this.activeWorkers}. Circuit: ${this.isCircuitBroken ? 'BROKEN' : 'OK'}`);
    if (this.activeWorkers === 0) {
      this.isPrefetching = false;
      if (this.onProgressCallback) {
        this.onProgressCallback(this.getPreloadedCount(totalPlayersCount));
      }
    }
  }

  setProvider(provider) {
    this.provider = provider;
    localStorage.setItem(AI_PROVIDER_STORAGE, provider);
    this.resetFailures();
  }

  setLocalConfig(url, model) {
    this.localUrl = (url || 'http://localhost:11434').trim().replace(/\/$/, '');
    this.localModel = (model || 'llama3.2').trim();
    localStorage.setItem(LOCAL_AI_URL_STORAGE, this.localUrl);
    localStorage.setItem(LOCAL_AI_MODEL_STORAGE, this.localModel);
    this.resetFailures();
  }

  resetFailures() {
    this.consecutiveFailures = 0;
    this.isCircuitBroken = false;
    this.attemptedPlayerIds.clear();
  }

  loadCache() {
    try {
      const saved = localStorage.getItem(NEWS_CACHE_STORAGE);
      return saved ? JSON.parse(saved) : {};
    } catch (e) {
      return {};
    }
  }

  saveCache() {
    try {
      localStorage.setItem(NEWS_CACHE_STORAGE, JSON.stringify(this.cache));
    } catch (e) {
      console.warn('Failed to save news cache', e);
    }
  }

  setApiKey(key) {
    this.apiKey = (key || '').trim();
    localStorage.setItem(GEMINI_API_KEY_STORAGE, this.apiKey);
    this.resetFailures();
  }

  getApiKey() {
    return this.apiKey;
  }

  hasApiKey() {
    return Boolean(this.apiKey && this.apiKey.length > 5);
  }

  getCachedNews(playerId) {
    const item = this.cache[playerId];
    if (!item) return null;
    // Cache valid for 30 minutes
    if (Date.now() - item.timestamp < 30 * 60 * 1000) {
      return item.data;
    }
    return null;
  }

  isConfigured() {
    if (this.provider === 'local') return true;
    return this.hasApiKey();
  }

  /**
   * Fetch breaking news & draft intel for a player with 3-failure circuit breaker
   */
  async fetchPlayerNews(player, forceRefresh = false) {
    if (!player) return null;

    if (!forceRefresh) {
      const cached = this.getCachedNews(player.id);
      if (cached) return { ...cached, isCached: true };
    }

    if (this.isCircuitBroken && !forceRefresh) {
      const err = new Error('CIRCUIT_BROKEN');
      err.failures = this.consecutiveFailures;
      throw err;
    }

    this.attemptedPlayerIds.add(player.id);
    const startTime = performance.now();

    // Route to Local Model (Ollama / LM Studio) if provider is local
    if (this.provider === 'local') {
      return await this.fetchLocalModelNews(player);
    }

    // Try backend proxy endpoint first if available, otherwise direct Gemini API
    try {
      const proxyRes = await fetch(`/api/player-news?player=${encodeURIComponent(player.name)}&pos=${player.pos}&team=${player.team}&apiKey=${encodeURIComponent(this.apiKey)}`);
      if (proxyRes.ok) {
        const json = await proxyRes.json();
        if (json.success && json.data) {
          this.consecutiveFailures = 0;
          this.isCircuitBroken = false;
          this.cache[player.id] = { timestamp: Date.now(), data: json.data };
          this.saveCache();
          return json.data;
        } else if (json.error === 'NO_API_KEY') {
          throw new Error('NO_API_KEY');
        }
      }
    } catch (e) {
      if (e.message === 'NO_API_KEY') throw e;
      console.log('Backend news proxy unavailable, attempting client direct fetch', e);
    }

    if (!this.hasApiKey()) {
      throw new Error('NO_API_KEY');
    }

    // Direct Gemini API call with Google Search Tool Grounding and multi-tier fallbacks
    const prompt = `
You are a real-time fantasy football injury expert and high-stakes auction draft analyst.
Analyze NFL player: ${player.name} (${player.pos}, ${player.team}).
PRIORITY #1: Verify player health, active injuries, training camp/practice participation status (Full, Limited, DNP), surgeries, and soft tissue injury risks (hamstring, calf, groin, knee, ankle, shoulder).

Return ONLY a valid JSON object matching this schema (no markdown code blocks, pure JSON):
{
  "headline": "Short breaking news/health headline (max 12 words)",
  "summary": "2-3 concise sentences detailing their current health/injury status, practice reps, snap volume, or target share outlook.",
  "injuryStatus": "Healthy" | "Minor / Probable" | "Questionable" | "Elevated Risk" | "Out / IR",
  "draftSentiment": "RISING" | "FALLING" | "NEUTRAL",
  "auctionAdvice": "One actionable tactical sentence on how to price this player in a 12-team 0.5 PPR $200 auction cap draft, factoring in their health risk.",
  "source": "Primary news source or reporter name (e.g. Athletic, ESPN, Team Beat Reporter)",
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
    let successfulJson = null;
    let successfulAttempt = null;

    for (const attempt of modelsToTry) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${attempt.model}:generateContent?key=${this.apiKey}`;
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: makeRequestBody(attempt.search)
        });

        if (response.ok) {
          const resJson = await response.json();
          const candidate = resJson.candidates?.[0];
          const rawText = candidate?.content?.parts?.map(p => p.text).join('') || '';

          let cleanJson = rawText.trim();
          if (cleanJson.startsWith('```json')) {
            cleanJson = cleanJson.replace(/^```json\s*/, '').replace(/\s*```$/, '');
          } else if (cleanJson.startsWith('```')) {
            cleanJson = cleanJson.replace(/^```\s*/, '').replace(/\s*```$/, '');
          }

          let parsedData;
          try {
            parsedData = JSON.parse(cleanJson);
          } catch (e) {
            parsedData = {
              headline: `${player.name} Outlook & Intel`,
              summary: rawText.slice(0, 200),
              injuryStatus: "Healthy",
              draftSentiment: "NEUTRAL",
              auctionAdvice: `Value appropriately according to your $${player.baselineVal} baseline.`,
              source: attempt.search ? "Gemini Search" : "Gemini AI Knowledge",
              confidence: "MEDIUM"
            };
          }

          if (candidate?.groundingMetadata?.groundingChunks) {
            parsedData.searchSources = candidate.groundingMetadata.groundingChunks
              .filter(c => c.web?.title && c.web?.uri)
              .map(c => ({ title: c.web.title, uri: c.web.uri }))
              .slice(0, 3);
          }

          successfulJson = parsedData;
          successfulAttempt = attempt;
          break;
        } else {
          const errText = await response.text();
          lastError = new Error(`Gemini API (${response.status}): ${errText}`);
          // If 429 (rate limit) or 404 (model not found), try next model/search config in loop
          if (response.status === 429 || response.status === 404 || response.status === 400) {
            continue;
          } else {
            break;
          }
        }
      } catch (fetchErr) {
        lastError = fetchErr;
      }
    }

    if (!successfulJson) {
      this.recordFailure();
      throw lastError || new Error("Failed to generate content from Gemini");
    }

    // Success! Reset failure counter
    this.consecutiveFailures = 0;
    this.isCircuitBroken = false;

    this.cache[player.id] = {
      timestamp: Date.now(),
      data: successfulJson
    };
    this.saveCache();

    this.logActivity({
      timestamp: new Date().toLocaleTimeString(),
      playerId: player.id,
      playerName: player.name,
      pos: player.pos,
      team: player.team,
      baselineVal: player.baselineVal,
      headline: successfulJson.headline,
      summary: successfulJson.summary,
      sentiment: successfulJson.draftSentiment,
      injuryStatus: successfulJson.injuryStatus,
      auctionAdvice: successfulJson.auctionAdvice,
      source: successfulJson.source || (successfulAttempt?.search ? 'Gemini 3.7 (Search)' : 'Gemini 3.7'),
      latencyMs: Math.round(performance.now() - startTime),
      isLive: true
    });

    return successfulJson;
  }

  /**
   * Fetch player intel using Local Model (Ollama or LM Studio)
   */
  async fetchLocalModelNews(player) {
    const startTime = performance.now();
    const prompt = `NFL Player Health & Auction Assessment: ${player.name} (${player.pos}, ${player.team}). Check injury status and practice reps. Return JSON only: {"headline":"6-10 words health headline","summary":"2 sentences on health, injury status, practice participation, and role","injuryStatus":"Healthy|Questionable|Elevated Risk|Out","draftSentiment":"RISING|FALLING|NEUTRAL","auctionAdvice":"1 sentence bid advice factoring health","source":"Local ${this.localModel}","confidence":"HIGH"}`;

    let response;
    // 1. Try Ollama native endpoint: /api/generate with timeout
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      response = await fetch(`${this.localUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.localModel,
          prompt: prompt,
          format: "json",
          stream: false
        })
      });
      clearTimeout(timeoutId);
    } catch (e) {
      // 2. If /api/generate failed, try OpenAI-compatible endpoint: /v1/chat/completions
      try {
        const controller2 = new AbortController();
        const timeoutId2 = setTimeout(() => controller2.abort(), 8000);

        response = await fetch(`${this.localUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller2.signal,
          body: JSON.stringify({
            model: this.localModel,
            messages: [{ role: "user", content: prompt }],
            temperature: 0.2
          })
        });
        clearTimeout(timeoutId2);
      } catch (err2) {
        this.recordFailure();
        throw new Error(`Cannot connect to Local Model server at ${this.localUrl} (${err2.message}). Make sure Ollama or LM Studio is running.`);
      }
    }

    if (!response.ok) {
      this.recordFailure();
      throw new Error(`Local model responded with HTTP ${response.status}`);
    }

    const resJson = await response.json();
    let rawText = '';
    if (resJson.response) {
      rawText = resJson.response; // Ollama native
    } else if (resJson.choices && resJson.choices[0]?.message?.content) {
      rawText = resJson.choices[0].message.content; // OpenAI format
    }

    let cleanJson = rawText.trim();
    if (cleanJson.startsWith('```json')) {
      cleanJson = cleanJson.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (cleanJson.startsWith('```')) {
      cleanJson = cleanJson.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    let parsedData;
    try {
      parsedData = JSON.parse(cleanJson);
    } catch (e) {
      parsedData = {
        headline: `${player.name} Local Scouting Report`,
        summary: rawText.slice(0, 200),
        injuryStatus: "Healthy",
        draftSentiment: "NEUTRAL",
        auctionAdvice: `Target at around baseline value ($${player.baselineVal}).`,
        source: `Local ${this.localModel}`,
        confidence: "HIGH"
      };
    }

    this.consecutiveFailures = 0;
    this.isCircuitBroken = false;
    this.cache[player.id] = { timestamp: Date.now(), data: parsedData };
    this.saveCache();

    this.logActivity({
      timestamp: new Date().toLocaleTimeString(),
      playerId: player.id,
      playerName: player.name,
      pos: player.pos,
      team: player.team,
      baselineVal: player.baselineVal,
      headline: parsedData.headline,
      summary: parsedData.summary,
      sentiment: parsedData.draftSentiment,
      injuryStatus: parsedData.injuryStatus,
      auctionAdvice: parsedData.auctionAdvice,
      source: `Local ${this.localModel}`,
      latencyMs: Math.round(performance.now() - startTime),
      isLive: true
    });

    return parsedData;
  }

  recordFailure() {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.maxFailures) {
      this.isCircuitBroken = true;
    }
  }
}
