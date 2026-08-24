/**
 * Google Sheets Synchronization & CSV Import/Export Module
 */

export class SheetSync {
  constructor(store) {
    this.store = store;
  }

  /**
   * Fetch live data from public Google Sheet via export CSV URL or local proxy
   */
  async fetchGoogleSheet(sheetId, mainGid = "2026127503", rookieGid = "1188258304") {
    let mainCsv = "";
    let rookieCsv = "";

    // 1. Try local server proxy first
    try {
      const proxyRes = await fetch('/api/sync-sheet');
      if (proxyRes.ok) {
        const json = await proxyRes.json();
        if (json.success && json.mainCsv) {
          mainCsv = json.mainCsv;
          rookieCsv = json.rookieCsv || "";
        }
      }
    } catch (e) {
      console.log("Local proxy not available, falling back to direct fetch", e);
    }

    // 2. If proxy didn't fetch, try direct Google Sheets export URL
    if (!mainCsv) {
      const mainUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${mainGid}`;
      const rookieUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${rookieGid}`;

      try {
        const resMain = await fetch(mainUrl);
        if (!resMain.ok) {
          throw new Error(`Google Sheets returned HTTP ${resMain.status} ${resMain.statusText}`);
        }
        mainCsv = await resMain.text();
      } catch (e) {
        console.warn("Direct fetch error:", e);
        throw e;
      }

      try {
        const resRookie = await fetch(rookieUrl);
        if (resRookie.ok) {
          rookieCsv = await resRookie.text();
        }
      } catch (e) {
        console.warn("Rookie sheet fetch optional warning:", e);
      }
    }

    const parsedPlayers = this.parseMainCsv(mainCsv);
    const parsedRookies = rookieCsv ? this.parseRookieCsv(rookieCsv) : null;

    if (parsedPlayers.length > 0) {
      this.store.importPlayers(parsedPlayers, parsedRookies);
      return { success: true, count: parsedPlayers.length, rookieCount: parsedRookies ? parsedRookies.length : 0 };
    } else {
      throw new Error("No player rows could be parsed from sheet.");
    }
  }

  /**
   * Parse CSV string into array of rows
   */
  csvToArray(csvString) {
    const rows = [];
    let currentRow = [];
    let currentField = '';
    let inQuotes = false;

    for (let i = 0; i < csvString.length; i++) {
      const char = csvString[i];
      const nextChar = csvString[i + 1];

      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          currentField += '"';
          i++; // skip escaped quote
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        currentRow.push(currentField.trim());
        currentField = '';
      } else if ((char === '\r' || char === '\n') && !inQuotes) {
        if (char === '\r' && nextChar === '\n') i++;
        currentRow.push(currentField.trim());
        if (currentRow.some(val => val !== '')) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentField = '';
      } else {
        currentField += char;
      }
    }

    if (currentField.length > 0 || currentRow.length > 0) {
      currentRow.push(currentField.trim());
      if (currentRow.some(val => val !== '')) {
        rows.push(currentRow);
      }
    }

    return rows;
  }

  parseMainCsv(csvText) {
    const rows = this.csvToArray(csvText);
    if (rows.length < 2) return [];

    const header = rows[0].map(h => h.toLowerCase());
    
    // Find column indices
    const idxRank = header.findIndex(h => h.includes('rank') && !h.includes('pos'));
    const idxPosRank = header.findIndex(h => h.includes('pos rank') || h.includes('pos_rank'));
    const idxName = header.findIndex(h => h.includes('player') || h.includes('name'));
    const idxPos = header.findIndex(h => h === 'pos' || h === 'position');
    const idxTeam = header.findIndex(h => h === 'team' || h === 'nfl');
    const idxBye = header.findIndex(h => h.includes('bye'));
    const idxTier = header.findIndex(h => h.includes('tier'));
    const idxPts = header.findIndex(h => h.includes('proj') || h.includes('pts') || h.includes('points'));
    const idxVal = header.findIndex(h => h.includes('baseline') || h.includes('val') || h.includes('value') || h.includes('price'));
    const idxTarget = header.findIndex(h => h.includes('target'));
    const idxHardMax = header.findIndex(h => h.includes('hard max') || h.includes('max'));
    const idxAav = header.findIndex(h => h.includes('aav') || h.includes('adp'));
    const idxOffense = header.findIndex(h => h.includes('offense'));
    const idxRole = header.findIndex(h => h.includes('role') || h.includes('usage'));
    const idxInjury = header.findIndex(h => h.includes('injury') || h.includes('durability'));
    const idxNotes = header.findIndex(h => h.includes('notes') || h.includes('scouting'));
    const idxRookie = header.findIndex(h => h.includes('rookie'));

    const players = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const name = idxName !== -1 ? r[idxName] : r[2];
      if (!name || name.trim() === '') continue;

      const pos = (idxPos !== -1 ? r[idxPos] : r[3] || 'FLEX').toUpperCase();
      const team = (idxTeam !== -1 ? r[idxTeam] : r[4] || 'FA').toUpperCase();
      const bye = idxBye !== -1 ? parseInt(r[idxBye], 10) : parseInt(r[5], 10);
      const tier = idxTier !== -1 ? r[idxTier] : (r[6] || 'Tier 5');
      const projPts = idxPts !== -1 ? parseFloat(r[idxPts].replace(/[$,]/g, '')) : parseFloat(r[7] || 0);
      const baselineVal = idxVal !== -1 ? parseFloat(r[idxVal].replace(/[$,]/g, '')) : parseFloat(r[8] || 1);
      const targetRange = idxTarget !== -1 ? r[idxTarget] : (r[9] || '');
      const hardMax = idxHardMax !== -1 ? parseFloat(r[idxHardMax].replace(/[$,]/g, '')) : baselineVal;
      const aav = idxAav !== -1 ? parseFloat(r[idxAav].replace(/[$,]/g, '')) : baselineVal;
      const offense = idxOffense !== -1 ? r[idxOffense] : (r[12] || '');
      const role = idxRole !== -1 ? r[idxRole] : (r[13] || '');
      const injury = idxInjury !== -1 ? r[idxInjury] : (r[14] || '');
      const notes = idxNotes !== -1 ? r[idxNotes] : (r[15] || '');
      players.push({
        id: `p_${i}`,
        rank: idxRank !== -1 ? parseInt(r[idxRank], 10) || i : i,
        posRank: idxPosRank !== -1 ? r[idxPosRank] : `${pos}${i}`,
        name: name.trim(),
        pos: pos.trim(),
        team: team.trim(),
        bye: isNaN(bye) ? null : bye,
        tier: tier.trim(),
        projPts: isNaN(projPts) ? 0 : projPts,
        baselineVal: isNaN(baselineVal) ? 1 : Math.max(1, baselineVal),
        targetRange: targetRange.trim(),
        hardMax: isNaN(hardMax) ? (isNaN(baselineVal) ? 1 : baselineVal) : hardMax,
        aav: isNaN(aav) ? (isNaN(baselineVal) ? 1 : baselineVal) : aav,
        offense: offense.trim(),
        role: role.trim(),
        injury: injury.trim(),
        notes: notes.trim(),
        isRookie: rookieStatus.includes('Rookie') || tier.includes('Rookie'),
        rookieStatus: rookieStatus.trim()
      });
    }

    return players;
  }

  parseRookieCsv(csvText) {
    const rows = this.csvToArray(csvText);
    if (rows.length < 2) return [];

    // Find header
    let headerIdx = 0;
    for (let i = 0; i < Math.min(10, rows.length); i++) {
      if (rows[i].some(c => c.toLowerCase().includes('player') || c.toLowerCase().includes('name'))) {
        headerIdx = i;
        break;
      }
    }

    const header = rows[headerIdx].map(h => h.toLowerCase());
    const idxName = header.findIndex(h => h.includes('player') || h.includes('name'));
    const idxPos = header.findIndex(h => h === 'pos' || h === 'position');
    const idxTeam = header.findIndex(h => h === 'team');
    const idxBye = header.findIndex(h => h.includes('bye'));
    const idxTier = header.findIndex(h => h.includes('tier'));
    const idxPts = header.findIndex(h => h.includes('proj') || h.includes('pts'));
    const idxVal = header.findIndex(h => h.includes('value') || h.includes('baseline'));
    const idxTarget = header.findIndex(h => h.includes('target'));
    const idxNotes = header.findIndex(h => h.includes('notes') || h.includes('scouting'));

    const rookies = [];
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const r = rows[i];
      const name = idxName !== -1 ? r[idxName] : r[2];
      if (!name || name.trim() === '') continue;

      rookies.push({
        rookieRank: i - headerIdx,
        posRank: r[1] || '',
        name: name.trim(),
        pos: (idxPos !== -1 ? r[idxPos] : r[3] || 'FLEX').toUpperCase(),
        team: (idxTeam !== -1 ? r[idxTeam] : r[4] || '').toUpperCase(),
        bye: idxBye !== -1 ? parseInt(r[idxBye], 10) : null,
        tier: idxTier !== -1 ? r[idxTier] : 'Tier 1',
        projPts: idxPts !== -1 ? parseFloat(r[idxPts].replace(/[$,]/g, '')) || 0 : 0,
        baselineVal: idxVal !== -1 ? parseFloat(r[idxVal].replace(/[$,]/g, '')) || 1 : 1,
        targetRange: idxTarget !== -1 ? r[idxTarget] : '',
        notes: idxNotes !== -1 ? r[idxNotes] : (r[15] || '')
      });
    }

    return rookies;
  }

  /**
   * Export draft history to CSV
   */
  exportDraftResultsCsv() {
    const history = this.store.state.draftHistory;
    if (history.length === 0) {
      alert("No draft picks have been made yet!");
      return;
    }

    const headers = ["Pick #", "Player Name", "Position", "NFL Team", "Winning Team", "Price ($)", "Baseline ($)", "Value Delta ($)", "Projected Pts", "Roster Slot"];
    const rows = history.map(h => [
      h.pickNumber,
      `"${h.playerName}"`,
      h.pos,
      h.teamNFL,
      `"${h.winningTeamName}"`,
      h.price,
      h.baselineVal,
      h.valueDelta,
      h.projPts,
      h.rosterSlot
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Draft_Results_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  /**
   * Export complete rosters for all 12 league teams to CSV (Commissioner format)
   */
  exportAllRostersCsv() {
    const teams = this.store.state.teams;
    const totalPicks = this.store.state.draftHistory.length;
    if (totalPicks === 0) {
      alert("No draft picks have been made yet!");
      return;
    }

    const headers = [
      "Team Name",
      "Roster Slot",
      "Player Name",
      "Position",
      "NFL Team",
      "Bye Week",
      "Draft Price ($)",
      "Projected Pts",
      "Tier"
    ];

    const rows = [];

    teams.forEach(t => {
      const starters = t.roster.starters || {};
      const bench = t.roster.bench || [];

      const slotConfigs = [
        { slot: 'QB1', player: starters.QB ? starters.QB[0] : null },
        { slot: 'RB1', player: starters.RB ? starters.RB[0] : null },
        { slot: 'RB2', player: starters.RB ? starters.RB[1] : null },
        { slot: 'WR1', player: starters.WR ? starters.WR[0] : null },
        { slot: 'WR2', player: starters.WR ? starters.WR[1] : null },
        { slot: 'FLEX1', player: starters.FLEX ? starters.FLEX[0] : null },
        { slot: 'FLEX2', player: starters.FLEX ? starters.FLEX[1] : null },
        { slot: 'K1', player: starters.K ? starters.K[0] : null },
        { slot: 'DST1', player: starters.DST ? starters.DST[0] : null }
      ];

      slotConfigs.forEach(s => {
        if (s.player) {
          rows.push([
            `"${t.name}"`,
            s.slot,
            `"${s.player.name}"`,
            s.player.pos,
            s.player.team,
            s.player.bye || "-",
            s.player.draftedPrice || 1,
            (s.player.projPts || 0).toFixed(1),
            `"${s.player.tier || ''}"`
          ]);
        } else {
          rows.push([
            `"${t.name}"`,
            s.slot,
            "EMPTY",
            "-",
            "-",
            "-",
            0,
            "0.0",
            "-"
          ]);
        }
      });

      // Bench slots (up to 6)
      for (let i = 0; i < 6; i++) {
        const bp = bench[i];
        if (bp) {
          rows.push([
            `"${t.name}"`,
            `BN${i + 1}`,
            `"${bp.name}"`,
            bp.pos,
            bp.team,
            bp.bye || "-",
            bp.draftedPrice || 1,
            (bp.projPts || 0).toFixed(1),
            `"${bp.tier || ''}"`
          ]);
        } else {
          rows.push([
            `"${t.name}"`,
            `BN${i + 1}`,
            "EMPTY",
            "-",
            "-",
            "-",
            0,
            "0.0",
            "-"
          ]);
        }
      }
    });

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `League_12Teams_Rosters_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  /**
   * Export all team rosters summary to JSON
   */
  exportFullLeagueJson() {
    const state = this.store.state;
    const jsonString = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state, null, 2));
    const link = document.createElement("a");
    link.setAttribute("href", jsonString);
    link.setAttribute("download", `Draft_State_Backup_${new Date().toISOString().slice(0,10)}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}
