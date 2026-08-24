import { DraftStore } from './state.js?v=2026.5';
import { DraftEngine } from './engine.js?v=2026.5';
import { SheetSync } from './sheets_sync.js?v=2026.5';
import { GeminiNewsService } from './gemini_news.js?v=2026.5';
import { AuthService } from './auth.js?v=2026.5';
import { FirestoreSyncService } from './firestore_sync.js?v=2026.5';
import { defaultData } from '../data/default_data.js?v=2026.5';

export class AuctionDraftApp {
  constructor() {
    this.store = new DraftStore();
    this.engine = new DraftEngine(this.store.state.rules, this.store.state.players, this.store.state.teams);
    this.sheetSync = new SheetSync(this.store);
    this.gemini = new GeminiNewsService();
    this.auth = new AuthService();
    this.sync = new FirestoreSyncService();

    this.store.setSyncService(this.sync);
    this.gemini.setSyncService(this.sync);

    this.tableSort = { column: 'rank', asc: true };
    this.quickPosFilter = 'ALL';
    this.activeModal = null;
    this.activeNominationNews = null;
    this.isLoadingNews = false;

    this.init();
  }

  init() {
    // Expose app instance globally for inline onclick handlers
    window.app = this;

    // Subscribe to state changes
    this.store.subscribe(() => {
      this.engine.players = this.store.state.players;
      this.engine.teams = this.store.state.teams;
      this.render();
    });

    this.bindEvents();
    this.updateGeminiStatusUI();

    // Register Firestore Real-Time Cloud Sync
    this.sync.onStatusChange((status) => {
      this.updateCloudSyncUI(status);
    });

    this.sync.onRemoteAction((action) => {
      const sender = action.user ? action.user.split('@')[0] : 'Partner';
      this.showToast(`⚡ ${sender}: ${action.action}`, 'info');
    });

    // Register Auth listener
    this.auth.onAuthStateChanged((isAuthenticated, user) => {
      this.handleAuthStateChange(isAuthenticated, user);
      if (this.auth.hasServerGeminiKey) {
        this.gemini.setServerKeyConfigured(true);
        this.updateGeminiStatusUI();
      }
      if (isAuthenticated && user) {
        this.sync.init(this.store, this.gemini, user);
      }
    });
    this.auth.init();

    // Register Background AI Pre-loader progress tracker
    this.gemini.onProgress((stats) => {
      this.updatePreloadUI(stats);
      if (this.store.state.activeTab === 'ai-admin') {
        this.renderAiAdmin();
      }
    });

    // Auto-start background pre-loader if AI is configured
    setTimeout(() => {
      if (this.gemini.isConfigured()) {
        this.gemini.startBackgroundPrefetch(this.store.state.players);
      }
      this.updatePreloadUI(this.gemini.getPreloadedCount(this.store.state.players.length));
    }, 1000);

    this.render();
  }

  updateCloudSyncUI(status) {
    const badge = document.getElementById('cloud-sync-status-badge');
    const ping = document.getElementById('cloud-sync-ping');
    const dot = document.getElementById('cloud-sync-dot');
    const label = document.getElementById('cloud-sync-label');
    if (!badge || !dot) return;

    if (status.isConnected) {
      if (status.isSyncing) {
        dot.className = 'relative inline-flex rounded-full h-2 w-2 bg-amber-400';
        if (ping) ping.className = 'animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75';
        if (label) label.textContent = 'Syncing...';
      } else {
        dot.className = 'relative inline-flex rounded-full h-2 w-2 bg-emerald-400';
        if (ping) ping.className = 'animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75';
        if (label) label.textContent = 'Live Cloud Sync';
      }
    } else {
      dot.className = 'relative inline-flex rounded-full h-2 w-2 bg-slate-500';
      if (ping) ping.className = 'hidden';
      if (label) label.textContent = 'Offline (Local)';
    }
  }

  handleAuthStateChange(isAuthenticated, user) {
    const lockOverlay = document.getElementById('auth-lock-overlay');
    const userProfile = document.getElementById('header-user-profile');
    const userAvatar = document.getElementById('header-user-avatar');
    const userName = document.getElementById('header-user-name');
    const userEmail = document.getElementById('header-user-email');
    const clientIdInput = document.getElementById('auth-client-id-input');

    if (clientIdInput) {
      clientIdInput.value = this.auth.googleClientId || '';
    }

    if (isAuthenticated && user) {
      this.sync.setUser(user);
      if (lockOverlay) lockOverlay.classList.add('hidden');
      if (userProfile) {
        userProfile.classList.remove('hidden');
        userProfile.classList.add('flex');
      }
      if (userAvatar) {
        userAvatar.src = user.picture || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%233b82f6"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/></svg>';
      }
      if (userName) userName.textContent = user.name || 'Manager';
      if (userEmail) userEmail.textContent = user.email || '';
      this.showToast(`Welcome, ${user.name || user.email}!`, 'success');
    } else {
      if (lockOverlay) lockOverlay.classList.remove('hidden');
      if (userProfile) {
        userProfile.classList.add('hidden');
        userProfile.classList.remove('flex');
      }
    }

    if (window.lucide) window.lucide.createIcons();
  }

  handleSaveClientId() {
    const input = document.getElementById('auth-client-id-input');
    const val = input ? input.value.trim() : '';
    if (val) {
      this.auth.setClientId(val);
      this.showToast('Google Client ID saved and initialized!', 'success');
    } else {
      alert('Please enter a valid Google OAuth Client ID.');
    }
  }

  bindEvents() {
    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tab = btn.getAttribute('data-tab');
        this.switchTab(tab);
      });
    });

    // Global Search Bar
    const searchInput = document.getElementById('global-search-input');
    const searchDropdown = document.getElementById('search-dropdown');

    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const q = e.target.value.trim().toLowerCase();
        this.renderSearchDropdown(q);
      });

      searchInput.addEventListener('focus', () => {
        const q = searchInput.value.trim().toLowerCase();
        if (q.length > 0) this.renderSearchDropdown(q);
      });

      document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !searchDropdown.contains(e.target)) {
          searchDropdown.classList.add('hidden');
        }
      });
    }

    // Quick Positional Filters in Draft Room
    document.querySelectorAll('.quick-filter-pos').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.quick-filter-pos').forEach(b => {
          b.classList.remove('active', 'bg-blue-600', 'text-white', 'font-bold');
          b.classList.add('text-slate-400');
        });
        btn.classList.add('active', 'bg-blue-600', 'text-white', 'font-bold');
        btn.classList.remove('text-slate-400');
        this.quickPosFilter = btn.getAttribute('data-pos');
        this.renderQuickPlayerPool();
      });
    });

    // Cheat Sheet Filters
    document.querySelectorAll('.cs-pos-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.cs-pos-btn').forEach(b => {
          b.classList.remove('active', 'bg-blue-600', 'text-white', 'font-bold');
          b.classList.add('text-slate-400');
        });
        btn.classList.add('active', 'bg-blue-600', 'text-white', 'font-bold');
        btn.classList.remove('text-slate-400');
        this.store.setFilters({ targetFilter: btn.getAttribute('data-filter-pos') });
      });
    });

    const csStatus = document.getElementById('cs-status-select');
    if (csStatus) {
      csStatus.addEventListener('change', (e) => {
        this.store.setFilters({ statusFilter: e.target.value });
      });
    }

    const csTier = document.getElementById('cs-tier-select');
    if (csTier) {
      csTier.addEventListener('change', (e) => {
        this.store.setFilters({ tierFilter: e.target.value });
      });
    }

    const csSearch = document.getElementById('cs-search-input');
    if (csSearch) {
      csSearch.addEventListener('input', (e) => {
        this.store.setFilters({ searchQuery: e.target.value });
      });
    }

    const rookieSearch = document.getElementById('rookie-search-input');
    if (rookieSearch) {
      rookieSearch.addEventListener('input', () => {
        this.renderRookieHub();
      });
    }

    // Top action buttons
    document.getElementById('btn-open-gemini-modal')?.addEventListener('click', () => this.openGeminiModal());
    document.getElementById('btn-quick-nominate')?.addEventListener('click', () => this.openNominateModal());
    document.getElementById('btn-open-draft-order')?.addEventListener('click', () => this.openDraftOrderModal());
    document.getElementById('btn-randomize-draft-order')?.addEventListener('click', () => this.handleRandomizeDraftOrder());
    document.getElementById('btn-reset-draft-order')?.addEventListener('click', () => this.handleResetDraftOrder());
    document.getElementById('btn-undo-pick')?.addEventListener('click', () => this.handleUndo());
    document.getElementById('btn-redo-pick')?.addEventListener('click', () => this.handleRedo());
    document.getElementById('btn-open-sync-modal')?.addEventListener('click', () => this.openSyncModal());
    document.getElementById('btn-reset-draft')?.addEventListener('click', () => this.handleReset());
    document.getElementById('btn-export-csv')?.addEventListener('click', () => this.sheetSync.exportDraftResultsCsv());
    document.getElementById('btn-export-rosters-csv')?.addEventListener('click', () => this.sheetSync.exportAllRostersCsv());
    document.getElementById('btn-shutdown-server')?.addEventListener('click', () => this.handleServerShutdown());

    // AI Provider Switcher (Gemini vs Local Model)
    document.getElementById('ai-tab-gemini')?.addEventListener('click', () => {
      document.getElementById('ai-tab-gemini').className = 'flex-1 py-1.5 rounded-lg font-bold bg-indigo-600 text-white transition-all shadow-md';
      document.getElementById('ai-tab-local').className = 'flex-1 py-1.5 rounded-lg font-bold text-slate-400 hover:text-white transition-all';
      document.getElementById('ai-section-gemini').classList.remove('hidden');
      document.getElementById('ai-section-local').classList.add('hidden');
      
      const saveBtn = document.getElementById('btn-save-gemini-key');
      if (saveBtn) {
        saveBtn.textContent = 'Save & Enable Gemini Cloud';
        saveBtn.className = 'flex-1 py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-xs font-bold rounded-xl shadow-lg shadow-indigo-600/30 transition-all';
      }

      const infoBox = document.getElementById('ai-info-box');
      if (infoBox) {
        infoBox.className = 'space-y-2 text-xs text-slate-400 bg-indigo-950/20 p-3.5 rounded-xl border border-indigo-500/20';
        document.getElementById('ai-info-title').innerHTML = '<i data-lucide="zap" class="w-3.5 h-3.5 inline"></i> How Gemini Helps on Draft Day:';
        document.getElementById('ai-info-list').innerHTML = `
          <li><b>Instant Breaking News</b>: Live alerts via Google Search grounding when a player is on the block.</li>
          <li><b>Injury Durability Checks</b>: Real-time practice participation & hamstring/knee updates.</li>
          <li><b>Tactical Price Adjustments</b>: Recommendations for 0.5 PPR $200 format.</li>
        `;
      }

      this.gemini.setProvider('gemini');
      if (window.lucide) window.lucide.createIcons();
    });

    document.getElementById('ai-tab-local')?.addEventListener('click', () => {
      document.getElementById('ai-tab-local').className = 'flex-1 py-1.5 rounded-lg font-bold bg-emerald-600 text-white transition-all shadow-md';
      document.getElementById('ai-tab-gemini').className = 'flex-1 py-1.5 rounded-lg font-bold text-slate-400 hover:text-white transition-all';
      document.getElementById('ai-section-local').classList.remove('hidden');
      document.getElementById('ai-section-gemini').classList.add('hidden');

      const saveBtn = document.getElementById('btn-save-gemini-key');
      if (saveBtn) {
        saveBtn.textContent = 'Save & Enable Local Model';
        saveBtn.className = 'flex-1 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold rounded-xl shadow-lg shadow-emerald-600/30 transition-all';
      }

      const infoBox = document.getElementById('ai-info-box');
      if (infoBox) {
        infoBox.className = 'space-y-2 text-xs text-slate-400 bg-emerald-950/20 p-3.5 rounded-xl border border-emerald-500/20';
        document.getElementById('ai-info-title').innerHTML = '<i data-lucide="cpu" class="w-3.5 h-3.5 inline text-emerald-400"></i> How Local AI Helps on Draft Day:';
        document.getElementById('ai-info-list').innerHTML = `
          <li><b>100% Free & Unlimited</b>: Zero API rate limits, no quota caps, and no credit card required.</li>
          <li><b>Instant Scouting Intel</b>: Generates role analysis and pricing adjustments right on your machine.</li>
          <li><b>Completely Offline & Private</b>: Runs on your local CPU/GPU via Ollama or LM Studio.</li>
        `;
      }

      this.gemini.setProvider('local');
      this.loadOllamaModels();
      if (window.lucide) window.lucide.createIcons();
    });

    // Gemini Modal Actions
    document.getElementById('btn-save-gemini-key')?.addEventListener('click', () => {
      if (this.gemini.provider === 'local') {
        const urlInput = document.getElementById('local-ai-url-input');
        const modelSelect = document.getElementById('local-ai-model-select');
        const url = urlInput ? urlInput.value.trim() : 'http://localhost:11434';
        const model = modelSelect ? modelSelect.value.trim() : 'llama3.2:1b';
        this.gemini.setLocalConfig(url, model);
        this.updateGeminiStatusUI();
        this.closeModals();
        this.showToast(`Local Model (${model}) enabled! 100% free & local.`, 'success');
      } else {
        const input = document.getElementById('gemini-api-key-input');
        const key = input ? input.value.trim() : '';
        if (key) {
          this.gemini.setApiKey(key);
          this.updateGeminiStatusUI();
          this.closeModals();
          this.showToast('Gemini API Key saved! Live player news enabled.', 'success');
        } else {
          alert('Please enter a valid Gemini API key.');
          return;
        }
      }

      this.gemini.resetFailures();
      this.updateGeminiStatusUI();
      this.gemini.startBackgroundPrefetch(this.store.state.players);
      this.updatePreloadUI(this.gemini.getPreloadedCount(this.store.state.players.length));

      if (this.store.state.currentNomination) {
        this.fetchGeminiNewsForNomination(this.store.state.currentNomination.player, true);
      }
    });

    document.getElementById('btn-test-gemini-key')?.addEventListener('click', () => this.testGeminiConnection());

    // Google Sheets Sync in modal
    document.getElementById('btn-run-sheet-sync')?.addEventListener('click', () => this.handleSheetSync());
    document.getElementById('btn-run-paste-import')?.addEventListener('click', () => this.handlePasteImport());

    // Modal Nominate Confirm
    document.getElementById('modal-nominate-confirm-btn')?.addEventListener('click', () => {
      const pId = document.getElementById('modal-nominate-player-select').value;
      const tId = parseInt(document.getElementById('modal-nominate-team-select').value, 10);
      const bid = parseInt(document.getElementById('modal-nominate-opening-bid').value, 10) || 1;
      if (pId && tId) {
        this.activeNominationNews = null;
        this.store.nominatePlayer(pId, tId, bid);
        this.closeModals();
        this.switchTab('draft-room');
        this.showToast('Player placed on auction block!', 'success');
      }
    });

    // Rookie Hub filters
    document.getElementById('rookie-search-input')?.addEventListener('input', () => this.renderRookieHub());
    document.getElementById('rookie-hide-drafted')?.addEventListener('change', () => this.renderRookieHub());

    // AI Admin live search and filters
    document.getElementById('ai-admin-search-input')?.addEventListener('input', () => this.renderAiAdmin());
    document.getElementById('ai-admin-pos-filter')?.addEventListener('change', () => this.renderAiAdmin());

    // Keyboard Shortcuts
    document.addEventListener('keydown', (e) => {
      // Ignore when typing inside inputs or textareas
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) {
        if (e.key === 'Escape') {
          e.target.blur();
          this.closeModals();
        }
        return;
      }

      if (e.key === '/' || (e.ctrlKey && e.key.toLowerCase() === 'k')) {
        e.preventDefault();
        searchInput?.focus();
      } else if (e.key.toLowerCase() === 'n' && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        this.openNominateModal();
      } else if (e.altKey && e.key.toLowerCase() === 'u') {
        e.preventDefault();
        this.handleUndo();
      } else if ((e.altKey && e.key.toLowerCase() === 'r') || (e.ctrlKey && e.key.toLowerCase() === 'y')) {
        e.preventDefault();
        this.handleRedo();
      } else if (e.key >= '1' && e.key <= '7') {
        const tabs = ['draft-room', 'cheat-sheet', 'my-team', 'all-teams', 'rookie-hub', 'rules-scoring', 'ai-admin'];
        const targetTab = tabs[parseInt(e.key, 10) - 1];
        if (targetTab) this.switchTab(targetTab);
      } else if (e.key === 'Escape') {
        this.closeModals();
      }
    });
  }

  switchTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      if (btn.getAttribute('data-tab') === tabId) {
        btn.classList.add('bg-blue-600', 'text-white', 'font-bold');
        btn.classList.remove('text-slate-400');
      } else {
        btn.classList.remove('bg-blue-600', 'text-white', 'font-bold');
        btn.classList.add('text-slate-400');
      }
    });

    document.querySelectorAll('.tab-content').forEach(view => {
      if (view.id === `view-${tabId}`) {
        view.classList.remove('hidden');
      } else {
        view.classList.add('hidden');
      }
    });

    this.store.setActiveTab(tabId);
    this.render();
  }

  render() {
    this.renderHeader();
    this.renderActiveNomination();
    this.renderPositionMarketHeat();
    this.renderMiniTopTargets();
    this.renderQuickPlayerPool();
    this.renderDraftHistoryFeed();
    this.renderMasterPlayerTable();
    this.renderMyTeam();
    this.renderAllTeams();
    this.renderRookieHub();
    this.renderAiAdmin();
    this.updateGeminiStatusUI();

    const draftOrderModal = document.getElementById('draft-order-modal');
    if (draftOrderModal && !draftOrderModal.classList.contains('hidden')) {
      this.renderDraftOrderModal();
    }

    // Re-initialize Lucide Icons
    if (window.lucide) {
      window.lucide.createIcons();
    }
  }

  // --- TOP HEADER RENDERING ---
  renderHeader() {
    const state = this.store.state;
    const userTeam = this.store.getUserTeam();
    const inflation = this.engine.calculateInflation(state.players, state.teams);
    const userMaxBid = this.engine.calculateMaxBid(userTeam);
    const nextNomination = this.engine.getNominationTeam(state.currentPickNumber, state.teams, state.nominationOrder);

    // Inflation badge
    const inflationEl = document.getElementById('header-inflation-val');
    if (inflationEl) {
      const sign = inflation.inflationPercent >= 0 ? '+' : '';
      const text = `${sign}${inflation.inflationPercent}% (${inflation.isInflated ? 'Inflated' : inflation.isDeflated ? 'Bargains' : 'Normal'})`;
      inflationEl.textContent = text;
      inflationEl.className = `text-xs font-bold font-mono ${inflation.isInflated ? 'text-amber-400' : inflation.isDeflated ? 'text-emerald-400' : 'text-slate-300'}`;
    }

    // User team budget
    const userRemaining = userTeam.budget - userTeam.spent;
    const budgetEl = document.getElementById('header-remaining-budget');
    if (budgetEl) budgetEl.textContent = `$${userRemaining}`;

    const maxBidEl = document.getElementById('header-max-bid');
    if (maxBidEl) maxBidEl.textContent = `$${userMaxBid}`;

    const rosterCountEl = document.getElementById('header-roster-count');
    if (rosterCountEl) {
      const totalRostered = this.engine.getTotalRosterCount(userTeam.roster);
      rosterCountEl.textContent = `${totalRostered}/15`;
    }

    // User team name in header
    const userTeamNameEl = document.getElementById('header-my-team-name');
    if (userTeamNameEl) {
      userTeamNameEl.textContent = userTeam.name;
    }

    // Serpentine nomination team turn
    const turnNameEl = document.getElementById('nomination-team-name');
    if (turnNameEl) {
      if (nextNomination.isDraftComplete) {
        turnNameEl.textContent = `Draft Complete (All Rosters Full)`;
      } else {
        turnNameEl.textContent = `${nextNomination.team.name} (Pick #${state.currentPickNumber})`;
      }
    }
  }

  // --- TAB 1: LIVE DRAFT ROOM ---

  renderActiveNomination() {
    const container = document.getElementById('nomination-container');
    if (!container) return;

    const nom = this.store.state.currentNomination;
    const inflation = this.engine.calculateInflation(this.store.state.players, this.store.state.teams);
    const userTeam = this.store.getUserTeam();

    if (!nom) {
      this.lastNominatedPlayerId = null;
      this.activeNominationNews = null;
      // Empty state: Show next serpentine nomination advice and call to action
      const nextTurn = this.engine.getNominationTeam(this.store.state.currentPickNumber, this.store.state.teams, this.store.state.nominationOrder);
      
      if (nextTurn.isDraftComplete) {
        container.innerHTML = `
          <div class="py-10 px-6 text-center space-y-4">
            <div class="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-emerald-900/30 text-emerald-400 border border-emerald-700/40 shadow-inner">
              <i data-lucide="trophy" class="w-8 h-8"></i>
            </div>
            <div>
              <h2 class="text-xl font-black text-white tracking-tight">Draft is 100% Complete!</h2>
              <p class="text-xs text-slate-400 max-w-md mx-auto mt-1">
                All 12 teams have completed their rosters or exhausted their draft budgets.
              </p>
            </div>
            <div class="flex items-center justify-center gap-3 pt-2">
              <button onclick="window.app.switchTab('all-teams')" class="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl shadow-lg transition-all">
                View Final Standings & Matrix
              </button>
              <button onclick="window.app.sheetSync.exportAllRostersCsv()" class="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-xl transition-all">
                Export All 12 Rosters CSV
              </button>
            </div>
          </div>
        `;
        return;
      }

      container.innerHTML = `
        <div class="py-10 px-6 text-center space-y-4">
          <div class="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-900/30 text-blue-400 border border-blue-700/40 shadow-inner pulse-subtle">
            <i data-lucide="gavel" class="w-8 h-8"></i>
          </div>
          <div>
            <h2 class="text-xl font-black text-white tracking-tight">The Auction Block is Open</h2>
            <p class="text-xs text-slate-400 max-w-md mx-auto mt-1">
              Pick <span class="text-blue-400 font-bold font-mono">#${this.store.state.currentPickNumber}</span> (Round ${nextTurn.round}) • 
              Turn: <span class="text-amber-400 font-bold">${nextTurn.team.name}</span>
              ${nextTurn.eligibleCount < 12 ? `<span class="text-[11px] text-slate-500 ml-1.5">(${nextTurn.eligibleCount}/12 active teams remaining)</span>` : ''}
            </p>
          </div>

          <div class="flex items-center justify-center gap-3 pt-2">
            <button onclick="window.app.openNominateModal()" class="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl shadow-lg shadow-blue-600/30 flex items-center gap-2 transition-all">
              <i data-lucide="plus-circle" class="w-4 h-4"></i> Nominate Player (Press N)
            </button>
            <button onclick="window.app.openDraftOrderModal()" class="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-amber-300 text-xs font-semibold rounded-xl border border-slate-700 transition-all flex items-center gap-1.5">
              <i data-lucide="list-ordered" class="w-3.5 h-3.5"></i> Edit Draft Order
            </button>
            <button onclick="window.app.switchTab('cheat-sheet')" class="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl border border-slate-700 transition-all">
              Cheat Sheet
            </button>
          </div>
        </div>
      `;
      return;
    }

    // Active Player on the block!
    const player = nom.player;

    // Auto-trigger fresh live news rerun for the picked player!
    if (this.lastNominatedPlayerId !== player.id) {
      this.lastNominatedPlayerId = player.id;
      this.activeNominationNews = null;
      setTimeout(() => {
        this.fetchGeminiNewsForNomination(player, true);
      }, 50);
    }

    const advice = this.engine.getBiddingAdvice(player, userTeam, inflation.inflationRate);
    const dynamicVal = this.engine.getDynamicPlayerValue(player, inflation.inflationRate);
    const posClass = `badge-${player.pos.toLowerCase()}`;
    const news = this.activeNominationNews || this.gemini.getCachedNews(player.id);
    const injuryStr = (news && news.injuryStatus) ? news.injuryStatus : (player.injury || 'Healthy');
    const isInjured = injuryStr.toLowerCase().includes('out') || injuryStr.toLowerCase().includes('ir') || injuryStr.toLowerCase().includes('elevated') || injuryStr.toLowerCase().includes('quest') || injuryStr.toLowerCase().includes('risk');

    const healthBadge = isInjured 
      ? `<span class="px-2.5 py-0.5 rounded-full text-[11px] font-black bg-rose-500/20 text-rose-300 border border-rose-500/50 flex items-center gap-1 animate-pulse"><i data-lucide="alert-triangle" class="w-3.5 h-3.5 text-rose-400"></i> INJURY: ${injuryStr}</span>`
      : `<span class="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex items-center gap-1"><i data-lucide="check-circle-2" class="w-3.5 h-3.5 text-emerald-400"></i> 100% HEALTHY / ACTIVE</span>`;

    const tierScarcity = this.engine.getTierScarcity(player, this.store.state.players);
    const opponentThreats = this.engine.getOpponentBiddingThreats(player, this.store.state.teams, this.store.state.userTeamId);

    container.innerHTML = `
      <div class="space-y-4">
        
        <!-- Header: Pos Badge, Name, Team, Bye, Health -->
        <div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div class="flex items-center gap-3">
            <span class="px-3 py-1 rounded-xl text-xs font-extrabold uppercase ${posClass}">
              ${player.pos}
            </span>
            <div>
              <div class="flex items-center gap-2 flex-wrap">
                <h2 class="text-2xl font-black text-white tracking-tight">${player.name}</h2>
                ${player.isRookie ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">ROOKIE</span>' : ''}
                ${healthBadge}
              </div>
              <div class="text-xs text-slate-400 flex items-center gap-2 mt-0.5">
                <span class="font-bold text-slate-300">${player.team}</span>
                <span>•</span>
                <span>Bye Week ${player.bye || 'None'}</span>
                <span>•</span>
                <span class="text-amber-400 font-semibold">${player.tier}</span>
                <span>•</span>
                <span>Nominated by <b class="text-slate-200">${nom.nominatingTeamName}</b></span>
              </div>
            </div>
          </div>

          <div class="text-right">
            <div class="text-[10px] text-slate-400 uppercase font-semibold">Projected 2026 Points</div>
            <div class="text-2xl font-black font-mono text-blue-400">${player.projPts.toFixed(1)} <span class="text-xs text-slate-400">pts</span></div>
          </div>
        </div>

        <!-- Tier Scarcity Cliff Alert Banner -->
        ${tierScarcity ? `
          <div class="p-3 rounded-xl ${tierScarcity.isCliff ? 'bg-amber-500/20 border border-amber-500/50 text-amber-200' : 'bg-blue-950/40 border border-blue-500/40 text-blue-200'} flex items-center justify-between gap-2 text-xs shadow-md">
            <div class="flex items-center gap-2">
              <i data-lucide="alert-triangle" class="w-4 h-4 text-amber-400 shrink-0"></i>
              <div>
                <span class="font-black uppercase tracking-wider">${tierScarcity.badgeText}</span> —
                <span class="text-[11px] text-slate-300">${tierScarcity.alertMessage}</span>
              </div>
            </div>
            <span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-slate-900 border border-slate-700 text-amber-300 shrink-0">
              ${tierScarcity.remainingCount} left in Tier
            </span>
          </div>
        ` : ''}

        <!-- Valuation Grid -->
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div class="bg-slate-950 p-3 rounded-xl border border-slate-800 text-center">
            <div class="text-[10px] text-slate-400 uppercase font-medium">Baseline Value</div>
            <div class="text-lg font-black font-mono text-slate-200 mt-0.5">$${player.baselineVal}</div>
          </div>
          <div class="bg-slate-950 p-3 rounded-xl border border-blue-900/40 text-center">
            <div class="text-[10px] text-blue-400 uppercase font-medium">Dynamic Inflated $</div>
            <div class="text-lg font-black font-mono text-blue-400 mt-0.5">$${dynamicVal}</div>
          </div>
          <div class="bg-slate-950 p-3 rounded-xl border border-slate-800 text-center">
            <div class="text-[10px] text-slate-400 uppercase font-medium">Target Bid Range</div>
            <div class="text-sm font-bold font-mono text-emerald-400 mt-1">${player.targetRange || `$${player.baselineVal}`}</div>
          </div>
          <div class="bg-slate-950 p-3 rounded-xl border border-slate-800 text-center">
            <div class="text-[10px] text-slate-400 uppercase font-medium">Hard Max Ceiling</div>
            <div class="text-lg font-black font-mono text-amber-400 mt-0.5">$${player.hardMax}</div>
          </div>
        </div>

        <!-- ⚡ GEMINI LIVE BREAKING NEWS & SCOUTING INTEL -->
        <div id="nomination-gemini-news-container" class="rounded-xl border border-indigo-500/30 bg-gradient-to-r from-indigo-950/40 to-purple-950/20 p-4 space-y-2 shadow-inner">
          ${this.renderGeminiNewsCard(player)}
        </div>

        <!-- Opponent Bidding Threat Radar -->
        <div class="bg-slate-950/90 p-3.5 rounded-xl border border-slate-800/80 text-xs space-y-2">
          <div class="flex items-center justify-between text-slate-400">
            <span class="font-bold flex items-center gap-1.5 text-slate-200">
              <i data-lucide="crosshair" class="w-3.5 h-3.5 text-rose-400"></i> Opponent Bidding Threat Radar
            </span>
            <span class="text-[11px] text-slate-500">${opponentThreats.length} rival${opponentThreats.length === 1 ? '' : 's'} with position need</span>
          </div>
          ${opponentThreats.length === 0 ? `
            <div class="text-[11px] text-slate-500 italic py-0.5">No rival teams currently have critical starting needs for this slot. Clear bidding runway!</div>
          ` : `
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 pt-1">
              ${opponentThreats.slice(0, 6).map(th => `
                <div class="p-2 rounded-lg bg-slate-900/80 border border-slate-800 flex items-center justify-between text-[11px]">
                  <div>
                    <span class="font-bold text-slate-200 truncate max-w-[110px] inline-block">${th.teamName}</span>
                    <div class="text-[9px] text-slate-400">${th.needDescription}</div>
                  </div>
                  <div class="text-right font-mono">
                    <div class="font-bold text-amber-400">$${th.maxBid} <span class="text-[9px] text-slate-500">max</span></div>
                    <div class="text-[9px] text-slate-500">$${th.remainingCash} left</div>
                  </div>
                </div>
              `).join('')}
            </div>
          `}
        </div>

        <!-- Scouting & Tactical Notes from Sheet -->
        <div class="bg-slate-950/80 p-3.5 rounded-xl border border-slate-800 text-xs text-slate-300 space-y-1.5">
          <div class="flex items-center justify-between font-semibold text-slate-400">
            <span>Role: <b class="text-slate-200">${player.role || 'Primary contributor'}</b></span>
            <span>Offense: <b class="text-slate-200">${player.offense || 'Standard'}</b></span>
          </div>
          <p class="text-slate-300 leading-relaxed italic">"${player.notes || 'High-value draft target.'}"</p>
        </div>

        <!-- Bidding Recommendation Badge -->
        <div class="p-3 rounded-xl border ${advice.badgeClass} flex items-center justify-between gap-3 text-xs">
          <div class="flex items-center gap-2">
            <i data-lucide="shield-alert" class="w-4 h-4 shrink-0"></i>
            <div>
              <span class="font-bold uppercase tracking-wider">${advice.status}:</span> ${advice.message}
            </div>
          </div>
          <div class="text-right shrink-0">
            <span class="text-slate-400">Your Max Bid:</span> <b class="font-mono text-amber-400">$${advice.userMaxBid}</b>
          </div>
        </div>

        <!-- BID LOGGING FORM -->
        <div class="bg-gradient-to-r from-slate-950 to-blue-950/40 p-4 rounded-xl border border-blue-500/30 flex flex-wrap items-center justify-between gap-3">
          <div class="flex flex-wrap items-center gap-3 flex-1">
            <div>
              <label class="block text-[10px] text-slate-400 uppercase font-semibold mb-1">Winning Team</label>
              <select id="active-winning-team-select" class="bg-slate-900 border border-slate-700 text-xs text-slate-100 rounded-xl px-3 py-2 font-semibold focus:outline-none focus:border-blue-500">
                ${this.store.state.teams.map(t => `<option value="${t.id}" ${t.id === nom.nominatingTeamId ? 'selected' : ''}>${t.name} (Max: $${this.engine.calculateMaxBid(t)})</option>`).join('')}
              </select>
            </div>

            <div>
              <label class="block text-[10px] text-slate-400 uppercase font-semibold mb-1">Winning Price ($)</label>
              <input 
                type="number" 
                id="active-winning-price-input" 
                value="${nom.openingBid}" 
                min="1" 
                max="200" 
                class="bg-slate-900 border border-slate-700 text-sm font-mono font-bold text-white rounded-xl px-3 py-2 w-24 focus:outline-none focus:border-blue-500" 
              />
            </div>
          </div>

          <div class="flex items-center gap-2">
            <button onclick="window.app.cancelNomination()" class="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 text-xs font-semibold rounded-xl transition-all">
              Cancel
            </button>
            <button onclick="window.app.confirmActiveDraft()" class="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl shadow-lg shadow-emerald-600/30 flex items-center gap-1.5 transition-all">
              <i data-lucide="check" class="w-4 h-4"></i> Confirm Pick (Enter)
            </button>
          </div>
        </div>

      </div>
    `;

    // Focus price input for immediate keyboard entry
    setTimeout(() => {
      const priceInput = document.getElementById('active-winning-price-input');
      if (priceInput) {
        priceInput.focus();
        priceInput.select();
        priceInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            this.confirmActiveDraft();
          }
        });
      }
    }, 50);
  }

  confirmActiveDraft() {
    const nom = this.store.state.currentNomination;
    if (!nom) return;

    const teamSelect = document.getElementById('active-winning-team-select');
    const priceInput = document.getElementById('active-winning-price-input');

    const teamId = parseInt(teamSelect.value, 10);
    const price = parseInt(priceInput.value, 10) || 1;

    this.lastNominatedPlayerId = null;
    this.activeNominationNews = null;

    this.store.draftPlayer(nom.playerId, teamId, price);
    this.showToast(`Drafted ${nom.player.name} for $${price}!`, 'success');
  }

  cancelNomination() {
    this.lastNominatedPlayerId = null;
    this.activeNominationNews = null;
    this.store.cancelNomination();
    this.showToast('Nomination canceled.', 'info');
  }

  renderPositionMarketHeat() {
    const container = document.getElementById('position-heat-grid');
    const draftedCountEl = document.getElementById('total-drafted-count');
    if (!container) return;

    const state = this.store.state;
    const history = state.draftHistory;
    const inflation = this.engine.calculateInflation(state.players, state.teams);
    draftedCountEl.textContent = `${history.length} / 180 Drafted`;

    const positions = ['RB', 'WR', 'TE', 'QB', 'K', 'DST'];
    container.innerHTML = positions.map(pos => {
      const posInf = inflation.positionalInflation ? inflation.positionalInflation[pos] : null;
      const draftedInPos = history.filter(h => h.pos === pos);
      const spentInPos = draftedInPos.reduce((sum, h) => sum + h.price, 0);
      const baseInPos = draftedInPos.reduce((sum, h) => sum + (h.baselineVal || 0), 0);
      const delta = spentInPos - baseInPos;

      let heatColor = 'text-slate-400';
      let heatText = '0% (Normal)';
      if (posInf && draftedInPos.length > 0) {
        const sign = posInf.inflationPercent >= 0 ? '+' : '';
        if (posInf.isHot) {
          heatColor = 'text-amber-400';
          heatText = `${sign}${posInf.inflationPercent}% (Hot)`;
        } else if (posInf.isCold) {
          heatColor = 'text-emerald-400';
          heatText = `${sign}${posInf.inflationPercent}% (Cold)`;
        } else {
          heatColor = 'text-slate-300';
          heatText = `${sign}${posInf.inflationPercent}% (Fair)`;
        }
      }

      return `
        <div class="bg-slate-950/70 p-2.5 rounded-xl border border-slate-800/80 text-center" title="${pos}: $${spentInPos} spent vs $${baseInPos} baseline (${delta >= 0 ? '+$' : '-$'}${Math.abs(delta)})">
          <div class="text-[10px] font-bold text-slate-400 uppercase">${pos} (${draftedInPos.length})</div>
          <div class="text-xs font-mono font-extrabold ${heatColor} mt-0.5">${heatText}</div>
          <div class="text-[9px] text-slate-500 font-mono mt-0.5">$${spentInPos} / $${baseInPos}</div>
        </div>
      `;
    }).join('');
  }

  renderMiniTopTargets() {
    const container = document.getElementById('mini-top-targets');
    if (!container) return;

    const inflation = this.engine.calculateInflation(this.store.state.players, this.store.state.teams);
    const available = this.store.state.players
      .filter(p => !p.drafted && !p.isDND)
      .sort((a, b) => {
        // Prioritize starred players then baseline value
        if (a.isStarred && !b.isStarred) return -1;
        if (!a.isStarred && b.isStarred) return 1;
        return (b.baselineVal || 0) - (a.baselineVal || 0);
      })
      .slice(0, 4);

    if (available.length === 0) {
      container.innerHTML = '<div class="text-xs text-slate-500 py-2">No more players available.</div>';
      return;
    }

    container.innerHTML = available.map(p => {
      const dynVal = this.engine.getDynamicPlayerValue(p, inflation.inflationRate);
      return `
        <div class="flex items-center justify-between p-2 rounded-xl bg-slate-950/60 border border-slate-800/80 hover:border-slate-700 transition-all text-xs">
          <div class="flex items-center gap-2">
            <button onclick="window.app.toggleStar('${p.id}')" class="${p.isStarred ? 'text-amber-400' : 'text-slate-600 hover:text-slate-400'}">
              <i data-lucide="star" class="w-3.5 h-3.5 fill-current"></i>
            </button>
            <span class="font-extrabold text-[10px] px-1.5 py-0.5 rounded badge-${p.pos.toLowerCase()}">${p.pos}</span>
            <span class="font-bold text-slate-200 cursor-pointer hover:text-blue-400" onclick="window.app.openPlayerModal('${p.id}')">${p.name}</span>
            <span class="text-[10px] text-slate-500">${p.team}</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="font-mono font-bold text-emerald-400">$${dynVal}</span>
            <button onclick="window.app.quickNominatePlayer('${p.id}')" class="px-2 py-1 bg-blue-600/80 hover:bg-blue-500 text-[10px] font-bold text-white rounded-lg">
              Nominate
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  renderQuickPlayerPool() {
    const container = document.getElementById('quick-player-pool');
    if (!container) return;

    const inflation = this.engine.calculateInflation(this.store.state.players, this.store.state.teams);
    let players = this.store.state.players.filter(p => !p.drafted);

    if (this.quickPosFilter !== 'ALL') {
      if (this.quickPosFilter === 'FLEX') {
        players = players.filter(p => ['RB', 'WR', 'TE'].includes(p.pos));
      } else {
        players = players.filter(p => p.pos === this.quickPosFilter);
      }
    }

    players = players.slice(0, 30);

    if (players.length === 0) {
      container.innerHTML = '<div class="text-xs text-slate-500 py-4 text-center">No available players in this category.</div>';
      return;
    }

    container.innerHTML = players.map(p => {
      const dynVal = this.engine.getDynamicPlayerValue(p, inflation.inflationRate);
      return `
        <div class="flex items-center justify-between p-2 rounded-xl bg-slate-900/60 border border-slate-800/60 hover:bg-slate-800/60 hover:border-slate-700 transition-all text-xs gap-2">
          <div class="flex items-center gap-2.5 min-w-0 max-w-[200px] shrink-0">
            <button onclick="window.app.toggleStar('${p.id}')" class="${p.isStarred ? 'text-amber-400' : 'text-slate-600 hover:text-slate-400'} shrink-0">
              <i data-lucide="star" class="w-3.5 h-3.5 ${p.isStarred ? 'fill-current' : ''}"></i>
            </button>
            <span class="font-extrabold text-[10px] px-1.5 py-0.5 rounded badge-${p.pos.toLowerCase()} shrink-0">${p.pos}</span>
            <div class="truncate cursor-pointer hover:text-blue-400" onclick="window.app.openPlayerModal('${p.id}')">
              <span class="font-bold text-slate-200">${p.name}</span>
              <span class="text-[10px] text-slate-400 ml-1">${p.team}</span>
            </div>
            ${p.isRookie ? '<span class="text-[9px] px-1 bg-amber-500/20 text-amber-300 rounded shrink-0 font-bold">R</span>' : ''}
          </div>

          <!-- 5-10 Word AI Intel / Buzz Snippet -->
          <div class="flex-1 min-w-0 hidden sm:flex items-center px-1">
            ${(() => {
              const cached = this.gemini.getCachedNews(p.id, p.name);
              if (cached && (cached.headline || cached.auctionAdvice || cached.summary)) {
                const text = cached.headline || cached.auctionAdvice || cached.summary;
                const isInj = cached.injuryStatus && (cached.injuryStatus.toLowerCase().includes('out') || cached.injuryStatus.toLowerCase().includes('ir') || cached.injuryStatus.toLowerCase().includes('elevated') || cached.injuryStatus.toLowerCase().includes('quest') || cached.injuryStatus.toLowerCase().includes('risk'));
                return `
                  <span class="text-[11px] ${isInj ? 'text-rose-300 font-semibold' : 'text-indigo-300'} truncate flex items-center gap-1.5" title="${text}">
                    <i data-lucide="${isInj ? 'alert-triangle' : 'sparkles'}" class="w-3.5 h-3.5 shrink-0 ${isInj ? 'text-rose-400' : 'text-indigo-400'}"></i>
                    <span class="truncate italic">${text}</span>
                  </span>
                `;
              }
              if (p.notes) {
                return `<span class="text-[11px] text-slate-400 italic truncate" title="${p.notes}">${p.notes}</span>`;
              }
              return `<span class="text-[10px] text-slate-600 italic">Tier ${p.tier} • Pos Rank #${p.posRank}</span>`;
            })()}
          </div>

          <div class="flex items-center gap-3 shrink-0">
            <div class="text-right">
              <div class="text-[11px] font-bold font-mono text-blue-400">$${dynVal} <span class="text-[9px] text-slate-500 font-normal">($${p.baselineVal})</span></div>
              <div class="text-[9px] text-slate-400 font-mono">${p.projPts.toFixed(1)} pts</div>
            </div>
            <button onclick="window.app.quickNominatePlayer('${p.id}')" class="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-[11px] font-bold text-white rounded-lg shadow-sm">
              Nominate
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  renderDraftHistoryFeed() {
    const container = document.getElementById('draft-history-feed');
    const historyCountEl = document.getElementById('draft-history-count');
    if (!container) return;

    const history = this.store.state.draftHistory;
    historyCountEl.textContent = `${history.length} picks logged`;

    if (history.length === 0) {
      container.innerHTML = `
        <div class="py-8 text-center text-xs text-slate-500">
          No picks drafted yet. As players are won, they will appear here live with value surplus indicators.
        </div>
      `;
      return;
    }

    container.innerHTML = history.map(h => {
      const isUserTeam = h.winningTeamId === this.store.state.userTeamId;
      const isSteal = h.valueDelta > 3;
      const isOverpay = h.valueDelta < -3;

      let valueBadge = '';
      if (isSteal) {
        valueBadge = `<span class="text-[10px] font-bold text-emerald-400 bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-800">+$${h.valueDelta} Steal</span>`;
      } else if (isOverpay) {
        valueBadge = `<span class="text-[10px] font-bold text-rose-400 bg-rose-950/60 px-1.5 py-0.5 rounded border border-rose-800">-$${Math.abs(h.valueDelta)} Overpay</span>`;
      } else {
        valueBadge = `<span class="text-[10px] text-slate-400 font-mono">Fair Value</span>`;
      }

      return `
        <div class="p-2.5 rounded-xl border ${isUserTeam ? 'bg-blue-950/30 border-blue-500/40' : 'bg-slate-950/70 border-slate-800/80'} text-xs space-y-1">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="text-[10px] font-mono text-slate-500">#${h.pickNumber}</span>
              <span class="font-extrabold text-[10px] px-1.5 py-0.5 rounded badge-${h.pos.toLowerCase()}">${h.pos}</span>
              <span class="font-bold ${isUserTeam ? 'text-blue-300' : 'text-slate-200'} cursor-pointer hover:underline" onclick="window.app.openPlayerModal('${h.playerId}')">${h.playerName}</span>
              <span class="text-[10px] text-slate-500">${h.teamNFL}</span>
            </div>
            <div class="font-mono font-black text-sm text-emerald-400">
              $${h.price}
            </div>
          </div>
          <div class="flex items-center justify-between text-[11px] text-slate-400 pt-0.5">
            <div class="flex items-center gap-1.5">
              <span>Won by <b class="${isUserTeam ? 'text-emerald-400' : 'text-slate-300'}">${h.winningTeamName}</b></span>
              <span class="text-slate-600">•</span>
              <span class="text-slate-500">${h.rosterSlot}</span>
            </div>
            <div>${valueBadge}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  // --- TAB 2: MASTER CHEAT SHEET ---

  renderMasterPlayerTable() {
    const tbody = document.getElementById('master-player-tbody');
    if (!tbody) return;

    const state = this.store.state;
    const inflation = this.engine.calculateInflation(state.players, state.teams);

    let list = [...state.players];

    // Filter by position
    if (state.targetFilter !== 'ALL') {
      if (state.targetFilter === 'FLEX') {
        list = list.filter(p => ['RB', 'WR', 'TE'].includes(p.pos));
      } else {
        list = list.filter(p => p.pos === state.targetFilter);
      }
    }

    // Filter by status
    if (state.statusFilter === 'AVAILABLE') {
      list = list.filter(p => !p.drafted);
    } else if (state.statusFilter === 'DRAFTED') {
      list = list.filter(p => p.drafted);
    } else if (state.statusFilter === 'STARRED') {
      list = list.filter(p => p.isStarred);
    } else if (state.statusFilter === 'DND') {
      list = list.filter(p => p.isDND);
    }

    // Filter by tier
    if (state.tierFilter !== 'ALL') {
      list = list.filter(p => p.tier && p.tier.includes(state.tierFilter));
    }

    // Filter by search query
    if (state.searchQuery && state.searchQuery.trim() !== '') {
      const q = state.searchQuery.toLowerCase();
      list = list.filter(p => 
        p.name.toLowerCase().includes(q) ||
        p.team.toLowerCase().includes(q) ||
        (p.notes && p.notes.toLowerCase().includes(q))
      );
    }

    // Sort table
    const sortCol = this.tableSort.column;
    const asc = this.tableSort.asc;

    list.sort((a, b) => {
      let valA = a[sortCol];
      let valB = b[sortCol];

      if (sortCol === 'dynVal') {
        valA = this.engine.getDynamicPlayerValue(a, inflation.inflationRate);
        valB = this.engine.getDynamicPlayerValue(b, inflation.inflationRate);
      }

      if (typeof valA === 'string') {
        return asc ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }
      return asc ? (valA || 0) - (valB || 0) : (valB || 0) - (valA || 0);
    });

    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="14" class="p-8 text-center text-slate-500">No players match the selected filters.</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map(p => {
      const dynVal = this.engine.getDynamicPlayerValue(p, inflation.inflationRate);
      const isDrafted = p.drafted;
      const isMyTeam = p.draftedTeamId === state.userTeamId;
      const winningTeam = isDrafted ? state.teams.find(t => t.id === p.draftedTeamId) : null;

      let rowClass = 'hover:bg-slate-900/80 transition-colors';
      if (isDrafted) rowClass += ' row-drafted';
      if (isMyTeam) rowClass += ' row-my-team';

      const cachedNews = this.gemini.getCachedNews(p.id);
      const injuryStr = (cachedNews && cachedNews.injuryStatus) ? cachedNews.injuryStatus : (p.injury || '');
      const isInjured = injuryStr && (injuryStr.toLowerCase().includes('out') || injuryStr.toLowerCase().includes('ir') || injuryStr.toLowerCase().includes('elevated') || injuryStr.toLowerCase().includes('quest') || injuryStr.toLowerCase().includes('risk'));

      const tierScarcity = !p.drafted ? this.engine.getTierScarcity(p, this.store.state.players) : null;

      return `
        <tr class="${rowClass}">
          <!-- Star Target -->
          <td class="p-3 text-center">
            <button onclick="window.app.toggleStar('${p.id}')" class="${p.isStarred ? 'text-amber-400' : 'text-slate-600 hover:text-slate-400'}">
              <i data-lucide="star" class="w-4 h-4 ${p.isStarred ? 'fill-current' : ''}"></i>
            </button>
          </td>

          <!-- Rank -->
          <td class="p-3 font-mono text-slate-400">${p.rank}</td>

          <!-- Name & Team -->
          <td class="p-3">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-bold text-slate-100 hover:text-blue-400 cursor-pointer" onclick="window.app.openPlayerModal('${p.id}')">
                ${p.name}
              </span>
              ${p.isRookie ? '<span class="px-1.5 py-0.2 rounded text-[9px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">ROOKIE</span>' : ''}
              ${tierScarcity ? `<span class="px-1.5 py-0.2 rounded text-[9px] font-black ${tierScarcity.isCliff ? 'bg-amber-500/20 text-amber-300 border border-amber-500/50 animate-pulse' : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'}" title="${tierScarcity.alertMessage}">${tierScarcity.isCliff ? '🔥 1 LEFT' : '⚠️ 2 LEFT'}</span>` : ''}
              ${isInjured ? `<span class="px-1.5 py-0.2 rounded text-[9px] font-black bg-rose-500/20 text-rose-300 border border-rose-500/40 animate-pulse" title="Injury Status: ${injuryStr}">⚠️ ${injuryStr}</span>` : ''}
            </div>
            <div class="text-[10px] text-slate-500">${p.team} • ${p.posRank}</div>
          </td>

          <!-- Pos -->
          <td class="p-3 text-center">
            <span class="px-2 py-0.5 rounded text-[10px] font-extrabold uppercase badge-${p.pos.toLowerCase()}">
              ${p.pos}
            </span>
          </td>

          <!-- Bye -->
          <td class="p-3 text-center font-mono text-slate-400">${p.bye || '-'}</td>

          <!-- Tier -->
          <td class="p-3">
            <span class="px-2 py-0.5 rounded text-[10px] font-semibold ${p.tier && p.tier.includes('Tier 1') ? 'tier-1' : p.tier && p.tier.includes('Tier 2') ? 'tier-2' : p.tier && p.tier.includes('Tier 3') ? 'tier-3' : 'tier-4'}">
              ${p.tier || 'Tier 5'}
            </span>
          </td>

          <!-- Proj Pts -->
          <td class="p-3 text-right font-mono font-bold text-blue-400">${p.projPts.toFixed(1)}</td>

          <!-- Baseline $ -->
          <td class="p-3 text-right font-mono font-bold text-slate-300">$${p.baselineVal}</td>

          <!-- Dynamic $ -->
          <td class="p-3 text-right font-mono font-black text-emerald-400">$${dynVal}</td>

          <!-- Target Range -->
          <td class="p-3 text-center font-mono text-slate-400">${p.targetRange || `$${p.baselineVal}`}</td>

          <!-- Hard Max -->
          <td class="p-3 text-right font-mono text-amber-400 font-bold">$${p.hardMax}</td>

          <!-- AAV -->
          <td class="p-3 text-right font-mono text-slate-400">$${p.aav}</td>

          <!-- Notes -->
          <td class="p-3 text-slate-400 max-w-xs truncate" title="${p.notes || ''}">
            <span class="text-slate-300 font-medium">${p.role || ''}</span> ${p.notes ? `— ${p.notes}` : ''}
          </td>

          <!-- Action -->
          <td class="p-3 text-center">
            ${isDrafted 
              ? `<span class="text-[10px] font-bold text-slate-400 bg-slate-800 px-2 py-1 rounded">Drafted ($${p.draftedPrice} by ${winningTeam ? winningTeam.name : 'Team'})</span>`
              : `<button onclick="window.app.quickNominatePlayer('${p.id}')" class="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg text-[11px] shadow-sm">Nominate</button>`
            }
          </td>
        </tr>
      `;
    }).join('');
  }

  setTableSort(column) {
    if (this.tableSort.column === column) {
      this.tableSort.asc = !this.tableSort.asc;
    } else {
      this.tableSort.column = column;
      this.tableSort.asc = column === 'rank' || column === 'name';
    }
    this.renderMasterPlayerTable();
  }

  // --- TAB 3: MY TEAM ROSTER ---

  renderMyTeam() {
    const userTeam = this.store.getUserTeam();
    const inflation = this.engine.calculateInflation(this.store.state.players, this.store.state.teams);
    const userMaxBid = this.engine.calculateMaxBid(userTeam);
    const openStarters = this.engine.getOpenStartingSpots(userTeam.roster);
    const totalRostered = this.engine.getTotalRosterCount(userTeam.roster);

    // Update banner cards
    const budgetSpent = userTeam.spent || 0;
    const budgetLeft = userTeam.budget - budgetSpent;

    document.getElementById('myteam-budget-left').textContent = `$${budgetLeft}`;
    document.getElementById('myteam-budget-spent').textContent = `$${budgetSpent}`;
    document.getElementById('myteam-max-bid').textContent = `$${userMaxBid}`;
    document.getElementById('myteam-open-starters').textContent = openStarters;
    document.getElementById('myteam-roster-fraction').textContent = `${totalRostered} / 15`;

    const starters = userTeam.roster.starters || { QB: [], RB: [], WR: [], FLEX: [], K: [], DST: [] };
    const bench = userTeam.roster.bench || [];

    const starterCount = Object.values(starters).reduce((s, a) => s + a.length, 0);
    document.getElementById('myteam-starters-count').textContent = `${starterCount}/9`;
    document.getElementById('myteam-bench-count').textContent = `${bench.length}/6`;

    // Calculate total projected points of starting lineup
    let totalProjPts = 0;
    Object.values(starters).forEach(list => {
      list.forEach(p => totalProjPts += (p.projPts || 0));
    });
    document.getElementById('myteam-proj-pts').textContent = `${totalProjPts.toFixed(1)} pts`;
    document.getElementById('myteam-weekly-avg').textContent = (totalProjPts / 14).toFixed(1);

    // Bye week conflicts
    const byeWarnings = this.engine.checkByeConflicts(userTeam.roster);
    const byeAlertsBox = document.getElementById('myteam-bye-alerts');
    const byeAlertsText = document.getElementById('myteam-bye-alert-text');
    if (byeWarnings.length > 0) {
      byeAlertsBox.classList.remove('hidden');
      byeAlertsText.textContent = byeWarnings.join(' • ');
    } else {
      byeAlertsBox.classList.add('hidden');
    }

    // Render Bye Week Matrix (Weeks 5-14)
    const byeGrid = document.getElementById('myteam-bye-matrix-grid');
    if (byeGrid) {
      const allDrafted = [...Object.values(starters).flat(), ...bench];
      const weekCols = [];
      for (let w = 5; w <= 14; w++) {
        const offPlayers = allDrafted.filter(p => p.bye === w);
        const starterOff = Object.values(starters).flat().filter(p => p.bye === w);
        const count = offPlayers.length;
        const starterCount = starterOff.length;

        let colClass = 'bg-slate-950/70 border-slate-800/80 text-slate-400';
        let badgeColor = 'text-slate-500';
        if (starterCount >= 3) {
          colClass = 'bg-rose-950/40 border-rose-600/60 text-rose-300 shadow-sm';
          badgeColor = 'text-rose-400 font-bold';
        } else if (starterCount === 2) {
          colClass = 'bg-amber-950/30 border-amber-600/50 text-amber-300';
          badgeColor = 'text-amber-400 font-bold';
        } else if (count > 0) {
          colClass = 'bg-slate-900/90 border-slate-700 text-slate-200';
          badgeColor = 'text-blue-400 font-semibold';
        }

        weekCols.push(`
          <div class="p-2 rounded-xl border ${colClass} text-center space-y-1">
            <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Wk ${w}</div>
            <div class="text-xs font-mono font-black ${badgeColor}">${count > 0 ? `${count} off` : '—'}</div>
            <div class="text-[9px] text-slate-400 truncate">${starterOff.map(p => p.pos).join(', ') || (count > 0 ? 'Bench only' : 'Clear')}</div>
          </div>
        `);
      }
      byeGrid.innerHTML = weekCols.join('');
    }

    // Render Starters Slots
    const startersContainer = document.getElementById('myteam-starters-slots');
    const slotTemplates = [
      { slot: 'QB', label: 'QB 1', posReq: 'QB', player: starters.QB[0] },
      { slot: 'RB1', label: 'RB 1', posReq: 'RB', player: starters.RB[0] },
      { slot: 'RB2', label: 'RB 2', posReq: 'RB', player: starters.RB[1] },
      { slot: 'WR1', label: 'WR 1', posReq: 'WR', player: starters.WR[0] },
      { slot: 'WR2', label: 'WR 2', posReq: 'WR', player: starters.WR[1] },
      { slot: 'FLEX1', label: 'FLEX 1 (RB/WR/TE)', posReq: 'FLEX', player: starters.FLEX[0] },
      { slot: 'FLEX2', label: 'FLEX 2 (RB/WR/TE)', posReq: 'FLEX', player: starters.FLEX[1] },
      { slot: 'K', label: 'K 1', posReq: 'K', player: starters.K[0] },
      { slot: 'DST', label: 'DST 1', posReq: 'DST', player: starters.DST[0] }
    ];

    startersContainer.innerHTML = slotTemplates.map(s => {
      const p = s.player;
      if (p) {
        return `
          <div class="flex items-center justify-between p-3 rounded-xl bg-slate-900/90 border border-slate-700/80 shadow-md">
            <div class="flex items-center gap-3">
              <span class="w-16 text-[10px] font-black uppercase tracking-wider text-slate-400 bg-slate-800 px-2 py-1 rounded text-center">${s.label.split(' ')[0]}</span>
              <span class="px-2 py-0.5 rounded text-[10px] font-extrabold uppercase badge-${p.pos.toLowerCase()}">${p.pos}</span>
              <div>
                <div class="font-bold text-white hover:text-blue-400 cursor-pointer text-xs" onclick="window.app.openPlayerModal('${p.id}')">
                  ${p.name}
                </div>
                <div class="text-[10px] text-slate-400">${p.team} • Bye ${p.bye || '-'} • ${p.tier}</div>
              </div>
            </div>
            <div class="flex items-center gap-4 text-right">
              <div>
                <div class="text-xs font-mono font-bold text-blue-400">${p.projPts.toFixed(1)} pts</div>
                <div class="text-[10px] text-slate-500 font-mono">Won for $${p.draftedPrice}</div>
              </div>
            </div>
          </div>
        `;
      } else {
        return `
          <div class="flex items-center justify-between p-3 rounded-xl bg-slate-950/40 border border-dashed border-slate-800 text-slate-500">
            <div class="flex items-center gap-3">
              <span class="w-16 text-[10px] font-bold uppercase text-slate-500 bg-slate-900 px-2 py-1 rounded text-center">${s.label.split(' ')[0]}</span>
              <span class="text-xs italic">Empty Starting Slot (${s.posReq})</span>
            </div>
            <span class="text-[10px] text-slate-600 font-mono">Min $1 reserved</span>
          </div>
        `;
      }
    }).join('');

    // Render Bench Slots (6)
    const benchContainer = document.getElementById('myteam-bench-slots');
    const benchSlots = [];
    for (let i = 0; i < 6; i++) {
      benchSlots.push(bench[i] || null);
    }

    benchContainer.innerHTML = benchSlots.map((p, i) => {
      if (p) {
        return `
          <div class="flex items-center justify-between p-2.5 rounded-xl bg-slate-900/80 border border-slate-700/60 text-xs">
            <div class="flex items-center gap-2">
              <span class="text-[10px] font-mono text-slate-500">BN${i + 1}</span>
              <span class="px-1.5 py-0.5 rounded text-[9px] font-extrabold uppercase badge-${p.pos.toLowerCase()}">${p.pos}</span>
              <span class="font-bold text-slate-200 cursor-pointer hover:text-blue-400" onclick="window.app.openPlayerModal('${p.id}')">${p.name}</span>
              <span class="text-[10px] text-slate-500">${p.team}</span>
            </div>
            <div class="text-right font-mono font-bold text-emerald-400">$${p.draftedPrice}</div>
          </div>
        `;
      } else {
        return `
          <div class="flex items-center justify-between p-2.5 rounded-xl bg-slate-950/30 border border-dashed border-slate-800 text-xs text-slate-600">
            <span>BN${i + 1} (Open Bench Spot)</span>
            <span class="text-[10px] text-slate-700 font-mono">Optional</span>
          </div>
        `;
      }
    }).join('');

    // Spending breakdown by position
    const spendingBreakdownEl = document.getElementById('myteam-spending-breakdown');
    const posTotals = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DST: 0 };
    const allDrafted = [...Object.values(starters).flat(), ...bench];
    allDrafted.forEach(p => {
      if (posTotals[p.pos] !== undefined) {
        posTotals[p.pos] += (p.draftedPrice || 0);
      }
    });

    spendingBreakdownEl.innerHTML = Object.entries(posTotals).map(([pos, amt]) => {
      const pct = budgetSpent > 0 ? Math.round((amt / budgetSpent) * 100) : 0;
      return `
        <div>
          <div class="flex items-center justify-between text-[11px] mb-1">
            <span class="font-bold text-slate-300">${pos}</span>
            <span class="font-mono text-slate-400">$${amt} (${pct}%)</span>
          </div>
          <div class="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
            <div class="bg-blue-500 h-full rounded-full" style="width: ${pct}%"></div>
          </div>
        </div>
      `;
    }).join('');
  }

  // --- TAB 4: ALL 12 TEAMS MATRIX ---

  renderAllTeams() {
    const container = document.getElementById('all-teams-grid');
    const rankingsContainer = document.getElementById('league-power-rankings-table');
    if (!container) return;

    const state = this.store.state;

    // Render League Power Rankings Table
    if (rankingsContainer) {
      const rankedTeams = state.teams.map(team => {
        const starters = team.roster.starters || {};
        const bench = team.roster.bench || [];
        const starterPlayers = Object.values(starters).flat();
        const starterPts = starterPlayers.reduce((sum, p) => sum + (p.projPts || 0), 0);
        const benchPts = bench.reduce((sum, p) => sum + (p.projPts || 0), 0);
        const totalPts = starterPts + benchPts;
        const totalDrafted = starterPlayers.length + bench.length;
        const spent = team.spent || 0;
        const remaining = team.budget - spent;

        return {
          team,
          isUser: team.id === state.userTeamId,
          starterPts,
          benchPts,
          totalPts,
          totalDrafted,
          spent,
          remaining
        };
      });

      // Sort: highest starterPts first (or totalPts if starters tied)
      rankedTeams.sort((a, b) => b.starterPts - a.starterPts || b.totalPts - a.totalPts);

      rankingsContainer.innerHTML = `
        <table class="w-full text-left text-xs border-collapse">
          <thead>
            <tr class="border-b border-slate-800 text-slate-400 font-semibold">
              <th class="py-2.5 px-3 w-14 text-center">Rank</th>
              <th class="py-2.5 px-3">Team Name</th>
              <th class="py-2.5 px-3 text-center">Roster Fill</th>
              <th class="py-2.5 px-3 text-right">Starter Proj</th>
              <th class="py-2.5 px-3 text-right">Bench Proj</th>
              <th class="py-2.5 px-3 text-right">Total Proj</th>
              <th class="py-2.5 px-3 text-right">Cash Left</th>
              <th class="py-2.5 px-3 text-center">Draft Grade</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-800/60 font-medium">
            ${rankedTeams.map((rt, idx) => {
              let grade = 'B';
              let gradeColor = 'text-slate-300 bg-slate-800 border-slate-700';

              if (rt.starterPts >= 1200) { grade = 'A+'; gradeColor = 'text-emerald-300 bg-emerald-950/60 border-emerald-700'; }
              else if (rt.starterPts >= 1050) { grade = 'A'; gradeColor = 'text-emerald-400 bg-emerald-950/40 border-emerald-800'; }
              else if (rt.starterPts >= 900) { grade = 'A-'; gradeColor = 'text-cyan-300 bg-cyan-950/40 border-cyan-800'; }
              else if (rt.starterPts >= 750) { grade = 'B+'; gradeColor = 'text-blue-300 bg-blue-950/40 border-blue-800'; }
              else if (rt.starterPts >= 600) { grade = 'B'; gradeColor = 'text-slate-300 bg-slate-800 border-slate-700'; }
              else if (rt.starterPts >= 400) { grade = 'C+'; gradeColor = 'text-amber-300 bg-amber-950/40 border-amber-800'; }
              else { grade = 'Drafting...'; gradeColor = 'text-slate-500 bg-slate-900 border-slate-800'; }

              return `
                <tr class="hover:bg-slate-900/60 transition-colors ${rt.isUser ? 'bg-blue-950/30' : ''}">
                  <td class="py-2.5 px-3 text-center font-mono font-bold ${idx === 0 ? 'text-amber-400' : idx === 1 ? 'text-slate-300' : idx === 2 ? 'text-amber-600' : 'text-slate-500'}">
                    ${idx === 0 ? '🥇 1' : idx === 1 ? '🥈 2' : idx === 2 ? '🥉 3' : `#${idx + 1}`}
                  </td>
                  <td class="py-2.5 px-3">
                    <span class="font-bold cursor-pointer hover:underline ${rt.isUser ? 'text-blue-300' : 'text-slate-200'}" onclick="window.app.openTeamModal(${rt.team.id})">${rt.team.name}</span>
                    ${rt.isUser ? '<span class="text-[9px] font-bold bg-blue-500 text-white px-1.5 py-0.2 rounded ml-1.5 shadow-sm">MY TEAM</span>' : ''}
                  </td>
                  <td class="py-2.5 px-3 text-center font-mono text-slate-400">${rt.totalDrafted}/15</td>
                  <td class="py-2.5 px-3 text-right font-mono font-bold text-blue-400">${rt.starterPts.toFixed(1)}</td>
                  <td class="py-2.5 px-3 text-right font-mono text-slate-400">${rt.benchPts.toFixed(1)}</td>
                  <td class="py-2.5 px-3 text-right font-mono font-bold text-emerald-400">${rt.totalPts.toFixed(1)}</td>
                  <td class="py-2.5 px-3 text-right font-mono text-slate-300 font-bold">$${rt.remaining}</td>
                  <td class="py-2.5 px-3 text-center">
                    <span class="px-2 py-0.5 rounded text-[10px] font-extrabold border ${gradeColor}">${grade}</span>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      `;
    }

    container.innerHTML = state.teams.map(team => {
      const isUser = team.id === state.userTeamId;
      const spent = team.spent || 0;
      const remaining = team.budget - spent;
      const maxBid = this.engine.calculateMaxBid(team);
      const openStarters = this.engine.getOpenStartingSpots(team.roster);
      const totalRostered = this.engine.getTotalRosterCount(team.roster);

      const starters = team.roster.starters || {};
      const allPlayers = [...Object.values(starters).flat(), ...(team.roster.bench || [])];
      const totalProjPts = allPlayers.reduce((s, p) => s + (p.projPts || 0), 0);

      return `
        <div class="glass-panel rounded-2xl p-4 border ${isUser ? 'border-blue-500/60 shadow-lg shadow-blue-500/10' : 'border-slate-800'} space-y-3 cursor-pointer hover:border-slate-600 transition-all" onclick="window.app.openTeamModal(${team.id})">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <h3 class="font-bold text-sm text-white ${isUser ? 'text-blue-300' : ''}">${team.name}</h3>
              ${isUser ? '<span class="text-[10px] font-extrabold bg-blue-500 text-white px-1.5 py-0.5 rounded shadow-sm">MY TEAM</span>' : ''}
            </div>
            <div class="flex items-center gap-1.5">
              ${!isUser ? `<button onclick="event.stopPropagation(); window.app.selectAsMyTeam(${team.id})" class="text-[10px] text-slate-400 hover:text-blue-300 bg-slate-800/80 hover:bg-blue-950 px-2 py-0.5 rounded border border-slate-700 transition-all">Make My Team</button>` : ''}
              <button onclick="event.stopPropagation(); window.app.promptEditTeamName(${team.id})" class="text-slate-500 hover:text-slate-300 p-1" title="Rename Team">
                <i data-lucide="edit-3" class="w-3.5 h-3.5"></i>
              </button>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-2 text-xs">
            <div class="bg-slate-950 p-2 rounded-xl border border-slate-800 text-center">
              <div class="text-[10px] text-slate-400 uppercase">Cash Left</div>
              <div class="text-sm font-black font-mono text-emerald-400 mt-0.5">$${remaining}</div>
            </div>
            <div class="bg-slate-950 p-2 rounded-xl border border-slate-800 text-center">
              <div class="text-[10px] text-slate-400 uppercase">Max Bid</div>
              <div class="text-sm font-black font-mono text-amber-400 mt-0.5">$${maxBid}</div>
            </div>
          </div>

          <div class="space-y-1.5 text-xs text-slate-300 pt-1">
            <div class="flex items-center justify-between text-[11px]">
              <span class="text-slate-400">Roster Progress:</span>
              <span class="font-mono font-bold">${totalRostered}/15 (${9 - openStarters}/9 Starters)</span>
            </div>
            <div class="flex items-center justify-between text-[11px]">
              <span class="text-slate-400">Total Proj Points:</span>
              <span class="font-mono font-bold text-blue-400">${totalProjPts.toFixed(1)} pts</span>
            </div>
          </div>

          <!-- Roster Tags -->
          <div class="flex flex-wrap gap-1 pt-1 border-t border-slate-800/80">
            ${allPlayers.slice(0, 6).map(p => `
              <span class="text-[9px] px-1.5 py-0.5 rounded font-bold badge-${p.pos.toLowerCase()}">${p.pos} $${p.draftedPrice}</span>
            `).join('')}
            ${allPlayers.length > 6 ? `<span class="text-[9px] text-slate-500 font-mono">+${allPlayers.length - 6} more</span>` : ''}
          </div>
        </div>
      `;
    }).join('');
  }

  // --- TAB 5: ROOKIE HUB ---

  renderRookieHub() {
    const container = document.getElementById('rookie-cards-grid');
    if (!container) return;

    const rookies = this.store.state.rookies || [];
    const searchInput = document.getElementById('rookie-search-input');
    const hideDraftedInput = document.getElementById('rookie-hide-drafted');
    const availableCountEl = document.getElementById('rookie-available-count');
    const q = searchInput ? searchInput.value.trim().toLowerCase() : '';
    const hideDrafted = hideDraftedInput ? hideDraftedInput.checked : false;

    // Create lookup map to master player pool and teams
    const playerMap = new Map(this.store.state.players.map(p => [p.name.toLowerCase().trim(), p]));
    const teamMap = new Map(this.store.state.teams.map(t => [t.id, t]));

    // Count undrafted rookies
    const undraftedRookies = rookies.filter(r => {
      const p = playerMap.get(r.name.toLowerCase().trim());
      return !p || !p.drafted;
    });

    if (availableCountEl) {
      availableCountEl.textContent = `${undraftedRookies.length}/${rookies.length} Available`;
    }

    let filtered = rookies;
    if (hideDrafted) {
      filtered = filtered.filter(r => {
        const p = playerMap.get(r.name.toLowerCase().trim());
        return !p || !p.drafted;
      });
    }

    if (q) {
      filtered = filtered.filter(r => 
        r.name.toLowerCase().includes(q) ||
        r.team.toLowerCase().includes(q) ||
        r.pos.toLowerCase().includes(q) ||
        (r.notes && r.notes.toLowerCase().includes(q))
      );
    }

    if (filtered.length === 0) {
      container.innerHTML = '<div class="col-span-3 text-center py-10 text-slate-500 text-xs">No rookies match your filter.</div>';
      return;
    }

    container.innerHTML = filtered.map(r => {
      const p = playerMap.get(r.name.toLowerCase().trim());
      const isDrafted = p && p.drafted;
      const winningTeam = isDrafted ? teamMap.get(p.draftedTeamId) : null;
      const posClass = `badge-${r.pos.toLowerCase()}`;
      const cardBg = isDrafted ? 'bg-slate-950/40 border-slate-800/60 opacity-60' : 'glass-panel border-slate-800';

      return `
        <div class="${cardBg} rounded-2xl p-4 border space-y-3 relative overflow-hidden transition-all">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="font-mono text-xs text-amber-400 font-black">#${r.rookieRank}</span>
              <span class="px-2 py-0.5 rounded text-[10px] font-extrabold uppercase ${posClass}">${r.pos}</span>
              <h3 class="font-bold text-sm text-white ${isDrafted ? 'line-through text-slate-400' : ''}">${r.name}</h3>
            </div>
            <span class="text-[10px] font-semibold text-slate-400 font-mono">${r.team} • Bye ${r.bye || '-'}</span>
          </div>

          <div class="grid grid-cols-3 gap-2 text-center text-xs">
            <div class="bg-slate-950 p-2 rounded-xl border border-slate-800">
              <div class="text-[9px] text-slate-400 uppercase">Baseline $</div>
              <div class="font-bold font-mono text-slate-200 mt-0.5">$${r.baselineVal}</div>
            </div>
            <div class="bg-slate-950 p-2 rounded-xl border border-slate-800">
              <div class="text-[9px] text-slate-400 uppercase">Target Range</div>
              <div class="font-bold font-mono text-emerald-400 mt-0.5 text-[11px]">${r.targetRange || `$${r.baselineVal}`}</div>
            </div>
            <div class="bg-slate-950 p-2 rounded-xl border border-slate-800">
              <div class="text-[9px] text-slate-400 uppercase">Proj Pts</div>
              <div class="font-bold font-mono text-blue-400 mt-0.5">${r.projPts}</div>
            </div>
          </div>

          <div class="bg-slate-950/70 p-3 rounded-xl border border-slate-800/80 text-[11px] text-slate-300 space-y-1">
            <div class="text-slate-400 font-semibold">Scheme & Role: <b class="text-slate-200">${r.role || r.offense || 'Rookie weapon'}</b></div>
            <p class="text-slate-300 leading-relaxed italic">"${r.notes || 'Elite rookie prospect.'}"</p>
          </div>

          <div class="flex items-center justify-between pt-1">
            <span class="text-[10px] font-bold text-amber-400 bg-amber-950/40 px-2 py-0.5 rounded border border-amber-800/60">${r.tier}</span>
            ${isDrafted 
              ? `<span class="text-[11px] font-bold text-slate-400 bg-slate-800/90 border border-slate-700 px-3 py-1.5 rounded-xl flex items-center gap-1.5">
                  <i data-lucide="check" class="w-3.5 h-3.5 text-emerald-400"></i> Won for $${p.draftedPrice} by ${winningTeam ? winningTeam.name : 'Team'}
                 </span>`
              : `<button onclick="window.app.quickNominateByName('${r.name}')" class="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl shadow-sm transition-all flex items-center gap-1">
                  <i data-lucide="gavel" class="w-3 h-3"></i> Nominate for Bid
                 </button>`
            }
          </div>
        </div>
      `;
    }).join('');

    if (window.lucide) window.lucide.createIcons();
  }

  // --- SEARCH DROPDOWN ---
  renderSearchDropdown(q) {
    const dropdown = document.getElementById('search-dropdown');
    if (!dropdown) return;

    if (!q) {
      dropdown.classList.add('hidden');
      return;
    }

    const matches = this.store.state.players.filter(p => 
      p.name.toLowerCase().includes(q) ||
      p.team.toLowerCase().includes(q) ||
      p.pos.toLowerCase().includes(q)
    ).slice(0, 8);

    if (matches.length === 0) {
      dropdown.innerHTML = '<div class="p-3 text-xs text-slate-500 text-center">No matching players found.</div>';
      dropdown.classList.remove('hidden');
      return;
    }

    dropdown.innerHTML = matches.map(p => `
      <div class="flex items-center justify-between p-2.5 hover:bg-slate-800/80 cursor-pointer border-b border-slate-800/60 last:border-0 text-xs transition-colors" onclick="window.app.selectSearchPlayer('${p.id}')">
        <div class="flex items-center gap-2">
          <span class="font-extrabold text-[10px] px-1.5 py-0.5 rounded badge-${p.pos.toLowerCase()}">${p.pos}</span>
          <span class="font-bold text-slate-100">${p.name}</span>
          <span class="text-[10px] text-slate-400">${p.team} • Bye ${p.bye || '-'}</span>
          ${p.drafted ? '<span class="text-[9px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded">Drafted</span>' : ''}
        </div>
        <div class="flex items-center gap-3">
          <span class="font-mono font-bold text-emerald-400">$${p.baselineVal}</span>
          <span class="font-mono text-blue-400 text-[11px]">${p.projPts.toFixed(1)} pts</span>
        </div>
      </div>
    `).join('');

    dropdown.classList.remove('hidden');
  }

  selectSearchPlayer(playerId) {
    const dropdown = document.getElementById('search-dropdown');
    const searchInput = document.getElementById('global-search-input');
    dropdown?.classList.add('hidden');
    if (searchInput) searchInput.value = '';
    this.openPlayerModal(playerId);
  }

  // --- ACTIONS & MODALS ---

  async handleServerShutdown() {
    if (!confirm('Are you sure you want to stop the local web server? All draft data in your browser is automatically saved.')) {
      return;
    }

    try {
      await fetch('/api/shutdown');
    } catch (e) {}

    document.body.innerHTML = `
      <div class="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-center space-y-4 font-sans text-slate-200">
        <div class="w-16 h-16 rounded-2xl bg-rose-950/60 border border-rose-800 flex items-center justify-center text-rose-400 text-2xl font-black">
          🛑
        </div>
        <h2 class="text-xl font-bold text-white">Server Stopped Cleanly</h2>
        <p class="text-xs text-slate-400 max-w-sm">
          The local server has been shut down. Your draft progress is saved in local storage. You can safely close this browser window.
        </p>
        <div class="pt-2">
          <span class="text-[11px] text-slate-500 font-mono">To start again later, run start.bat</span>
        </div>
      </div>
    `;
  }

  openPlayerModal(playerId) {
    const player = this.store.state.players.find(p => p.id === playerId);
    if (!player) return;

    const modal = document.getElementById('player-modal');
    const content = document.getElementById('player-modal-content');
    const inflation = this.engine.calculateInflation(this.store.state.players, this.store.state.teams);
    const dynVal = this.engine.getDynamicPlayerValue(player, inflation.inflationRate);
    const userTeam = this.store.getUserTeam();
    const advice = this.engine.getBiddingAdvice(player, userTeam, inflation.inflationRate);

    content.innerHTML = `
      <div class="space-y-4">
        <div class="flex items-center justify-between border-b border-slate-800 pb-3">
          <div class="flex items-center gap-3">
            <span class="px-3 py-1 rounded-xl text-xs font-black uppercase badge-${player.pos.toLowerCase()}">${player.pos}</span>
            <div>
              <h2 class="text-xl font-black text-white">${player.name}</h2>
              <div class="text-xs text-slate-400 flex items-center gap-2">
                <span class="font-bold text-slate-300">${player.team}</span>
                <span>•</span>
                <span>Bye Week ${player.bye || 'None'}</span>
                <span>•</span>
                <span class="text-amber-400 font-semibold">${player.tier}</span>
                <span>•</span>
                <span>Pos Rank: <b class="text-slate-200">${player.posRank}</b></span>
              </div>
            </div>
          </div>
          <div class="text-right">
            <div class="text-[10px] text-slate-400 uppercase font-semibold">Proj Points</div>
            <div class="text-xl font-black font-mono text-blue-400">${player.projPts.toFixed(1)}</div>
          </div>
        </div>

        <div class="grid grid-cols-4 gap-3 text-center">
          <div class="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
            <div class="text-[10px] text-slate-400 uppercase">Baseline $</div>
            <div class="text-base font-bold font-mono text-slate-200">$${player.baselineVal}</div>
          </div>
          <div class="bg-slate-950 p-2.5 rounded-xl border border-blue-900/50">
            <div class="text-[10px] text-blue-400 uppercase">Dynamic $</div>
            <div class="text-base font-black font-mono text-emerald-400">$${dynVal}</div>
          </div>
          <div class="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
            <div class="text-[10px] text-slate-400 uppercase">Target Range</div>
            <div class="text-sm font-bold font-mono text-slate-200">${player.targetRange || `$${player.baselineVal}`}</div>
          </div>
          <div class="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
            <div class="text-[10px] text-slate-400 uppercase">Hard Max</div>
            <div class="text-base font-bold font-mono text-amber-400">$${player.hardMax}</div>
          </div>
        </div>

        <div class="bg-slate-950 p-4 rounded-xl border border-slate-800 text-xs space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-slate-400">Health & Injury Status:</span>
            ${(() => {
              const cached = this.gemini.getCachedNews(player.id, player.name);
              const inj = (cached && cached.injuryStatus) ? cached.injuryStatus : (player.injury || 'Healthy');
              const isInj = inj.toLowerCase().includes('out') || inj.toLowerCase().includes('ir') || inj.toLowerCase().includes('elevated') || inj.toLowerCase().includes('quest') || inj.toLowerCase().includes('risk');
              return isInj 
                ? `<span class="px-2 py-0.5 rounded text-[10px] font-black bg-rose-500/20 text-rose-300 border border-rose-500/40">⚠️ ${inj}</span>`
                : `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">🟢 100% Healthy / Active</span>`;
            })()}
          </div>
          <div class="text-slate-400">Team Offense & Quality: <b class="text-slate-200">${player.offense || 'Standard'}</b></div>
          <div class="text-slate-400">Projected Role & Usage: <b class="text-slate-200">${player.role || 'Key contributor'}</b></div>
          <div class="pt-1 text-slate-300 leading-relaxed border-t border-slate-800 italic">
            "${player.notes || 'High efficiency profile.'}"
          </div>
        </div>

        ${(() => {
          const cached = this.gemini.getCachedNews(player.id, player.name);
          if (!cached) {
            // If AI is configured, trigger automatic fetch for this player when opened!
            if (this.gemini.isConfigured() && !this.gemini.isCircuitBroken) {
              setTimeout(() => {
                this.gemini.fetchPlayerNews(player, false).then(() => {
                  const modal = document.getElementById('player-detail-modal');
                  if (modal && !modal.classList.contains('hidden')) {
                    this.openPlayerModal(player.id);
                  }
                }).catch(() => {});
              }, 10);
            }
            return `
              <div class="p-3 rounded-xl bg-indigo-950/20 border border-indigo-500/20 text-xs flex items-center justify-between text-indigo-300">
                <span class="flex items-center gap-1.5"><i data-lucide="sparkles" class="w-3.5 h-3.5 text-indigo-400 animate-spin"></i> Loading AI Scout & Beat Wire...</span>
              </div>
            `;
          }
          const isInj = cached.injuryStatus && (cached.injuryStatus.toLowerCase().includes('out') || cached.injuryStatus.toLowerCase().includes('ir') || cached.injuryStatus.toLowerCase().includes('elevated') || cached.injuryStatus.toLowerCase().includes('quest') || cached.injuryStatus.toLowerCase().includes('risk'));
          return `
            <div class="p-3.5 rounded-xl ${isInj ? 'bg-rose-950/40 border border-rose-600/50' : 'bg-indigo-950/30 border border-indigo-500/30'} text-xs space-y-1.5">
              <div class="flex items-center justify-between">
                <span class="font-black text-indigo-300 flex items-center gap-1"><i data-lucide="sparkles" class="w-3.5 h-3.5 text-indigo-400"></i> AI Scouting & Health Intel (${cached.source || 'AI'})</span>
                <span class="text-[10px] font-mono text-slate-400">Status: <b class="${isInj ? 'text-rose-300 font-bold' : 'text-emerald-300'}">${cached.injuryStatus || 'Healthy'}</b></span>
              </div>
              <div class="font-bold text-slate-100">${cached.headline || ''}</div>
              <p class="text-slate-300 text-[11px] leading-relaxed">${cached.summary || ''}</p>
              <div class="text-[11px] text-indigo-200 pt-1 border-t border-indigo-500/20 flex items-center gap-1.5">
                <i data-lucide="crosshair" class="w-3 h-3 text-indigo-400 shrink-0"></i>
                <span><b>Advice:</b> ${cached.auctionAdvice || ''}</span>
              </div>
            </div>
          `;
        })()}

        <div class="p-3 rounded-xl border ${advice.badgeClass} text-xs flex items-center justify-between">
          <span><b>Strategy Advice:</b> ${advice.message}</span>
          <span class="font-mono font-bold text-amber-400 shrink-0">Your Max: $${advice.userMaxBid}</span>
        </div>

        <div class="flex items-center justify-between pt-2 border-t border-slate-800">
          <div class="flex items-center gap-2">
            <button onclick="window.app.toggleStar('${player.id}')" class="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs font-semibold rounded-xl flex items-center gap-1.5 text-slate-300">
              <i data-lucide="star" class="w-3.5 h-3.5 ${player.isStarred ? 'fill-amber-400 text-amber-400' : ''}"></i>
              ${player.isStarred ? 'Starred Target' : 'Star Target'}
            </button>
            <button onclick="window.app.toggleDND('${player.id}')" class="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs font-semibold rounded-xl flex items-center gap-1.5 ${player.isDND ? 'text-rose-400' : 'text-slate-400'}">
              <i data-lucide="skull" class="w-3.5 h-3.5"></i>
              ${player.isDND ? 'Do Not Draft (Active)' : 'Mark DND'}
            </button>
          </div>

          <div class="flex items-center gap-2">
            ${player.drafted 
              ? '<span class="text-xs text-slate-400 font-mono">Player Already Drafted</span>' 
              : `<button onclick="window.app.quickNominatePlayer('${player.id}'); window.app.closeModals();" class="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl shadow-lg shadow-blue-600/30">
                  Nominate for Auction
                 </button>`
            }
          </div>
        </div>
      </div>
    `;

    modal?.classList.remove('hidden');
    modal?.classList.add('flex');
    if (window.lucide) window.lucide.createIcons();
  }

  openTeamModal(teamId) {
    const team = this.store.state.teams.find(t => t.id === teamId);
    if (!team) return;

    const modal = document.getElementById('team-modal');
    const content = document.getElementById('team-modal-content');
    const spent = team.spent || 0;
    const remaining = team.budget - spent;
    const maxBid = this.engine.calculateMaxBid(team);
    const starters = team.roster.starters || {};
    const bench = team.roster.bench || [];
    const allPlayers = [...Object.values(starters).flat(), ...bench];

    content.innerHTML = `
      <div class="space-y-4">
        <div class="flex items-center justify-between border-b border-slate-800 pb-3">
          <div>
            <h2 class="text-xl font-bold text-white">${team.name}</h2>
            <div class="text-xs text-slate-400">Total Rostered: ${allPlayers.length}/15 Players</div>
          </div>
          <div class="text-right">
            <div class="text-xs text-slate-400">Remaining Budget</div>
            <div class="text-xl font-mono font-black text-emerald-400">$${remaining} <span class="text-xs text-slate-400 font-normal">(Max Bid $${maxBid})</span></div>
          </div>
        </div>

        <div class="space-y-2 max-h-96 overflow-y-auto pr-1">
          <div class="text-xs font-bold text-slate-400 uppercase tracking-wider">Drafted Lineup</div>
          ${allPlayers.length === 0 ? '<div class="text-xs text-slate-500 py-4 text-center">No players drafted yet by this team.</div>' : ''}
          ${allPlayers.map(p => `
            <div class="flex items-center justify-between p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs">
              <div class="flex items-center gap-2.5">
                <span class="px-1.5 py-0.5 rounded text-[10px] font-extrabold uppercase badge-${p.pos.toLowerCase()}">${p.pos}</span>
                <span class="font-bold text-slate-200">${p.name}</span>
                <span class="text-[10px] text-slate-500">${p.team} • Bye ${p.bye || '-'}</span>
              </div>
              <div class="flex items-center gap-3">
                <span class="font-mono text-blue-400">${p.projPts.toFixed(1)} pts</span>
                <span class="font-mono font-bold text-emerald-400">$${p.draftedPrice}</span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    modal?.classList.remove('hidden');
    modal?.classList.add('flex');
  }

  // --- GEMINI AI LIVE NEWS & INTELLIGENCE ---

  renderGeminiNewsCard(player) {
    if (!this.gemini.isConfigured()) {
      return `
        <div class="flex items-center justify-between gap-3 text-xs">
          <div class="flex items-center gap-2 text-indigo-300">
            <i data-lucide="sparkles" class="w-4 h-4 text-indigo-400"></i>
            <span><b>Draft AI News:</b> Enable real-time breaking news & scouting intel (Gemini or Local Model).</span>
          </div>
          <button onclick="window.app.openGeminiModal()" class="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-bold text-[11px] shrink-0 shadow-sm">
            Configure AI
          </button>
        </div>
      `;
    }

    // Circuit Breaker: 3 consecutive failures reached -> Halt looping
    if (this.gemini.isCircuitBroken) {
      return `
        <div class="flex items-center justify-between gap-3 text-xs bg-rose-950/30 p-2.5 rounded-lg border border-rose-800/60">
          <div class="flex items-center gap-2 text-rose-300">
            <i data-lucide="alert-octagon" class="w-4 h-4 text-rose-400 shrink-0"></i>
            <span><b>AI News Paused:</b> 3 consecutive request failures. Auto-retries stopped to prevent looping.</span>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <button onclick="window.app.gemini.resetFailures(); window.app.fetchGeminiNewsForNomination(window.app.store.state.currentNomination.player, true);" class="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-bold rounded-lg border border-slate-700">
              Retry
            </button>
            <button onclick="window.app.openGeminiModal()" class="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-bold rounded-lg shadow-sm">
              Settings
            </button>
          </div>
        </div>
      `;
    }

    if (this.isLoadingNews) {
      const providerLabel = this.gemini.provider === 'local' ? `Local ${this.gemini.localModel}` : 'Gemini';
      return `
        <div class="flex items-center gap-3 text-xs text-indigo-300 py-1">
          <div class="animate-spin rounded-full h-4 w-4 border-2 border-indigo-400 border-t-transparent"></div>
          <span class="italic font-medium">${providerLabel} is generating scouting intel & status for ${player.name}...</span>
        </div>
      `;
    }

    const news = this.activeNominationNews || this.gemini.getCachedNews(player.id);

    if (this.isLoadingNews) {
      const providerLabel = this.gemini.provider === 'local' ? `Local ${this.gemini.localModel}` : 'Gemini Live Intel';
      
      // If we already have preloaded news, display it immediately with an active live rerun badge!
      if (news) {
        const isRising = news.draftSentiment === 'RISING';
        const isFalling = news.draftSentiment === 'FALLING';
        const sentimentBadge = isRising 
          ? '<span class="px-2 py-0.5 rounded text-[10px] font-extrabold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">🔥 STOCK RISING</span>'
          : isFalling 
          ? '<span class="px-2 py-0.5 rounded text-[10px] font-extrabold bg-rose-500/20 text-rose-300 border border-rose-500/30 flex items-center gap-1">⚠️ RISK / FALLING</span>'
          : '<span class="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">🟢 STEADY</span>';

        const injuryStr = news.injuryStatus || 'Healthy';
        const isInjured = injuryStr.toLowerCase().includes('out') || injuryStr.toLowerCase().includes('ir') || injuryStr.toLowerCase().includes('elevated') || injuryStr.toLowerCase().includes('quest') || injuryStr.toLowerCase().includes('risk');

        const healthStatusPill = isInjured 
          ? `<span class="px-2 py-0.5 rounded text-[10px] font-black bg-rose-500/20 text-rose-300 border border-rose-500/40 flex items-center gap-1 animate-pulse"><i data-lucide="alert-triangle" class="w-3 h-3 text-rose-400"></i> ${injuryStr}</span>`
          : `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1"><i data-lucide="check-circle-2" class="w-3 h-3 text-emerald-400"></i> 100% Healthy</span>`;

        return `
          <div class="space-y-2 text-xs">
            <div class="flex items-center justify-between flex-wrap gap-2 border-b border-indigo-500/20 pb-2">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-indigo-400 font-bold flex items-center gap-1 text-[11px] uppercase tracking-wider"><i data-lucide="sparkles" class="w-3.5 h-3.5 inline text-indigo-300"></i> Preloaded Intel</span>
                ${healthStatusPill}
                ${sentimentBadge}
              </div>
              <div class="flex items-center gap-2">
                <span class="text-[10px] text-indigo-300 font-mono font-bold flex items-center gap-1.5 bg-indigo-950/80 px-2.5 py-1 rounded-lg border border-indigo-500/40 animate-pulse shadow-sm">
                  <i data-lucide="refresh-cw" class="w-3 h-3 animate-spin text-indigo-400"></i> Rerunning Live Beat Wire...
                </span>
              </div>
            </div>

            <div class="text-sm font-extrabold text-white">
              ${news.headline}
            </div>

            <p class="text-slate-300 text-xs leading-relaxed">
              ${news.summary}
            </p>

            <div class="p-2 rounded-lg bg-indigo-950/60 border border-indigo-500/30 text-indigo-200 text-xs flex items-center gap-2">
              <i data-lucide="crosshair" class="w-3.5 h-3.5 text-indigo-400 shrink-0"></i>
              <span><b>Draft Impact:</b> ${news.auctionAdvice}</span>
            </div>
          </div>
        `;
      }

      return `
        <div class="flex items-center gap-3 text-xs text-indigo-300 py-2">
          <div class="animate-spin rounded-full h-4 w-4 border-2 border-indigo-400 border-t-transparent"></div>
          <span class="italic font-medium">${providerLabel} is pulling real-time beat news & practice reports for ${player.name}...</span>
        </div>
      `;
    }

    if (!news) {
      if (this.gemini.attemptedPlayerIds.has(player.id)) {
        return `
          <div class="flex items-center justify-between text-xs text-slate-400 py-1">
            <span>News unavailable for ${player.name} (${this.gemini.consecutiveFailures}/3 failures).</span>
            <button onclick="window.app.fetchGeminiNewsForNomination(window.app.store.state.currentNomination.player, true)" class="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-[11px]">
              Try Again
            </button>
          </div>
        `;
      }

      setTimeout(() => this.fetchGeminiNewsForNomination(player, true), 50);
      return `
        <div class="flex items-center justify-between text-xs text-indigo-300 py-1">
          <div class="flex items-center gap-2">
            <i data-lucide="sparkles" class="w-4 h-4 text-indigo-400"></i>
            <span>Connecting to AI for real-time news & injury status...</span>
          </div>
          <button onclick="window.app.fetchGeminiNewsForNomination(window.app.store.state.currentNomination.player, true)" class="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-bold text-[11px]">
            ⚡ Fetch Live Intel
          </button>
        </div>
      `;
    }

    const isRising = news.draftSentiment === 'RISING';
    const isFalling = news.draftSentiment === 'FALLING';
    const sentimentBadge = isRising 
      ? '<span class="px-2 py-0.5 rounded text-[10px] font-extrabold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">🔥 STOCK RISING</span>'
      : isFalling 
      ? '<span class="px-2 py-0.5 rounded text-[10px] font-extrabold bg-rose-500/20 text-rose-300 border border-rose-500/30 flex items-center gap-1">⚠️ RISK / FALLING</span>'
      : '<span class="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">🟢 STEADY</span>';

    const providerBadge = this.gemini.provider === 'local' 
      ? `<span class="text-emerald-400 font-bold flex items-center gap-1 text-[11px] uppercase tracking-wider"><i data-lucide="cpu" class="w-3.5 h-3.5 inline text-emerald-300"></i> Local ${this.gemini.localModel}</span>`
      : `<span class="text-indigo-400 font-bold flex items-center gap-1 text-[11px] uppercase tracking-wider"><i data-lucide="sparkles" class="w-3.5 h-3.5 inline text-indigo-300"></i> Gemini Live News</span>`;

    const injuryStr = news.injuryStatus || 'Healthy';
    const isInjured = injuryStr.toLowerCase().includes('out') || injuryStr.toLowerCase().includes('ir') || injuryStr.toLowerCase().includes('elevated') || injuryStr.toLowerCase().includes('quest') || injuryStr.toLowerCase().includes('risk');

    const healthStatusPill = isInjured 
      ? `<span class="px-2 py-0.5 rounded text-[10px] font-black bg-rose-500/20 text-rose-300 border border-rose-500/40 flex items-center gap-1 animate-pulse"><i data-lucide="alert-triangle" class="w-3 h-3 text-rose-400"></i> ${injuryStr}</span>`
      : `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1"><i data-lucide="check-circle-2" class="w-3 h-3 text-emerald-400"></i> 100% Healthy</span>`;

    const isFresh = Boolean(this.activeNominationNews);

    return `
      <div class="space-y-2 text-xs">
        <div class="flex items-center justify-between flex-wrap gap-2 border-b border-indigo-500/20 pb-2">
          <div class="flex items-center gap-2 flex-wrap">
            ${providerBadge}
            ${healthStatusPill}
            ${sentimentBadge}
            ${isFresh ? '<span class="text-[10px] text-emerald-300 font-bold font-mono bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-700/60 flex items-center gap-1"><i data-lucide="zap" class="w-3 h-3 text-emerald-400"></i> Live Wire Verified</span>' : ''}
          </div>
          <div class="flex items-center gap-2">
            <span class="text-[10px] text-slate-500">${news.source || 'Live Beat Reporter'}</span>
            <button onclick="window.app.fetchGeminiNewsForNomination(window.app.store.state.currentNomination.player, true)" class="text-slate-400 hover:text-indigo-300 p-1 rounded transition-all flex items-center gap-1" title="Rerun Live News">
              <i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i> <span class="text-[10px] hidden sm:inline">Rerun</span>
            </button>
          </div>
        </div>

        ${isInjured ? `
          <div class="p-2.5 rounded-lg bg-rose-950/70 border border-rose-600/70 text-rose-200 text-xs flex items-start gap-2 shadow-sm">
            <i data-lucide="alert-octagon" class="w-4 h-4 text-rose-400 shrink-0 mt-0.5 animate-bounce"></i>
            <div>
              <span class="font-black uppercase tracking-wider text-rose-300">⚠️ CRITICAL INJURY WARNING:</span>
              <span class="text-rose-100 font-medium"> ${news.summary}</span>
            </div>
          </div>
        ` : ''}

        <div class="text-sm font-extrabold text-white">
          ${news.headline}
        </div>

        <p class="text-slate-300 text-xs leading-relaxed">
          ${news.summary}
        </p>

        <div class="p-2 rounded-lg bg-indigo-950/60 border border-indigo-500/30 text-indigo-200 text-xs flex items-center gap-2">
          <i data-lucide="crosshair" class="w-3.5 h-3.5 text-indigo-400 shrink-0"></i>
          <span><b>Draft Impact:</b> ${news.auctionAdvice}</span>
        </div>

        ${news.searchSources && news.searchSources.length > 0 ? `
          <div class="flex items-center gap-2 text-[10px] text-slate-500 pt-0.5">
            <span>Sources:</span>
            ${news.searchSources.map(s => `<a href="${s.uri}" target="_blank" class="text-indigo-400 hover:underline truncate max-w-[140px]">${s.title}</a>`).join(' • ')}
          </div>
        ` : ''}
      </div>
    `;
  }

  async fetchGeminiNewsForNomination(player, forceRefresh = false) {
    if (!player || this.isLoadingNews) return;
    if (this.gemini.isCircuitBroken && !forceRefresh) return;

    this.isLoadingNews = true;
    const container = document.getElementById('nomination-gemini-news-container');
    if (container) {
      container.innerHTML = this.renderGeminiNewsCard(player);
      if (window.lucide) window.lucide.createIcons();
    }

    try {
      const news = await this.gemini.fetchPlayerNews(player, forceRefresh);
      this.activeNominationNews = news;
    } catch (e) {
      console.warn('Error fetching Gemini news:', e);
      if (this.gemini.isCircuitBroken) {
        this.showToast('Gemini paused after 3 consecutive failures.', 'error');
      } else if (e.message !== 'NO_API_KEY') {
        this.showToast(`Gemini error (${this.gemini.consecutiveFailures}/3): ${e.message}`, 'error');
      }
    } finally {
      this.isLoadingNews = false;
      // Re-render nomination card with updated status and advice
      if (this.store.state.currentNomination && this.store.state.currentNomination.playerId === player.id) {
        this.renderActiveNomination();
      } else if (container) {
        container.innerHTML = this.renderGeminiNewsCard(player);
        if (window.lucide) window.lucide.createIcons();
      }
    }
  }

  openGeminiModal() {
    const modal = document.getElementById('gemini-modal');
    const input = document.getElementById('gemini-api-key-input');
    const localUrlInput = document.getElementById('local-ai-url-input');
    const localModelSelect = document.getElementById('local-ai-model-select');
    const statusText = document.getElementById('gemini-modal-key-status');

    const isLocalHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const providerTabsContainer = document.getElementById('ai-provider-tabs-container');
    const localSection = document.getElementById('ai-section-local');

    if (!isLocalHost) {
      if (providerTabsContainer) providerTabsContainer.classList.add('hidden');
      if (localSection) localSection.classList.add('hidden');
      document.getElementById('ai-tab-gemini')?.click();
    } else {
      if (providerTabsContainer) providerTabsContainer.classList.remove('hidden');
      this.loadOllamaModels();
      if (this.gemini.provider === 'local') {
        document.getElementById('ai-tab-local')?.click();
      } else {
        document.getElementById('ai-tab-gemini')?.click();
      }
    }

    if (input) input.value = this.gemini.getApiKey();
    if (localUrlInput) localUrlInput.value = this.gemini.localUrl;

    const clearBtn = document.getElementById('btn-clear-gemini-key');
    if (clearBtn) {
      if (this.gemini.hasApiKey()) {
        clearBtn.classList.remove('hidden');
      } else {
        clearBtn.classList.add('hidden');
      }
    }

    if (statusText) {
      if (this.gemini.hasApiKey()) {
        statusText.textContent = '⚠️ Overridden by Client Key';
        statusText.className = 'font-semibold text-amber-400';
      } else if (this.auth?.hasServerGeminiKey || this.gemini?.hasServerKey) {
        statusText.textContent = '🔒 Active via Vercel Environment (Server)';
        statusText.className = 'font-semibold text-emerald-400';
      } else {
        statusText.textContent = '❌ Not configured';
        statusText.className = 'font-semibold text-slate-400';
      }
    }

    modal?.classList.remove('hidden');
    modal?.classList.add('flex');
    if (window.lucide) window.lucide.createIcons();
  }

  clearGeminiKey() {
    this.gemini.setApiKey('');
    const input = document.getElementById('gemini-api-key-input');
    if (input) input.value = '';
    this.updateGeminiStatusUI();
    this.openGeminiModal();
    this.showToast('Client key removed! App is now using secure Server Environment.', 'success');
  }

  updateGeminiStatusUI() {
    const ping = document.getElementById('gemini-status-ping');
    const dot = document.getElementById('gemini-status-dot');
    if (this.gemini.isConfigured()) {
      ping?.classList.remove('hidden');
      dot?.classList.remove('bg-slate-500');
      dot?.classList.add('bg-emerald-400');
    } else {
      ping?.classList.add('hidden');
      dot?.classList.add('bg-slate-500');
      dot?.classList.remove('bg-emerald-400');
    }
  }

  updatePreloadUI(stats) {
    if (!stats) return;
    const container = document.getElementById('header-ai-preload-container');
    const bar = document.getElementById('ai-preload-bar');
    const frac = document.getElementById('ai-preload-fraction');
    const label = document.getElementById('ai-preload-status-label');
    const ping = document.getElementById('ai-preload-ping');
    const dot = document.getElementById('ai-preload-dot');

    // Show the container if AI is configured
    if (container && this.gemini.isConfigured()) {
      container.classList.remove('hidden');
      container.classList.add('xl:flex');
    }

    if (bar) bar.style.width = `${stats.percentage}%`;
    if (frac) frac.textContent = `${stats.cached}/${stats.total}`;
    console.log(`[Preload UI] ${stats.cached}/${stats.total} (${stats.percentage}%)`);

    if (this.gemini.isPrefetching) {
      ping?.classList.remove('hidden');
      if (dot) dot.className = 'relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400';
      if (label) {
        const speed = this.gemini.provider === 'local' ? '5x Turbo' : '3x Parallel';
        label.textContent = `⚡ ${speed} (${stats.percentage}%)`;
        label.className = 'text-[9px] text-emerald-400 font-mono font-bold animate-pulse';
      }
    } else if (stats.cached >= stats.total) {
      ping?.classList.add('hidden');
      if (dot) dot.className = 'relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400';
      if (label) {
        label.textContent = '100% Preloaded';
        label.className = 'text-[9px] text-emerald-400 font-mono font-bold';
      }
    } else {
      ping?.classList.add('hidden');
      if (dot) dot.className = 'relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-400';
      if (label) {
        label.textContent = 'Paused (Click to run)';
        label.className = 'text-[9px] text-amber-300 font-mono';
      }
    }
  }

  togglePrefetchPause() {
    if (this.gemini.isPrefetching) {
      this.gemini.pausePrefetch();
      this.showToast('Background AI preloader paused.', 'info');
    } else {
      this.gemini.startBackgroundPrefetch(this.store.state.players);
      this.showToast('Background AI preloader started! Pre-warming draft board.', 'success');
    }
    this.updatePreloadUI(this.gemini.getPreloadedCount(this.store.state.players.length));
  }

  async loadOllamaModels() {
    const select = document.getElementById('local-ai-model-select');
    const statusEl = document.getElementById('ollama-models-status');
    if (!select) return;

    const isLocalHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (!isLocalHost && this.gemini.provider !== 'local') {
      select.innerHTML = `<option value="llama3.2:1b">llama3.2:1b (Local)</option>`;
      if (statusEl) {
        statusEl.textContent = 'Local Ollama is for offline/localhost use. Use Gemini Cloud for cloud hosting.';
        statusEl.className = 'text-[10px] text-slate-500 mt-1';
      }
      return;
    }

    const urlInput = document.getElementById('local-ai-url-input');
    const baseUrl = urlInput ? urlInput.value.trim() : this.gemini.localUrl;
    const currentModel = this.gemini.localModel;

    select.innerHTML = '<option value="">Fetching models...</option>';
    if (statusEl) statusEl.textContent = 'Connecting to Ollama...';

    try {
      const res = await fetch(`${baseUrl}/api/tags`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const models = data.models || [];

      if (models.length === 0) {
        select.innerHTML = '<option value="">No models installed</option>';
        if (statusEl) statusEl.textContent = 'No models found. Run: ollama pull llama3.2:1b';
        return;
      }

      // Sort: smaller models first (faster on CPU)
      models.sort((a, b) => (a.size || 0) - (b.size || 0));

      select.innerHTML = models.map(m => {
        const name = m.name || m.model;
        const sizeGB = m.size ? (m.size / 1e9).toFixed(1) + ' GB' : '';
        const params = m.details?.parameter_size || '';
        const label = [name, params, sizeGB].filter(Boolean).join(' — ');
        const selected = name === currentModel ? 'selected' : '';
        return `<option value="${name}" ${selected}>${label}</option>`;
      }).join('');

      if (statusEl) {
        statusEl.textContent = `${models.length} model${models.length > 1 ? 's' : ''} installed. Smaller = faster on CPU.`;
        statusEl.className = 'text-[10px] text-emerald-400 mt-1';
      }
    } catch (e) {
      select.innerHTML = `<option value="${currentModel}">${currentModel} (offline)</option>`;
      if (statusEl) {
        statusEl.textContent = `Could not connect to Ollama at ${baseUrl}. Is it running?`;
        statusEl.className = 'text-[10px] text-rose-400 mt-1';
      }
    }

    if (window.lucide) window.lucide.createIcons();
  }

  async testGeminiConnection() {
    const testResult = document.getElementById('gemini-test-result');
    testResult.classList.remove('hidden');

    if (this.gemini.provider === 'local') {
      const urlInput = document.getElementById('local-ai-url-input');
      const modelSelect = document.getElementById('local-ai-model-select');
      const url = urlInput ? urlInput.value.trim() : 'http://localhost:11434';
      const model = modelSelect ? modelSelect.value.trim() : 'llama3.2:1b';
      this.gemini.setLocalConfig(url, model);

      testResult.textContent = `Connecting to Local Model (${model}) at ${url}...`;
      testResult.className = 'text-xs text-emerald-400 text-center font-medium';

      try {
        const testPlayer = { id: 'test_1', name: 'Jahmyr Gibbs', pos: 'RB', team: 'DET', baselineVal: 58 };
        const res = await this.gemini.fetchPlayerNews(testPlayer, true);
        testResult.textContent = `✅ Local Model Connected! (${res.source}) — "${res.headline}"`;
        testResult.className = 'text-xs text-emerald-400 text-center font-bold';
        this.updateGeminiStatusUI();
      } catch (e) {
        testResult.textContent = `❌ Local Connection Failed: ${e.message}`;
        testResult.className = 'text-xs text-rose-400 text-center font-bold';
      }
      return;
    }

    const input = document.getElementById('gemini-api-key-input');
    const key = input ? input.value.trim() : '';

    if (key) {
      this.gemini.setApiKey(key);
    }

    testResult.textContent = 'Testing connection with Gemini Cloud via Secure Backend API...';
    testResult.className = 'text-xs text-indigo-400 text-center font-medium';

    try {
      const testPlayer = { id: 'test_1', name: 'Jahmyr Gibbs', pos: 'RB', team: 'DET', baselineVal: 58 };
      const res = await this.gemini.fetchPlayerNews(testPlayer, true);
      testResult.textContent = `✅ Connected successfully! (${res.source}) — Headline: "${res.headline}"`;
      testResult.className = 'text-xs text-emerald-400 text-center font-bold';
      this.gemini.setServerKeyConfigured(true);
      this.updateGeminiStatusUI();
    } catch (e) {
      if (e.message.includes('429') || e.message.includes('quota') || e.message.includes('RESOURCE_EXHAUSTED')) {
        testResult.textContent = `⚠️ Rate Limit (429): Free tier limit reached. Switching to Local Model is recommended for 100% free offline usage.`;
        testResult.className = 'text-xs text-amber-400 text-center font-bold';
      } else {
        testResult.textContent = `❌ Test failed: ${e.message}`;
        testResult.className = 'text-xs text-rose-400 text-center font-bold';
      }
    }
  }

  openNominateModal() {
    const modal = document.getElementById('nominate-modal');
    const playerSelect = document.getElementById('modal-nominate-player-select');
    const teamSelect = document.getElementById('modal-nominate-team-select');
    const openingBid = document.getElementById('modal-nominate-opening-bid');

    const available = this.store.state.players.filter(p => !p.drafted);
    playerSelect.innerHTML = available.map(p => `<option value="${p.id}">${p.pos} - ${p.name} (${p.team}) - Base $${p.baselineVal}</option>`).join('');

    const nextNom = this.engine.getNominationTeam(this.store.state.currentPickNumber, this.store.state.teams, this.store.state.nominationOrder);
    teamSelect.innerHTML = this.store.state.teams.map(t => {
      const remainingCash = t.budget - (t.spent || 0);
      const totalRostered = this.engine.getTotalRosterCount(t.roster);
      const isEliminated = remainingCash <= 0 || totalRostered >= 15;
      const statusText = isEliminated ? (remainingCash <= 0 ? ' [OUT OF CASH]' : ' [ROSTER FULL]') : ` (Max: $${this.engine.calculateMaxBid(t)})`;
      return `<option value="${t.id}" ${t.id === nextNom.team.id ? 'selected' : ''}>${t.name}${statusText}</option>`;
    }).join('');

    openingBid.value = 1;

    modal?.classList.remove('hidden');
    modal?.classList.add('flex');
  }

  openDraftOrderModal() {
    const modal = document.getElementById('draft-order-modal');
    this.renderDraftOrderModal();
    modal?.classList.remove('hidden');
    modal?.classList.add('flex');
  }

  renderDraftOrderModal() {
    const container = document.getElementById('draft-order-modal-list');
    if (!container) return;

    const state = this.store.state;
    const order = (state.nominationOrder && state.nominationOrder.length > 0)
      ? state.nominationOrder.map(id => parseInt(id, 10))
      : state.teams.map(t => parseInt(t.id, 10));
    const teamMap = new Map(state.teams.map(t => [parseInt(t.id, 10), t]));

    container.innerHTML = order.map((teamId, index) => {
      const team = teamMap.get(teamId);
      if (!team) return '';

      const isUser = team.id === state.userTeamId;
      const spent = team.spent || 0;
      const remaining = team.budget - spent;
      const totalRostered = this.engine.getTotalRosterCount(team.roster);
      const isOutOfCash = remaining <= 0;
      const isRosterFull = totalRostered >= 15;
      const isEliminated = isOutOfCash || isRosterFull;

      let statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">🟢 Active</span>`;
      if (isOutOfCash) {
        statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40">⛔ Out of Cash ($0)</span>`;
      } else if (isRosterFull) {
        statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-700 text-slate-300 border border-slate-600">🏁 Full (15/15)</span>`;
      }

      return `
        <div class="p-3 rounded-xl bg-slate-950/80 border ${isUser ? 'border-blue-500/50 bg-blue-950/20' : isEliminated ? 'border-slate-800/60 opacity-60' : 'border-slate-800'} flex items-center justify-between gap-3 text-xs">
          <div class="flex items-center gap-3">
            <span class="w-8 h-8 rounded-lg bg-slate-900 border border-slate-700 flex items-center justify-center font-mono font-black text-amber-400">
              #${index + 1}
            </span>
            <div>
              <div class="flex items-center gap-2">
                <span class="font-bold ${isUser ? 'text-blue-300' : 'text-white'} text-sm">${team.name}</span>
                ${isUser ? '<span class="text-[9px] font-extrabold bg-blue-500 text-white px-1.5 py-0.2 rounded">MY TEAM</span>' : ''}
              </div>
              <div class="text-[11px] text-slate-400 flex items-center gap-2 mt-0.5">
                <span>$${remaining} left</span>
                <span>•</span>
                <span>${totalRostered}/15 players</span>
                <span>•</span>
                ${statusBadge}
              </div>
            </div>
          </div>

          <div class="flex items-center gap-1.5">
            <button 
              onclick="window.app.handleMoveTeamOrder(${team.id}, -1)" 
              ${index === 0 ? 'disabled' : ''} 
              class="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer" 
              title="Move Up"
            >
              <i data-lucide="arrow-up" class="w-3.5 h-3.5"></i>
            </button>
            <button 
              onclick="window.app.handleMoveTeamOrder(${team.id}, 1)" 
              ${index === order.length - 1 ? 'disabled' : ''} 
              class="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer" 
              title="Move Down"
            >
              <i data-lucide="arrow-down" class="w-3.5 h-3.5"></i>
            </button>
          </div>
        </div>
      `;
    }).join('');

    if (window.lucide) window.lucide.createIcons();
  }

  handleMoveTeamOrder(teamId, direction) {
    const idNum = parseInt(teamId, 10);
    if (typeof this.store.moveTeamOrder === 'function') {
      this.store.moveTeamOrder(idNum, direction);
    } else {
      if (!this.store.state.nominationOrder || this.store.state.nominationOrder.length === 0) {
        this.store.state.nominationOrder = this.store.state.teams.map(t => parseInt(t.id, 10));
      }
      const order = this.store.state.nominationOrder.map(id => parseInt(id, 10));
      const index = order.findIndex(id => id === idNum);
      if (index !== -1) {
        const newIndex = index + direction;
        if (newIndex >= 0 && newIndex < order.length) {
          const temp = order[index];
          order[index] = order[newIndex];
          order[newIndex] = temp;
          this.store.state.nominationOrder = order;
          this.store.save();
        }
      }
    }
    this.renderDraftOrderModal();
    this.showToast('Draft order updated.', 'info');
  }

  handleRandomizeDraftOrder() {
    if (typeof this.store.randomizeNominationOrder === 'function') {
      this.store.randomizeNominationOrder();
    } else {
      if (!this.store.state.nominationOrder || this.store.state.nominationOrder.length === 0) {
        this.store.state.nominationOrder = this.store.state.teams.map(t => parseInt(t.id, 10));
      }
      const order = this.store.state.nominationOrder.map(id => parseInt(id, 10));
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const temp = order[i];
        order[i] = order[j];
        order[j] = temp;
      }
      this.store.state.nominationOrder = order;
      this.store.save();
    }
    this.renderDraftOrderModal();
    this.showToast('Draft order randomized!', 'success');
  }

  handleResetDraftOrder() {
    if (typeof this.store.resetNominationOrder === 'function') {
      this.store.resetNominationOrder();
    } else {
      this.store.state.nominationOrder = this.store.state.teams.map(t => parseInt(t.id, 10));
      this.store.save();
    }
    this.renderDraftOrderModal();
    this.showToast('Draft order reset to default 1-12.', 'info');
  }

  openSyncModal() {
    const modal = document.getElementById('sync-modal');
    modal?.classList.remove('hidden');
    modal?.classList.add('flex');
  }

  closeModals() {
    document.querySelectorAll('.modal-backdrop').forEach(m => {
      m.classList.add('hidden');
      m.classList.remove('flex');
    });
  }

  toggleStar(playerId) {
    this.store.toggleStarred(playerId);
  }

  toggleDND(playerId) {
    this.store.toggleDND(playerId);
  }

  quickNominatePlayer(playerId) {
    const player = this.store.state.players.find(p => p.id === playerId);
    if (!player) {
      this.showToast('Player not found.', 'error');
      return;
    }
    if (player.drafted) {
      this.showToast(`${player.name} has already been drafted!`, 'error');
      return;
    }

    this.activeNominationNews = null;
    const nextNom = this.engine.getNominationTeam(this.store.state.currentPickNumber, this.store.state.teams, this.store.state.nominationOrder);
    this.store.nominatePlayer(playerId, nextNom.team.id, 1);
    this.switchTab('draft-room');
    this.showToast(`${player.name} placed on auction block!`, 'success');
  }

  quickNominateByName(playerName) {
    const player = this.store.state.players.find(p => p.name.toLowerCase().trim() === playerName.toLowerCase().trim());
    if (!player) {
      this.showToast(`Could not find ${playerName} in player database.`, 'error');
      return;
    }
    if (player.drafted) {
      this.showToast(`${player.name} has already been drafted!`, 'error');
      return;
    }
    this.quickNominatePlayer(player.id);
  }

  handleUndo() {
    const success = this.store.undoLastPick();
    if (success) {
      this.showToast('Undid last draft pick.', 'info');
    } else {
      this.showToast('No picks to undo.', 'info');
    }
  }

  handleRedo() {
    const success = this.store.redoLastPick();
    if (success) {
      this.showToast('Restored draft pick (Redo).', 'info');
    } else {
      this.showToast('No picks to redo.', 'info');
    }
  }

  handleReset() {
    this.store.resetDraft();
    this.showToast('Draft has been reset.', 'info');
  }

  forcePushDatasetToCloud() {
    const initialData = defaultData || window.INITIAL_DRAFT_DATA;
    if (!initialData || !initialData.players) {
      this.showToast('Seed database not found.', 'error');
      return;
    }

    const currentMap = new Map();
    (this.store.state.players || []).forEach(p => currentMap.set(p.name.toLowerCase().trim(), p));

    const mergedPlayers = initialData.players.map((seedP, idx) => {
      const existing = currentMap.get(seedP.name.toLowerCase().trim());
      if (existing) {
        return {
          ...seedP,
          id: seedP.id || `p_${idx + 1}`,
          drafted: existing.drafted || false,
          draftedTeamId: existing.draftedTeamId || null,
          draftedPrice: existing.draftedPrice || null,
          draftPickNumber: existing.draftPickNumber || null,
          isStarred: existing.isStarred || false,
          isDND: existing.isDND || false,
          customNotes: existing.customNotes || ""
        };
      }
      return { ...seedP, id: seedP.id || `p_${idx + 1}` };
    });

    this.store.state.players = mergedPlayers;
    this.store.save('Forced cloud database update (344 players)');
    this.showToast(`✅ Synced all ${mergedPlayers.length} players to Google Cloud Database!`, 'success');
  }

  selectAsMyTeam(teamId) {
    this.store.setUserTeam(teamId);
    const team = this.store.state.teams.find(t => t.id === teamId);
    this.showToast(`Set "${team ? team.name : 'Team'}" as your active team!`, 'success');
  }

  promptEditTeamName(teamId) {
    const team = this.store.state.teams.find(t => t.id === teamId);
    if (!team) return;
    const newName = prompt(`Enter new name for ${team.name}:`, team.name);
    if (newName) {
      this.store.updateTeamName(teamId, newName);
      this.showToast(`Updated team name to "${newName}".`, 'success');
    }
  }

  async handleSheetSync() {
    const sheetId = document.getElementById('sync-sheet-id').value.trim();
    const statusMsg = document.getElementById('sync-status-msg');
    statusMsg.classList.remove('hidden');
    statusMsg.textContent = 'Fetching from Google Sheets...';
    statusMsg.className = 'text-xs text-blue-400';

    try {
      const res = await this.sheetSync.fetchGoogleSheet(sheetId);
      statusMsg.textContent = `Successfully synced ${res.count} players and ${res.rookieCount} rookies!`;
      statusMsg.className = 'text-xs text-emerald-400 font-bold';
      this.showToast(`Synced ${res.count} players from Google Sheet!`, 'success');
    } catch (e) {
      statusMsg.textContent = `Sync failed: ${e.message}. If the sheet is private, paste CSV below.`;
      statusMsg.className = 'text-xs text-rose-400 font-bold';
    }
  }

  handlePasteImport() {
    const textarea = document.getElementById('sync-paste-textarea');
    const text = textarea.value.trim();
    if (!text) {
      alert('Please paste CSV or tab-separated rows into the box first.');
      return;
    }

    try {
      const parsed = this.sheetSync.parseMainCsv(text);
      if (parsed.length > 0) {
        this.store.importPlayers(parsed);
        textarea.value = '';
        this.closeModals();
        this.showToast(`Successfully imported ${parsed.length} players!`, 'success');
      } else {
        alert('Could not detect valid player rows. Make sure the header row includes Name and Pos.');
      }
    } catch (e) {
      alert(`Import error: ${e.message}`);
    }
  }

  handleJsonRestore(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target.result);
        if (data.players && data.teams) {
          this.store.state = data;
          this.store.save();
          this.closeModals();
          this.showToast('Restored draft backup successfully!', 'success');
        } else {
          alert('Invalid backup file format.');
        }
      } catch (err) {
        alert(`Error loading file: ${err.message}`);
      }
    };
    reader.readAsText(file);
  }

  // --- AI ADMIN & LIVE TELEMETRY DASHBOARD ---

  renderAiAdmin() {
    const viewContainer = document.getElementById('view-ai-admin');
    if (!viewContainer || viewContainer.classList.contains('hidden')) return;

    const stats = this.gemini.getPreloadedCount(this.store.state.players.length);
    
    // Top Metrics
    const cachedCountEl = document.getElementById('ai-admin-cached-count');
    const cachedPctEl = document.getElementById('ai-admin-cached-pct');
    const progressBar = document.getElementById('ai-admin-progress-bar');
    const workersCountEl = document.getElementById('ai-admin-workers-count');
    const providerLabelEl = document.getElementById('ai-admin-provider-label');
    const avgLatencyEl = document.getElementById('ai-admin-avg-latency');
    const circuitStatusEl = document.getElementById('ai-admin-circuit-status');
    const toggleBtnText = document.getElementById('btn-admin-toggle-prefetch-text');
    const activeBadge = document.getElementById('ai-admin-active-badge');

    if (cachedCountEl) cachedCountEl.textContent = `${stats.cached}/${stats.total}`;
    if (cachedPctEl) cachedPctEl.textContent = `(${stats.percentage}%)`;
    if (progressBar) progressBar.style.width = `${stats.percentage}%`;
    if (workersCountEl) {
      const workerCount = this.gemini.provider === 'local' ? 5 : 3;
      workersCountEl.textContent = this.gemini.isPrefetching ? `${workerCount} Active Threads` : 'Idle';
    }
    if (providerLabelEl) {
      providerLabelEl.textContent = this.gemini.provider === 'local' 
        ? `Local Model: ${this.gemini.localModel} (${this.gemini.localUrl})` 
        : 'Google Gemini 3.7 Flash (Cloud)';
    }
    if (avgLatencyEl) avgLatencyEl.textContent = `~${this.gemini.getAvgLatency()}ms`;
    if (circuitStatusEl) {
      circuitStatusEl.textContent = this.gemini.isCircuitBroken 
        ? `Paused (${this.gemini.consecutiveFailures}/3 Failures)` 
        : `Healthy (${this.gemini.consecutiveFailures}/3)`;
      circuitStatusEl.className = this.gemini.isCircuitBroken ? 'text-xl font-black text-rose-400 font-mono' : 'text-xl font-black text-emerald-400 font-mono';
    }
    if (toggleBtnText) {
      toggleBtnText.textContent = this.gemini.isPrefetching ? 'Pause Preloader' : 'Resume Preloader';
    }
    if (activeBadge) {
      activeBadge.textContent = this.gemini.isPrefetching ? '🟢 Preloading Live' : '🟡 Paused / Idle';
      activeBadge.className = this.gemini.isPrefetching 
        ? 'text-[10px] px-2 py-0.5 rounded-full font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' 
        : 'text-[10px] px-2 py-0.5 rounded-full font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30';
    }

    // Render Live Activity Stream
    const feedContainer = document.getElementById('ai-admin-live-stream-list');
    const feedCountEl = document.getElementById('ai-admin-feed-count');
    const searchInput = document.getElementById('ai-admin-search-input');
    const posFilter = document.getElementById('ai-admin-pos-filter');

    if (!feedContainer) return;

    let items = this.gemini.activityLog || [];

    // If activityLog is empty but cache has items, populate from cache!
    if (items.length === 0 && Object.keys(this.gemini.cache).length > 0) {
      const playerMap = new Map(this.store.state.players.map(p => [p.id, p]));
      items = Object.entries(this.gemini.cache).map(([pId, cachedObj]) => {
        const p = playerMap.get(pId) || { name: 'Player', pos: 'FLEX', team: 'NFL', baselineVal: 10 };
        const data = cachedObj.data || {};
        return {
          timestamp: new Date(cachedObj.timestamp || Date.now()).toLocaleTimeString(),
          playerId: pId,
          playerName: p.name,
          pos: p.pos,
          team: p.team,
          baselineVal: p.baselineVal,
          headline: data.headline || `${p.name} Scouting Report`,
          summary: data.summary || '',
          sentiment: data.draftSentiment || 'NEUTRAL',
          injuryStatus: data.injuryStatus || 'Active',
          auctionAdvice: data.auctionAdvice || `Value near $${p.baselineVal}`,
          source: data.source || (this.gemini.provider === 'local' ? `Local ${this.gemini.localModel}` : 'Gemini'),
          latencyMs: 420,
          isLive: false
        };
      });
    }

    // Filter by search query
    const q = searchInput ? searchInput.value.trim().toLowerCase() : '';
    if (q) {
      items = items.filter(it => 
        (it.playerName && it.playerName.toLowerCase().includes(q)) ||
        (it.team && it.team.toLowerCase().includes(q)) ||
        (it.headline && it.headline.toLowerCase().includes(q))
      );
    }

    // Filter by position
    const pos = posFilter ? posFilter.value : 'ALL';
    if (pos && pos !== 'ALL') {
      items = items.filter(it => it.pos === pos);
    }

    if (feedCountEl) feedCountEl.textContent = `(${items.length} entries)`;

    if (items.length === 0) {
      feedContainer.innerHTML = `
        <div class="p-8 text-center text-slate-500 bg-slate-950/40 rounded-xl border border-slate-800 text-xs">
          <i data-lucide="inbox" class="w-8 h-8 mx-auto mb-2 text-slate-600 opacity-60"></i>
          No AI intelligence pulls recorded yet. Click <b>"Resume Preloader"</b> or place a player on the block to watch live stream.
        </div>
      `;
      return;
    }

    feedContainer.innerHTML = items.map(entry => {
      const isRising = entry.sentiment === 'RISING';
      const isFalling = entry.sentiment === 'FALLING';
      const sentimentBadge = isRising 
        ? '<span class="px-2 py-0.5 rounded text-[10px] font-extrabold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">🔥 STOCK RISING</span>'
        : isFalling 
        ? '<span class="px-2 py-0.5 rounded text-[10px] font-extrabold bg-rose-500/20 text-rose-300 border border-rose-500/30">⚠️ RISK / FALLING</span>'
        : '<span class="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">🟢 STEADY</span>';

      const posBadgeClass = `badge-${entry.pos.toLowerCase()}`;

      return `
        <div class="bg-slate-950/80 p-3.5 rounded-xl border border-slate-800 hover:border-indigo-500/40 transition-all space-y-2">
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <span class="badge ${posBadgeClass} text-[10px] px-2 py-0.5 rounded font-bold">${entry.pos}</span>
              <span class="font-extrabold text-white text-xs">${entry.playerName}</span>
              <span class="text-[11px] text-slate-400 font-mono">(${entry.team})</span>
              ${sentimentBadge}
              <span class="text-[10px] text-slate-400">Status: <b class="text-slate-200">${entry.injuryStatus || 'Active'}</b></span>
            </div>

            <div class="flex items-center gap-2 text-[10px] text-slate-400 font-mono">
              <span class="px-1.5 py-0.5 bg-slate-900 rounded border border-slate-800 text-indigo-300">⚡ ${entry.latencyMs || 400}ms</span>
              <span class="text-slate-500">${entry.timestamp}</span>
            </div>
          </div>

          <div class="text-xs font-bold text-slate-100">
            ${entry.headline || 'Scouting Intel'}
          </div>

          <p class="text-[11px] text-slate-300 leading-relaxed">
            ${entry.summary || ''}
          </p>

          <div class="flex items-center justify-between text-[10px] text-slate-400 bg-indigo-950/30 p-2 rounded-lg border border-indigo-500/20">
            <div class="flex items-center gap-1 text-indigo-300">
              <i data-lucide="crosshair" class="w-3 h-3 text-indigo-400 shrink-0"></i>
              <span><b>Advice:</b> ${entry.auctionAdvice || `Target near $${entry.baselineVal}`}</span>
            </div>
            <span class="text-slate-500 italic shrink-0">${entry.source || 'AI Intel'}</span>
          </div>
        </div>
      `;
    }).join('');

    if (window.lucide) window.lucide.createIcons();
  }

  clearAiCache() {
    if (confirm('Are you sure you want to clear all cached AI player scouting reports?')) {
      this.gemini.clearCache();
      this.renderAiAdmin();
      this.updatePreloadUI(this.gemini.getPreloadedCount(this.store.state.players.length));
      this.showToast('AI cache cleared successfully.', 'info');
    }
  }

  forceRefetchAllAi() {
    if (confirm('Force fresh AI queries for all 310 players in the draft pool?')) {
      this.gemini.clearCache();
      this.gemini.startBackgroundPrefetch(this.store.state.players);
      this.renderAiAdmin();
      this.updatePreloadUI(this.gemini.getPreloadedCount(this.store.state.players.length));
      this.showToast('Restarted fresh AI preloading for all players!', 'success');
    }
  }

  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    const bgClass = type === 'success' ? 'bg-emerald-900/90 border-emerald-600 text-emerald-100' :
                    type === 'error' ? 'bg-rose-900/90 border-rose-600 text-rose-100' :
                    'bg-slate-800/90 border-slate-600 text-slate-100';

    toast.className = `px-4 py-2.5 rounded-xl border shadow-xl text-xs font-semibold backdrop-blur-md flex items-center gap-2 transform transition-all duration-300 translate-y-2 opacity-0 ${bgClass}`;
    toast.innerHTML = `<span>${message}</span>`;

    container.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.remove('translate-y-2', 'opacity-0');
    });

    setTimeout(() => {
      toast.classList.add('opacity-0', 'translate-y-2');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }
}

// Start app once DOM is loaded
window.addEventListener('DOMContentLoaded', () => {
  new AuctionDraftApp();
});
