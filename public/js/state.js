/**
 * Application State & Store Manager
 * Persists all draft day progress in localStorage with full undo/redo and live event dispatching.
 */

import { DraftEngine } from './engine.js';

const STORAGE_KEY = 'fantasy_auction_draft_state_v1';

export class DraftStore {
  constructor() {
    this.listeners = [];
    this.init();
  }

  init() {
    const saved = localStorage.getItem(STORAGE_KEY);
    const initialData = window.INITIAL_DRAFT_DATA || { rules: { defaultTeams: [] }, players: [], rookies: [] };

    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        this.state = parsed;
        // Ensure nominationOrder exists
        if (!this.state.nominationOrder && this.state.teams) {
          this.state.nominationOrder = this.state.teams.map(t => t.id);
        }
        // Update default team names if existing teams were generic
        if (this.state.teams && initialData.rules.defaultTeams) {
          this.state.teams.forEach((t, i) => {
            if (initialData.rules.defaultTeams[i] && (t.name.startsWith('Team ') || t.name === 'My Team (Hero)' || t.name === 'My Team')) {
              t.name = initialData.rules.defaultTeams[i].name;
            }
          });
        }
        // Ensure userTeam is DCFC
        const dcfcTeam = this.state.teams ? this.state.teams.find(t => t.name === 'DCFC') : null;
        if (dcfcTeam && this.state.userTeamId !== dcfcTeam.id) {
          this.state.userTeamId = dcfcTeam.id;
          this.state.teams.forEach(t => t.isUser = (t.id === dcfcTeam.id));
        }

        // Auto-merge any new seed players (e.g. upgraded 32 K and 32 DST - 344 total players)
        if (initialData.players && initialData.players.length > 0) {
          const currentMap = new Map();
          (this.state.players || []).forEach(p => currentMap.set(p.name.toLowerCase().trim(), p));

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

          if (!this.state.players || this.state.players.length !== mergedPlayers.length) {
            this.state.players = mergedPlayers;
            this.save('Player dataset upgraded to 344 players');
          }
        }
      } catch (e) {
        console.error('Failed to load saved state, initializing fresh default', e);
        this.initDefault();
      }
    } else {
      this.initDefault();
    }

    this.engine = new DraftEngine(this.state.rules, this.state.players, this.state.teams);
  }

  initDefault() {
    const initialData = window.INITIAL_DRAFT_DATA || {
      rules: {
        leagueName: "2026 Championship Auction League",
        totalTeams: 12,
        budgetPerTeam: 200,
        totalLeagueBudget: 2400
      },
      players: [],
      rookies: []
    };

    const teams = (initialData.rules.defaultTeams || []).map(t => ({
      id: t.id,
      name: t.name,
      isUser: t.name === 'DCFC' || t.isUser,
      budget: t.budget || 200,
      spent: 0,
      roster: {
        starters: { QB: [], RB: [], WR: [], FLEX: [], K: [], DST: [] },
        bench: []
      }
    }));

    // If teams wasn't populated
    if (teams.length === 0) {
      for (let i = 1; i <= 12; i++) {
        teams.push({
          id: i,
          name: i === 4 ? "DCFC" : `Team ${i}`,
          isUser: i === 4,
          budget: 200,
          spent: 0,
          roster: {
            starters: { QB: [], RB: [], WR: [], FLEX: [], K: [], DST: [] },
            bench: []
          }
        });
      }
    }

    const dcfcTeam = teams.find(t => t.name === 'DCFC') || teams.find(t => t.isUser) || teams[0];
    const userTeamId = dcfcTeam ? dcfcTeam.id : 4;
    teams.forEach(t => t.isUser = (t.id === userTeamId));

    const players = (initialData.players || []).map(p => ({
      ...p,
      drafted: false,
      draftedTeamId: null,
      draftedPrice: null,
      draftPickNumber: null,
      isStarred: false,
      isDND: false
    }));

    const rookies = (initialData.rookies || []);

    this.state = {
      rules: initialData.rules,
      players,
      rookies,
      teams,
      nominationOrder: teams.map(t => t.id),
      draftHistory: [],
      redoHistory: [],
      currentPickNumber: 1,
      currentNomination: null,
      targetFilter: 'ALL', // ALL, RB, WR, TE, FLEX, QB, K, DST, ROOKIES
      statusFilter: 'ALL', // ALL, AVAILABLE, DRAFTED, STARRED, DND
      tierFilter: 'ALL',
      searchQuery: '',
      activeTab: 'draft-room', // draft-room, cheat-sheet, my-team, all-teams, rookie-hub, sync-rules
      userTeamId: userTeamId
    };

    this.save();
  }

  setSyncService(syncService) {
    this.syncService = syncService;
  }

  mergeRemoteState(remoteState) {
    if (!remoteState) return;

    const localTab = this.state?.activeTab;
    const localSearch = this.state?.searchQuery;
    const localTargetFilter = this.state?.targetFilter;
    const localStatusFilter = this.state?.statusFilter;

    const initialData = window.INITIAL_DRAFT_DATA || { players: [] };
    let players = remoteState.players || [];

    // If cloud state in Firestore was missing the upgraded 32 K and 32 DST players, upgrade it!
    if (initialData.players && initialData.players.length > players.length) {
      const currentMap = new Map();
      players.forEach(p => currentMap.set(p.name.toLowerCase().trim(), p));

      players = initialData.players.map((seedP, idx) => {
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

      setTimeout(() => {
        if (this.syncService && typeof this.syncService.pushDraftState === 'function') {
          this.syncService.pushDraftState(this.state, 'Upgraded cloud DB to 344 players');
        }
      }, 500);
    }

    this.state = {
      ...remoteState,
      players,
      activeTab: localTab || remoteState.activeTab || 'draft-room',
      searchQuery: localSearch !== undefined ? localSearch : (remoteState.searchQuery || ''),
      targetFilter: localTargetFilter || remoteState.targetFilter || 'ALL',
      statusFilter: localStatusFilter || remoteState.statusFilter || 'ALL'
    };

    this.engine = new DraftEngine(this.state.rules, this.state.players, this.state.teams);

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch (e) {
      console.error('Error saving merged remote state to localStorage', e);
    }

    this.notify();
  }

  save(actionDescription = 'Draft update') {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch (e) {
      console.error('Error saving draft state to localStorage', e);
    }

    if (this.syncService && typeof this.syncService.pushDraftState === 'function') {
      this.syncService.pushDraftState(this.state, actionDescription);
    }

    this.notify();
  }

  subscribe(listener) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  notify() {
    this.listeners.forEach(fn => fn(this.state));
  }

  getUserTeam() {
    return this.state.teams.find(t => t.id === this.state.userTeamId) || this.state.teams[0];
  }

  // --- Draft Actions ---

  /**
   * Nominate a player for auction
   */
  nominatePlayer(playerId, nominatingTeamId, openingBid = 1) {
    const player = this.state.players.find(p => p.id === playerId);
    if (!player || player.drafted) return false;

    const team = this.state.teams.find(t => t.id === nominatingTeamId) || this.getUserTeam();
    const maxBid = this.engine.calculateMaxBid(team);
    const validOpeningBid = Math.min(maxBid, Math.max(1, openingBid));

    this.state.currentNomination = {
      playerId,
      player,
      nominatingTeamId: team.id,
      nominatingTeamName: team.name,
      openingBid: validOpeningBid,
      currentBid: validOpeningBid,
      highBidderTeamId: team.id,
      highBidderTeamName: team.name,
      timestamp: Date.now()
    };

    this.save();
    return true;
  }

  cancelNomination() {
    this.state.currentNomination = null;
    this.save();
  }

  /**
   * Log a completed draft pick
   */
  draftPlayer(playerId, winningTeamId, price) {
    const playerIndex = this.state.players.findIndex(p => p.id === playerId);
    if (playerIndex === -1) return false;

    const teamIndex = this.state.teams.findIndex(t => t.id === winningTeamId);
    if (teamIndex === -1) return false;

    const player = this.state.players[playerIndex];
    const team = this.state.teams[teamIndex];

    const finalPrice = Math.max(1, parseInt(price, 10) || 1);
    const maxAllowed = this.engine.calculateMaxBid(team);

    if (finalPrice > maxAllowed) {
      console.warn(`Price ($${finalPrice}) exceeds max legal bid ($${maxAllowed}) for ${team.name}`);
    }

    // Assign slot
    const slotAssignment = this.engine.assignRosterSlot(team.roster, player);
    const assignedPlayer = {
      ...player,
      drafted: true,
      draftedTeamId: team.id,
      draftedPrice: finalPrice,
      draftPickNumber: this.state.currentPickNumber,
      rosterSlot: slotAssignment.slot
    };

    // Update player
    this.state.players[playerIndex] = assignedPlayer;

    // Update team & optimize roster slots
    team.spent += finalPrice;
    team.roster = this.engine.optimizeTeamRoster(slotAssignment.roster);

    // Record draft history
    const historyItem = {
      pickNumber: this.state.currentPickNumber,
      timestamp: Date.now(),
      playerId: player.id,
      playerName: player.name,
      pos: player.pos,
      teamNFL: player.team,
      bye: player.bye,
      tier: player.tier,
      projPts: player.projPts,
      baselineVal: player.baselineVal,
      winningTeamId: team.id,
      winningTeamName: team.name,
      price: finalPrice,
      valueDelta: (player.baselineVal || 0) - finalPrice,
      rosterSlot: slotAssignment.slot
    };

    this.state.draftHistory.unshift(historyItem);
    this.state.currentPickNumber += 1;
    this.state.currentNomination = null;
    this.state.redoHistory = []; // Reset redo stack on new pick

    this.save();
    return true;
  }

  /**
   * Undo the most recent draft pick
   */
  undoLastPick() {
    if (this.state.draftHistory.length === 0) return false;

    const lastPick = this.state.draftHistory.shift();
    const playerIndex = this.state.players.findIndex(p => p.id === lastPick.playerId);
    const teamIndex = this.state.teams.findIndex(t => t.id === lastPick.winningTeamId);

    if (playerIndex !== -1) {
      this.state.players[playerIndex].drafted = false;
      this.state.players[playerIndex].draftedTeamId = null;
      this.state.players[playerIndex].draftedPrice = null;
      this.state.players[playerIndex].draftPickNumber = null;
      delete this.state.players[playerIndex].rosterSlot;
    }

    if (teamIndex !== -1) {
      const team = this.state.teams[teamIndex];
      team.spent = Math.max(0, team.spent - lastPick.price);
      
      // Remove player from roster slots
      const starters = team.roster.starters || {};
      for (const slotKey of Object.keys(starters)) {
        starters[slotKey] = (starters[slotKey] || []).filter(p => p.id !== lastPick.playerId);
      }
      team.roster.bench = (team.roster.bench || []).filter(p => p.id !== lastPick.playerId);
      team.roster = this.engine.optimizeTeamRoster(team.roster);
    }

    if (!this.state.redoHistory) this.state.redoHistory = [];
    this.state.redoHistory.unshift(lastPick);

    this.state.currentPickNumber = Math.max(1, this.state.currentPickNumber - 1);
    this.save();
    return true;
  }

  /**
   * Redo the most recently undone draft pick
   */
  redoLastPick() {
    if (!this.state.redoHistory || this.state.redoHistory.length === 0) return false;

    const pickToRedo = this.state.redoHistory.shift();
    const playerIndex = this.state.players.findIndex(p => p.id === pickToRedo.playerId);
    const teamIndex = this.state.teams.findIndex(t => t.id === pickToRedo.winningTeamId);

    if (playerIndex === -1 || teamIndex === -1) return false;

    const player = this.state.players[playerIndex];
    const team = this.state.teams[teamIndex];

    const slotAssignment = this.engine.assignRosterSlot(team.roster, player);
    const assignedPlayer = {
      ...player,
      drafted: true,
      draftedTeamId: team.id,
      draftedPrice: pickToRedo.price,
      draftPickNumber: pickToRedo.pickNumber,
      rosterSlot: slotAssignment.slot
    };

    this.state.players[playerIndex] = assignedPlayer;
    team.spent += pickToRedo.price;
    team.roster = this.engine.optimizeTeamRoster(slotAssignment.roster);

    this.state.draftHistory.unshift(pickToRedo);
    this.state.currentPickNumber = pickToRedo.pickNumber + 1;
    this.state.currentNomination = null;

    this.save();
    return true;
  }

  /**
   * Toggle target star / DND on a player
   */
  toggleStarred(playerId) {
    const player = this.state.players.find(p => p.id === playerId);
    if (player) {
      player.isStarred = !player.isStarred;
      if (player.isStarred) player.isDND = false;
      this.save();
    }
  }

  toggleDND(playerId) {
    const player = this.state.players.find(p => p.id === playerId);
    if (player) {
      player.isDND = !player.isDND;
      if (player.isDND) player.isStarred = false;
      this.save();
    }
  }

  updatePlayerNotes(playerId, notes) {
    const player = this.state.players.find(p => p.id === playerId);
    if (player) {
      player.customNotes = notes;
      this.save();
    }
  }

  updateTeamName(teamId, newName) {
    const team = this.state.teams.find(t => t.id === teamId);
    if (team && newName.trim()) {
      team.name = newName.trim();
      this.save();
    }
  }

  setUserTeam(teamId) {
    this.state.userTeamId = teamId;
    this.state.teams.forEach(t => {
      t.isUser = (t.id === teamId);
    });
    this.save();
  }

  setNominationOrder(newOrder) {
    if (Array.isArray(newOrder) && newOrder.length > 0) {
      this.state.nominationOrder = newOrder;
      this.save();
    }
  }

  moveTeamOrder(teamId, direction) {
    if (!this.state.nominationOrder || this.state.nominationOrder.length === 0) {
      this.state.nominationOrder = this.state.teams.map(t => parseInt(t.id, 10));
    }
    const teamIdNum = parseInt(teamId, 10);
    const order = this.state.nominationOrder.map(id => parseInt(id, 10));
    const index = order.findIndex(id => id === teamIdNum);
    if (index === -1) return;

    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= order.length) return;

    // Swap positions
    const temp = order[index];
    order[index] = order[newIndex];
    order[newIndex] = temp;

    this.state.nominationOrder = order;
    this.save();
  }

  randomizeNominationOrder() {
    if (!this.state.nominationOrder || this.state.nominationOrder.length === 0) {
      this.state.nominationOrder = this.state.teams.map(t => parseInt(t.id, 10));
    }
    const order = this.state.nominationOrder.map(id => parseInt(id, 10));
    // Fisher-Yates shuffle
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const temp = order[i];
      order[i] = order[j];
      order[j] = temp;
    }
    this.state.nominationOrder = order;
    this.save();
  }

  resetNominationOrder() {
    this.state.nominationOrder = this.state.teams.map(t => parseInt(t.id, 10));
    this.save();
  }

  setActiveTab(tabName) {
    this.state.activeTab = tabName;
    this.save();
  }

  setFilters({ targetFilter, statusFilter, tierFilter, searchQuery }) {
    if (targetFilter !== undefined) this.state.targetFilter = targetFilter;
    if (statusFilter !== undefined) this.state.statusFilter = statusFilter;
    if (tierFilter !== undefined) this.state.tierFilter = tierFilter;
    if (searchQuery !== undefined) this.state.searchQuery = searchQuery;
    this.notify();
  }

  resetDraft() {
    if (!confirm('Are you sure you want to reset all draft picks? Player rankings and custom settings will be preserved.')) {
      return false;
    }

    this.state.players.forEach(p => {
      p.drafted = false;
      p.draftedTeamId = null;
      p.draftedPrice = null;
      p.draftPickNumber = null;
      delete p.rosterSlot;
    });

    this.state.teams.forEach(t => {
      t.spent = 0;
      t.roster = {
        starters: { QB: [], RB: [], WR: [], FLEX: [], K: [], DST: [] },
        bench: []
      };
    });

    this.state.draftHistory = [];
    this.state.redoHistory = [];
    this.state.currentPickNumber = 1;
    this.state.currentNomination = null;

    this.save();
    return true;
  }

  /**
   * Import fresh player data from Google Sheets or CSV
   */
  importPlayers(newPlayers, newRookies = null) {
    if (!newPlayers || newPlayers.length === 0) return false;

    // Preserve starred/DND and draft status by name match
    const currentMap = new Map();
    this.state.players.forEach(p => currentMap.set(p.name.toLowerCase(), p));

    this.state.players = newPlayers.map((np, idx) => {
      const existing = currentMap.get(np.name.toLowerCase());
      return {
        ...np,
        id: np.id || `p_${idx + 1}`,
        drafted: existing ? existing.drafted : false,
        draftedTeamId: existing ? existing.draftedTeamId : null,
        draftedPrice: existing ? existing.draftedPrice : null,
        draftPickNumber: existing ? existing.draftPickNumber : null,
        isStarred: existing ? existing.isStarred : false,
        isDND: existing ? existing.isDND : false,
        customNotes: existing ? existing.customNotes : ""
      };
    });

    if (newRookies && newRookies.length > 0) {
      this.state.rookies = newRookies;
    }

    this.save();
    return true;
  }
}
