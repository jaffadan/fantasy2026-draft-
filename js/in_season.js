// In-Season Intelligence & CBS Fantasy Assistant Engine
export class InSeasonModule {
  constructor(app) {
    this.app = app;
    this.leagueData = null;
    this.strategyMode = 'balanced'; // 'floor' | 'balanced' | 'ceiling'
    this.freeAgentFilter = 'ALL';
    this.freeAgentSearch = '';
    this.isSyncing = false;
    this.cbsStatus = { hasSession: false, hasData: false, playwrightReady: true, lastSynced: null };
  }

  async init() {
    await this.fetchStatus();
    await this.loadLeagueData();
  }

  async fetchStatus() {
    try {
      const res = await fetch('/api/cbs/status');
      if (res.ok) {
        this.cbsStatus = await res.json();
      }
    } catch (e) {
      console.warn('Could not fetch CBS API status:', e);
    }
  }

  async loadLeagueData() {
    try {
      const res = await fetch('/api/cbs/data');
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data) {
          this.leagueData = json.data;
          this.recalculateMatchupContext();
          return;
        }
      }
    } catch (e) {
      console.warn('Could not load from API, trying local fallback:', e);
    }

    try {
      const resFallback = await fetch('data/cbs_league_data.json');
      if (resFallback.ok) {
        this.leagueData = await resFallback.json();
        this.recalculateMatchupContext();
      }
    } catch (e2) {
      console.error('Failed to load CBS league data:', e2);
    }
  }

  recalculateMatchupContext() {
    if (!this.leagueData || !this.leagueData.my_team || !this.leagueData.matchup) return;
    
    // Calculate current starting lineup projected total
    const myStarters = this.leagueData.my_team.roster.filter(p => p.is_starter);
    const myTotal = myStarters.reduce((acc, p) => acc + (Number(p.cbs_proj) || 0), 0);
    const oppTotal = Number(this.leagueData.matchup.opponent_projected_total) || 110.0;
    const spread = myTotal - oppTotal;

    this.leagueData.matchup.my_projected_total = Number(myTotal.toFixed(1));
    this.leagueData.matchup.projected_spread = (spread >= 0 ? '+' : '') + spread.toFixed(1);

    // Compute Win Probability
    const winProb = Math.min(99, Math.max(1, Math.round(50 + (spread * 1.5))));
    this.leagueData.matchup.win_probability = winProb + '%';

    // Determine Strategic Posture
    if (spread >= 15) {
      this.leagueData.matchup.matchup_posture = 'HEAVY_FAVORITE';
      this.leagueData.matchup.posture_summary = 'Favored by ' + spread.toFixed(1) + ' pts (' + winProb + '% win prob). Play safe floor starters. Preserve your $100 FAAB and hold high-upside bench stashes (do not drop for 1-week streamers).';
    } else if (spread >= 5) {
      this.leagueData.matchup.matchup_posture = 'MODERATE_FAVORITE';
      this.leagueData.matchup.posture_summary = 'Favored by ' + spread.toFixed(1) + ' pts (' + winProb + '% win prob). Solid position; start optimal consensus projections. Consider low-cost FAAB bids for long-term upgrades.';
    } else if (spread >= -5) {
      this.leagueData.matchup.matchup_posture = 'TOSS_UP';
      this.leagueData.matchup.posture_summary = 'Toss-up dogfight (' + spread.toFixed(1) + ' spread, ' + winProb + '% win prob). Maximize expected value across all 9 starter slots. Targeted waiver pickups recommended.';
    } else {
      this.leagueData.matchup.matchup_posture = 'UNDERDOG';
      this.leagueData.matchup.posture_summary = 'Underdog by ' + Math.abs(spread).toFixed(1) + ' pts (' + winProb + '% win prob). Switch to CEILING MODE to chase big-play distance bonus upside (+0.5 to +4.5 pt TD bonuses).';
    }
  }

  // --- START / SIT OPTIMIZER ---
  getOptimizedLineup(mode = this.strategyMode) {
    if (!this.leagueData || !this.leagueData.my_team) return null;
    const allPlayers = [...this.leagueData.my_team.roster];

    // Score metric based on selected mode
    const getScore = (p) => {
      const base = Number(p.cbs_proj) || 0;
      const floor = Number(p.floor_proj) || (base * 0.7);
      const ceiling = Number(p.ceiling_proj) || (base * 1.35);

      if (mode === 'floor') return (floor * 0.7) + (base * 0.3);
      if (mode === 'ceiling') return (ceiling * 0.65) + (base * 0.35);
      return base; // balanced
    };

    // Filter available by position (exclude Out / IR)
    const available = allPlayers.filter(p => !p.status || !p.status.toLowerCase().includes('out'));

    const qbs = available.filter(p => p.position === 'QB').sort((a, b) => getScore(b) - getScore(a));
    const rbs = available.filter(p => p.position === 'RB').sort((a, b) => getScore(b) - getScore(a));
    const wrs = available.filter(p => p.position === 'WR').sort((a, b) => getScore(b) - getScore(a));
    const tes = available.filter(p => p.position === 'TE').sort((a, b) => getScore(b) - getScore(a));
    const ks = available.filter(p => p.position === 'K').sort((a, b) => getScore(b) - getScore(a));
    const dsts = available.filter(p => p.position === 'DST').sort((a, b) => getScore(b) - getScore(a));

    const optimalStarters = [];
    const usedIds = new Set();

    // 1 QB
    if (qbs[0]) { optimalStarters.push({ ...qbs[0], targetSlot: 'QB' }); usedIds.add(qbs[0].id); }
    // 2 RBs
    rbs.slice(0, 2).forEach((p, i) => { optimalStarters.push({ ...p, targetSlot: 'RB' + (i + 1) }); usedIds.add(p.id); });
    // 2 WRs
    wrs.slice(0, 2).forEach((p, i) => { optimalStarters.push({ ...p, targetSlot: 'WR' + (i + 1) }); usedIds.add(p.id); });

    // 2 Flex (RB, WR, TE)
    const flexPool = available.filter(p => !usedIds.has(p.id) && ['RB', 'WR', 'TE'].includes(p.position))
                             .sort((a, b) => getScore(b) - getScore(a));
    flexPool.slice(0, 2).forEach((p, i) => { optimalStarters.push({ ...p, targetSlot: 'FLEX' + (i + 1) }); usedIds.add(p.id); });

    // 1 K
    if (ks[0]) { optimalStarters.push({ ...ks[0], targetSlot: 'K' }); usedIds.add(ks[0].id); }
    // 1 DST
    if (dsts[0]) { optimalStarters.push({ ...dsts[0], targetSlot: 'DST' }); usedIds.add(dsts[0].id); }

    const optimalTotal = optimalStarters.reduce((acc, p) => acc + (Number(p.cbs_proj) || 0), 0);
    const currentTotal = this.leagueData.my_team.roster.filter(p => p.is_starter)
                                                      .reduce((acc, p) => acc + (Number(p.cbs_proj) || 0), 0);

    return {
      starters: optimalStarters,
      optimalTotal: Number(optimalTotal.toFixed(1)),
      currentTotal: Number(currentTotal.toFixed(1)),
      pointDiff: Number((optimalTotal - currentTotal).toFixed(1))
    };
  }

  // --- DROP CANDIDATES ANALYZER ---
  getBenchDropAnalysis() {
    if (!this.leagueData || !this.leagueData.my_team) return [];
    const bench = this.leagueData.my_team.roster.filter(p => !p.is_starter);

    return bench.map(p => {
      let dropStatus = 'HOLD';
      let reason = 'Solid depth';

      const notes = (p.notes || '').toLowerCase();
      const isRookie = notes.includes('rookie') || notes.includes('stash');
      const status = (p.status || '').toLowerCase();
      const isInjured = status.includes('out') || status.includes('pup');
      const proj = Number(p.cbs_proj) || 0;

      if (isInjured) {
        dropStatus = 'IR_STASH';
        reason = 'High-upside IR stash. Do NOT drop.';
      } else if (isRookie && proj > 8) {
        dropStatus = 'UNTOUCHABLE_STASH';
        reason = 'High-ceiling rookie target funnel. Untouchable stash.';
      } else if (proj < 6.0) {
        dropStatus = 'SAFE_DROP';
        reason = 'Low snap share / minimal ceiling. Primary drop candidate for priority waiver adds.';
      } else if (p.position === 'QB' && this.leagueData.my_team.roster.some(r => r.position === 'QB' && r.is_starter && r.cbs_proj > 20)) {
        dropStatus = 'TRADE_OR_HOLD';
        reason = 'High-value backup QB. Great trade bait or luxury backup.';
      }

      return {
        ...p,
        dropStatus,
        reason
      };
    }).sort((a, b) => (a.dropStatus === 'SAFE_DROP' ? -1 : 1));
  }

  // --- SYNC ACTIONS ---
  async triggerLiveSync() {
    const isCloud = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';
    if (isCloud) {
      alert("⚡ Live CBS Browser Scraping runs directly on your computer.\n\nTo sync live CBS data:\n1. On your computer, double-click 'sync_cbs.bat' (or run start.bat)\n2. It will scrape fresh rosters, matchups, and waivers and update your dashboard.");
      return;
    }

    this.isSyncing = true;
    this.render();

    try {
      const res = await fetch('/api/cbs/sync', { method: 'POST' });
      const json = await res.json();
      if (json.success && json.data) {
        this.leagueData = json.data;
        this.recalculateMatchupContext();
        if (this.app) this.app.showToast('✅ CBS Sports League Data successfully synced!', 'success');
      } else {
        if (this.app) this.app.showToast('⚠️ Synced with existing local cache. Use CBS Login to refresh session.', 'warning');
      }
    } catch (e) {
      if (this.app) this.app.showToast('❌ Sync failed: ' + e.message, 'error');
    } finally {
      this.isSyncing = false;
      await this.fetchStatus();
      this.render();
    }
  }

  async launchInteractiveLogin() {
    const isCloud = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';
    if (isCloud) {
      alert("🌐 CBS Login Setup:\n\nBecause you are viewing the app on Vercel Cloud, cloud servers cannot open a browser on your personal computer.\n\nTo log in once and save your session:\n1. In your local project folder on your PC, double-click 'login_cbs.bat'\n2. A Chromium browser window will open for you to log into CBS\n3. Close the browser when done!");
      return;
    }

    try {
      const res = await fetch('/api/cbs/login', { method: 'POST' });
      const json = await res.json();
      if (json.success) {
        if (this.app) this.app.showToast('🌐 Browser opened. Complete CBS login in the browser window!', 'info');
      }
    } catch (e) {
      if (this.app) this.app.showToast('❌ Failed to launch browser: ' + e.message, 'error');
    }
  }

  setStrategyMode(mode) {
    this.strategyMode = mode;
    this.render();
  }

  setPosFilter(pos) {
    this.freeAgentFilter = pos;
    this.render();
  }

  handleSearchInput(query) {
    this.freeAgentSearch = query.toLowerCase().trim();
    this.renderFreeAgents();
  }

  // --- MAIN RENDER FUNCTION ---
  render() {
    if (!this.leagueData) return;

    this.renderHeaderStatus();
    this.renderScoreboard();
    this.renderVulnerabilities();
    this.renderStartersGrid();
    this.renderFreeAgents();
    this.renderBenchDropList();

    if (window.lucide) {
      window.lucide.createIcons();
    }
  }

  renderHeaderStatus() {
    const dot = document.getElementById('cbs-sync-dot');
    const ping = document.getElementById('cbs-sync-ping');
    const statusText = document.getElementById('cbs-status-text');
    const lastSyncedText = document.getElementById('cbs-last-synced-text');
    const syncIcon = document.getElementById('cbs-sync-icon');

    if (this.isSyncing) {
      if (syncIcon) syncIcon.classList.add('animate-spin');
      if (statusText) statusText.textContent = 'CBS: Syncing...';
      if (dot) dot.className = 'relative inline-flex rounded-full h-2 w-2 bg-amber-500';
      if (ping) ping.classList.remove('hidden');
    } else {
      if (syncIcon) syncIcon.classList.remove('animate-spin');
      if (statusText) statusText.textContent = this.cbsStatus.hasSession ? 'CBS: Live Session Connected' : 'CBS: Ready / Local Mode';
      if (dot) dot.className = 'relative inline-flex rounded-full h-2 w-2 bg-emerald-500';
      if (ping) ping.classList.remove('hidden');
      if (lastSyncedText && this.leagueData.league_info && this.leagueData.league_info.last_synced) {
        const d = new Date(this.leagueData.league_info.last_synced);
        lastSyncedText.textContent = 'Synced: ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }
    }
  }

  renderScoreboard() {
    const m = this.leagueData.matchup;
    if (!m) return;

    const myTeamName = document.getElementById('matchup-my-team-name');
    const oppTeamName = document.getElementById('matchup-opp-team-name');
    const myProj = document.getElementById('matchup-my-proj');
    const oppProj = document.getElementById('matchup-opp-proj');
    const headerTitle = document.getElementById('matchup-header-title');
    const winBadge = document.getElementById('matchup-win-prob-badge');
    const postureCard = document.getElementById('matchup-posture-card');
    const postureBadge = document.getElementById('matchup-posture-badge');
    const postureText = document.getElementById('matchup-posture-text');

    const myName = (this.leagueData.my_team && this.leagueData.my_team.team_name) || 'DCFC';
    const oppName = m.opponent_team_name || 'Gridiron Gurus';

    if (myTeamName) myTeamName.textContent = myName;
    if (oppTeamName) oppTeamName.textContent = oppName;
    if (myProj) myProj.textContent = Number(m.my_projected_total).toFixed(1);
    if (oppProj) oppProj.textContent = Number(m.opponent_projected_total).toFixed(1);
    if (headerTitle) headerTitle.textContent = myName + ' vs ' + oppName;
    if (winBadge) winBadge.textContent = m.win_probability + ' Win Prob (' + m.projected_spread + ' pts)';

    if (postureBadge) {
      if (m.matchup_posture === 'HEAVY_FAVORITE') {
        postureBadge.className = 'px-2 py-0.5 rounded text-[10px] font-extrabold bg-emerald-500/30 text-emerald-200 uppercase tracking-wide border border-emerald-500/50';
        postureBadge.textContent = '🛡️ Tactical Posture: Heavy Favorite (' + m.projected_spread + ')';
        if (postureCard) postureCard.className = 'p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-500/40 space-y-1.5';
      } else if (m.matchup_posture === 'UNDERDOG') {
        postureBadge.className = 'px-2 py-0.5 rounded text-[10px] font-extrabold bg-rose-500/30 text-rose-200 uppercase tracking-wide border border-rose-500/50';
        postureBadge.textContent = '⚡ Tactical Posture: Underdog (' + m.projected_spread + ') - High Ceiling Focus';
        if (postureCard) postureCard.className = 'p-3.5 rounded-xl bg-rose-950/40 border border-rose-500/40 space-y-1.5';
      } else {
        postureBadge.className = 'px-2 py-0.5 rounded text-[10px] font-extrabold bg-blue-500/30 text-blue-200 uppercase tracking-wide border border-blue-500/50';
        postureBadge.textContent = '⚔️ Tactical Posture: Dogfight Toss-Up (' + m.projected_spread + ')';
        if (postureCard) postureCard.className = 'p-3.5 rounded-xl bg-blue-950/40 border border-blue-500/40 space-y-1.5';
      }
    }

    if (postureText) postureText.textContent = m.posture_summary;
  }

  renderVulnerabilities() {
    const list = document.getElementById('opponent-vulnerabilities-list');
    const blockText = document.getElementById('defensive-block-text');
    if (!list) return;

    const m = this.leagueData.matchup;
    if (!m || !m.opponent_vulnerabilities) {
      list.innerHTML = '<div class="text-xs text-slate-500">No vulnerabilities detected.</div>';
      return;
    }

    list.innerHTML = m.opponent_vulnerabilities.map(v => {
      const badgeCls = v.severity === 'HIGH' ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30' : 'bg-amber-500/20 text-amber-300 border border-amber-500/30';
      return '<div class="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800 flex items-start gap-2">' +
        '<span class="px-1.5 py-0.5 rounded text-[9px] font-bold ' + badgeCls + '">' + v.position + ' [' + v.severity + ']</span>' +
        '<p class="text-xs text-slate-300 flex-1 leading-snug">' + v.detail + '</p>' +
      '</div>';
    }).join('');

    if (blockText && m.defensive_blocking_opportunities && m.defensive_blocking_opportunities[0]) {
      const block = m.defensive_blocking_opportunities[0];
      blockText.innerHTML = 'Opponent vulnerable at <b>' + block.position + '</b>. ' + block.reason;
    }
  }

  renderStartersGrid() {
    const grid = document.getElementById('in-season-starters-grid');
    if (!grid) return;

    const btnFloor = document.getElementById('btn-mode-floor');
    const btnBalanced = document.getElementById('btn-mode-balanced');
    const btnCeiling = document.getElementById('btn-mode-ceiling');

    [btnFloor, btnBalanced, btnCeiling].forEach(b => {
      if (b) b.className = 'px-2.5 py-1 rounded-lg text-xs font-bold text-slate-400 hover:text-white transition-all';
    });

    if (this.strategyMode === 'floor' && btnFloor) {
      btnFloor.className = 'px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-600 text-white shadow-sm transition-all';
    } else if (this.strategyMode === 'ceiling' && btnCeiling) {
      btnCeiling.className = 'px-2.5 py-1 rounded-lg text-xs font-bold bg-purple-600 text-white shadow-sm transition-all';
    } else if (btnBalanced) {
      btnBalanced.className = 'px-2.5 py-1 rounded-lg text-xs font-bold bg-blue-600 text-white shadow-sm transition-all';
    }

    const opt = this.getOptimizedLineup(this.strategyMode);
    if (!opt || !opt.starters) return;

    const optTotalEl = document.getElementById('opt-lineup-total');
    const currTotalEl = document.getElementById('curr-lineup-total');
    if (optTotalEl) optTotalEl.textContent = opt.optimalTotal + ' pts';
    if (currTotalEl) currTotalEl.textContent = opt.currentTotal + ' pts';

    const posColors = {
      QB: 'border-red-500/40 bg-red-950/20 text-red-400',
      RB1: 'border-emerald-500/40 bg-emerald-950/20 text-emerald-400',
      RB2: 'border-emerald-500/40 bg-emerald-950/20 text-emerald-400',
      WR1: 'border-blue-500/40 bg-blue-950/20 text-blue-400',
      WR2: 'border-blue-500/40 bg-blue-950/20 text-blue-400',
      FLEX1: 'border-pink-500/40 bg-pink-950/20 text-pink-400',
      FLEX2: 'border-pink-500/40 bg-pink-950/20 text-pink-400',
      K: 'border-amber-500/40 bg-amber-950/20 text-amber-400',
      DST: 'border-slate-500/40 bg-slate-800/40 text-slate-300'
    };

    grid.innerHTML = opt.starters.map(p => {
      const colorClass = posColors[p.targetSlot] || 'border-slate-700 bg-slate-900 text-slate-300';
      const isBonusHigh = ['Extreme', 'Very High', 'High'].includes(p.distance_bonus_upside);
      const opp = p.opponent || '';
      const injuryHtml = (p.status && p.status !== 'Healthy') ? '<span class="text-rose-400 font-bold font-mono">' + p.status + '</span>' : '';
      const bonusHtml = isBonusHigh ? '<span class="text-[9px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-bold" title="High Big-Play Distance Bonus Upside">⚡ Bonus Up</span>' : '';

      return '<div class="p-3 rounded-xl border ' + colorClass + ' bg-slate-900/80 shadow-md relative flex flex-col justify-between gap-2 hover:border-slate-500 transition-all">' +
        '<div class="flex items-center justify-between">' +
          '<span class="font-black text-[10px] px-1.5 py-0.5 rounded bg-slate-950/80 font-mono tracking-wider">' + p.targetSlot + '</span>' +
          '<span class="text-[10px] text-slate-400 font-mono">' + opp + '</span>' +
        '</div>' +
        '<div>' +
          '<div class="font-extrabold text-xs text-white truncate">' + p.name + '</div>' +
          '<div class="text-[10px] text-slate-400 flex items-center gap-1.5 mt-0.5">' +
            '<span class="font-semibold text-slate-300">' + p.position + ' • ' + p.nfl_team + '</span>' +
            injuryHtml +
          '</div>' +
        '</div>' +
        '<div class="flex items-end justify-between pt-1 border-t border-slate-800/80">' +
          '<div>' +
            '<div class="text-[9px] text-slate-500 uppercase font-semibold">Projected</div>' +
            '<div class="text-sm font-black font-mono text-emerald-400">' + p.cbs_proj + ' <span class="text-[10px] font-normal text-slate-400">pts</span></div>' +
          '</div>' +
          bonusHtml +
        '</div>' +
      '</div>';
    }).join('');
  }

  renderFreeAgents() {
    const tbody = document.getElementById('in-season-fa-tbody');
    if (!tbody || !this.leagueData || !this.leagueData.free_agents) return;

    let list = [...this.leagueData.free_agents];

    if (this.freeAgentFilter !== 'ALL') {
      list = list.filter(p => p.position === this.freeAgentFilter);
    }

    if (this.freeAgentSearch) {
      list = list.filter(p => 
        p.name.toLowerCase().includes(this.freeAgentSearch) || 
        p.nfl_team.toLowerCase().includes(this.freeAgentSearch) ||
        p.position.toLowerCase().includes(this.freeAgentSearch)
      );
    }

    const btns = document.querySelectorAll('.in-season-filter-btn');
    btns.forEach(b => {
      const pos = b.textContent.trim();
      if (pos === this.freeAgentFilter) {
        b.className = 'in-season-filter-btn active px-2 py-0.5 rounded-lg font-bold bg-emerald-600 text-white text-[11px]';
      } else {
        b.className = 'in-season-filter-btn px-2 py-0.5 rounded-lg text-slate-400 hover:text-white text-[11px]';
      }
    });

    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="p-4 text-center text-slate-500">No matching free agents found.</td></tr>';
      return;
    }

    tbody.innerHTML = list.map(p => {
      const urgencyClass = p.urgency === 'HIGH' ? 'bg-rose-500/20 text-rose-300 border-rose-500/30' :
                           p.urgency === 'MEDIUM' ? 'bg-amber-500/20 text-amber-300 border-amber-500/30' :
                           'bg-slate-800 text-slate-400 border-slate-700';

      const snapBadge = p.snap_spike ? '<span class="px-1 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 text-[9px] font-bold">Snap 📈</span>' : '';
      const targetBadge = p.target_spike ? '<span class="px-1 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[9px] font-bold">Target 🎯</span>' : '';

      return '<tr class="hover:bg-slate-800/40 transition-colors">' +
        '<td class="p-2.5 font-bold text-white flex items-center gap-1.5">' +
          '<span>' + p.name + '</span>' +
          snapBadge +
          targetBadge +
        '</td>' +
        '<td class="p-2.5 font-mono text-slate-300"><span class="font-bold">' + p.position + '</span> • ' + p.nfl_team + '</td>' +
        '<td class="p-2.5 font-mono text-slate-300">' + p.rostered_pct + '</td>' +
        '<td class="p-2.5 font-mono text-emerald-400 font-bold">' + p.trend + '</td>' +
        '<td class="p-2.5 font-mono text-slate-100 font-bold">' + p.cbs_proj + '</td>' +
        '<td class="p-2.5 font-mono text-amber-300 font-black">' + p.recommended_faab + ' <span class="text-[9px] text-slate-400">(' + p.recommended_faab_pct + ')</span></td>' +
        '<td class="p-2.5"><span class="px-1.5 py-0.5 rounded text-[9px] font-extrabold border ' + urgencyClass + '">' + p.urgency + '</span></td>' +
        '<td class="p-2.5 text-[11px] text-slate-400 max-w-xs truncate" title="' + (p.scouting_summary || '') + '">' + (p.scouting_summary || '') + '</td>' +
      '</tr>';
    }).join('');
  }

  renderBenchDropList() {
    const list = document.getElementById('in-season-bench-drop-list');
    if (!list) return;

    const benchAnalysis = this.getBenchDropAnalysis();
    if (!benchAnalysis || benchAnalysis.length === 0) {
      list.innerHTML = '<div class="text-xs text-slate-500">No bench players found.</div>';
      return;
    }

    list.innerHTML = benchAnalysis.map(p => {
      let badgeClass = 'bg-slate-800 text-slate-300 border-slate-700';
      let badgeText = 'HOLD';

      if (p.dropStatus === 'SAFE_DROP') {
        badgeClass = 'bg-rose-500/20 text-rose-300 border-rose-500/40 font-black animate-pulse';
        badgeText = '✂️ PRIMARY CUT';
      } else if (p.dropStatus === 'UNTOUCHABLE_STASH') {
        badgeClass = 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40 font-bold';
        badgeText = '💎 UNTOUCHABLE';
      } else if (p.dropStatus === 'IR_STASH') {
        badgeClass = 'bg-amber-500/20 text-amber-300 border-amber-500/40 font-bold';
        badgeText = '🏥 IR STASH';
      }

      return '<div class="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800/80 flex items-center justify-between gap-2">' +
        '<div>' +
          '<div class="font-bold text-xs text-white flex items-center gap-1.5">' +
            '<span>' + p.name + '</span>' +
            '<span class="text-[10px] text-slate-400 font-normal font-mono">(' + p.position + ' • ' + p.nfl_team + ')</span>' +
          '</div>' +
          '<div class="text-[10px] text-slate-400 mt-0.5 leading-snug">' + p.reason + '</div>' +
        '</div>' +
        '<span class="px-2 py-1 rounded-lg text-[10px] border shrink-0 ' + badgeClass + '">' + badgeText + '</span>' +
      '</div>';
    }).join('');
  }
}
