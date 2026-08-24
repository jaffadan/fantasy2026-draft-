/**
 * Auction Draft Calculation & Valuation Engine
 * Custom tailored for:
 * - $200 Auction Cap per team (12 teams = $2,400 total)
 * - 15 total roster spots (9 starters: 1 QB, 2 RB, 2 WR, 2 FLEX [RB/WR/TE], 1 K, 1 DST, 6 Reserves)
 * - Minimum bid rule: must keep at least $1 per remaining starting spot
 * - Custom 0.5 PPR distance-bonus scoring
 */

export class DraftEngine {
  constructor(rules, players, teams) {
    this.rules = rules;
    this.players = players;
    this.teams = teams;
  }

  /**
   * Calculates the open starting slots needed for a team
   * Starters: 1 QB, 2 RB, 2 WR, 2 FLEX (RB/WR/TE), 1 K, 1 DST = 9 total
   */
  getOpenStartingSpots(teamRoster) {
    const required = {
      QB: 1,
      RB: 2,
      WR: 2,
      FLEX: 2,
      K: 1,
      DST: 1
    };

    const starters = teamRoster.starters || { QB: [], RB: [], WR: [], FLEX: [], K: [], DST: [] };
    
    let openCount = 0;
    openCount += Math.max(0, required.QB - (starters.QB ? starters.QB.length : 0));
    openCount += Math.max(0, required.RB - (starters.RB ? starters.RB.length : 0));
    openCount += Math.max(0, required.WR - (starters.WR ? starters.WR.length : 0));
    openCount += Math.max(0, required.FLEX - (starters.FLEX ? starters.FLEX.length : 0));
    openCount += Math.max(0, required.K - (starters.K ? starters.K.length : 0));
    openCount += Math.max(0, required.DST - (starters.DST ? starters.DST.length : 0));

    return openCount;
  }

  /**
   * Total roster count (starters + bench)
   */
  getTotalRosterCount(teamRoster) {
    const starters = teamRoster.starters || {};
    const starterCount = Object.values(starters).reduce((sum, arr) => sum + (arr ? arr.length : 0), 0);
    const benchCount = teamRoster.bench ? teamRoster.bench.length : 0;
    return starterCount + benchCount;
  }

  /**
   * Calculates a team's legal maximum bid according to league rules:
   * "Owners cannot submit a bid that would leave a balance less than $1 per open position on the starting roster."
   */
  calculateMaxBid(team) {
    const remainingBudget = team.budget - team.spent;
    if (remainingBudget <= 0) return 0;

    const totalPlayers = this.getTotalRosterCount(team.roster);
    if (totalPlayers >= 15) return 0; // Max roster reached

    const openStarters = this.getOpenStartingSpots(team.roster);

    if (openStarters <= 0) {
      // Starting lineup is complete! Can spend all remaining dollars on bench (or next player)
      return remainingBudget;
    }

    // Must leave at least $1 for each other open starter
    // i.e., maxBid + (openStarters - 1) * 1 <= remainingBudget
    const reservedDollars = Math.max(0, openStarters - 1);
    const maxBid = remainingBudget - reservedDollars;

    return Math.max(1, maxBid);
  }

  /**
   * Determine optimal slot for a newly drafted player
   * Roster constraints: 1 QB, 2 RB, 2 WR, 2 FLEX (RB/WR/TE), 1 K, 1 DST, 6 Bench
   */
  assignRosterSlot(roster, player) {
    const r = JSON.parse(JSON.stringify(roster));
    if (!r.starters) {
      r.starters = { QB: [], RB: [], WR: [], FLEX: [], K: [], DST: [] };
    }
    if (!r.bench) {
      r.bench = [];
    }

    const pos = player.pos;

    // Check primary starter slot
    if (pos === 'QB' && r.starters.QB.length < 1) {
      r.starters.QB.push(player);
      return { roster: r, slot: 'QB' };
    }
    if (pos === 'RB' && r.starters.RB.length < 2) {
      r.starters.RB.push(player);
      return { roster: r, slot: 'RB' };
    }
    if (pos === 'WR' && r.starters.WR.length < 2) {
      r.starters.WR.push(player);
      return { roster: r, slot: 'WR' };
    }
    if (pos === 'K' && r.starters.K.length < 1) {
      r.starters.K.push(player);
      return { roster: r, slot: 'K' };
    }
    if (pos === 'DST' && r.starters.DST.length < 1) {
      r.starters.DST.push(player);
      return { roster: r, slot: 'DST' };
    }

    // Check Flex slot (RB, WR, TE)
    if ((pos === 'RB' || pos === 'WR' || pos === 'TE') && r.starters.FLEX.length < 2) {
      r.starters.FLEX.push(player);
      return { roster: r, slot: 'FLEX' };
    }

    // Check Bench (max 6)
    if (r.bench.length < 6) {
      r.bench.push(player);
      return { roster: r, slot: 'BENCH' };
    }

    // Roster full
    return { roster: r, slot: 'OVERFLOW' };
  }

  /**
   * Calculates dynamic inflation factor and adjusted player dollar values
   *
   * Inflation Formula:
   * Remaining Cash Pool = Total Remaining League Budget - (Remaining Open Starters * $1)
   * Remaining Baseline Value = Sum of baseline values of top remaining un-drafted players needed to fill starters
   * Inflation Factor = Remaining Cash Pool / Remaining Baseline Value
   */
  calculateInflation(players, teams) {
    const totalLeagueCap = 12 * 200; // $2,400
    const totalSpent = teams.reduce((acc, t) => acc + (t.spent || 0), 0);
    const remainingLeagueCash = totalLeagueCap - totalSpent;

    // Count remaining starters needed across all 12 teams
    let totalStartersNeeded = 0;
    let startersNeededByPos = { QB: 0, RB: 0, WR: 0, FLEX: 0, K: 0, DST: 0 };

    teams.forEach(t => {
      const s = t.roster.starters || {};
      const qbNeed = Math.max(0, 1 - (s.QB ? s.QB.length : 0));
      const rbNeed = Math.max(0, 2 - (s.RB ? s.RB.length : 0));
      const wrNeed = Math.max(0, 2 - (s.WR ? s.WR.length : 0));
      const flexNeed = Math.max(0, 2 - (s.FLEX ? s.FLEX.length : 0));
      const kNeed = Math.max(0, 1 - (s.K ? s.K.length : 0));
      const dstNeed = Math.max(0, 1 - (s.DST ? s.DST.length : 0));

      startersNeededByPos.QB += qbNeed;
      startersNeededByPos.RB += rbNeed;
      startersNeededByPos.WR += wrNeed;
      startersNeededByPos.FLEX += flexNeed;
      startersNeededByPos.K += kNeed;
      startersNeededByPos.DST += dstNeed;

      totalStartersNeeded += (qbNeed + rbNeed + wrNeed + flexNeed + kNeed + dstNeed);
    });

    const draftedPlayers = players.filter(p => p.drafted);
    const undraftedPlayers = players.filter(p => !p.drafted);
    const sortedUndrafted = [...undraftedPlayers].sort((a, b) => (b.baselineVal || 0) - (a.baselineVal || 0));

    // Top remaining players needed to fill starters
    const topStartersPool = sortedUndrafted.slice(0, Math.max(totalStartersNeeded, 1));
    const remainingBaselineSum = topStartersPool.reduce((acc, p) => acc + Math.max(1, p.baselineVal || 1), 0);

    // Positional Inflation Calculations
    const positions = ['QB', 'RB', 'WR', 'TE', 'K', 'DST'];
    const positionalInflation = {};

    positions.forEach(pos => {
      const posDrafted = draftedPlayers.filter(p => p.pos === pos);
      const posUndrafted = undraftedPlayers.filter(p => p.pos === pos).sort((a, b) => (b.baselineVal || 0) - (a.baselineVal || 0));
      const posSpent = posDrafted.reduce((acc, p) => acc + (p.draftedPrice || 0), 0);
      const posDraftedBase = posDrafted.reduce((acc, p) => acc + (p.baselineVal || 1), 0);
      const posSurplus = posSpent - posDraftedBase;

      // Starters needed for this position
      let needed = 0;
      if (pos === 'FLEX') {
        needed = startersNeededByPos.FLEX;
      } else if (startersNeededByPos[pos] !== undefined) {
        needed = startersNeededByPos[pos];
      }
      
      const posRemainBaseSum = posUndrafted.slice(0, Math.max(needed, 1)).reduce((acc, p) => acc + Math.max(1, p.baselineVal || 1), 0);

      let posRate = 1.0;
      if (posDrafted.length > 0 && posRemainBaseSum > 0) {
        posRate = Math.max(0.3, Math.min(3.0, 1.0 + (posSurplus / Math.max(20, posRemainBaseSum))));
      }

      positionalInflation[pos] = {
        totalSpent: posSpent,
        baselineSum: posDraftedBase,
        delta: posSurplus,
        inflationRate: posRate,
        inflationPercent: Math.round((posRate - 1.0) * 100),
        isHot: posRate > 1.05,
        isCold: posRate < 0.95
      };
    });

    // If no picks have been made yet, inflation is exactly 0% (1.00x)
    if (draftedPlayers.length === 0) {
      return {
        totalSpent: 0,
        remainingLeagueCash,
        totalStartersNeeded,
        startersNeededByPos,
        inflationRate: 1.0,
        inflationPercent: 0,
        isInflated: false,
        isDeflated: false,
        positionalInflation
      };
    }

    // Measure net dollars over/under paid against baseline valuations
    const draftedBaseSum = draftedPlayers.reduce((acc, p) => acc + (p.baselineVal || 1), 0);
    const netSurplusSpent = totalSpent - draftedBaseSum;

    // Inflation rate is driven by net over/under-spending distributed across remaining starter talent pool
    const inflationRate = Math.max(0.4, Math.min(2.5, 1.0 + (netSurplusSpent / Math.max(50, remainingBaselineSum))));

    return {
      totalSpent,
      remainingLeagueCash,
      totalStartersNeeded,
      startersNeededByPos,
      inflationRate,
      inflationPercent: Math.round((inflationRate - 1.0) * 100),
      isInflated: inflationRate > 1.02,
      isDeflated: inflationRate < 0.98,
      positionalInflation
    };
  }

  /**
   * Optimal Roster Rebalancer
   * Optimizes starter slots across:
   * 1 QB, 2 RB, 2 WR, 2 FLEX (RB/WR/TE), 1 K, 1 DST, up to 6 Bench
   * Ensures high-projection players and position-restricted players (like TEs who can ONLY go to FLEX)
   * are allocated to starters to maximize projected starting lineup points.
   */
  optimizeTeamRoster(teamRoster) {
    const starters = teamRoster.starters || {};
    const bench = teamRoster.bench || [];
    const allPlayers = [
      ...(starters.QB || []),
      ...(starters.RB || []),
      ...(starters.WR || []),
      ...(starters.FLEX || []),
      ...(starters.K || []),
      ...(starters.DST || []),
      ...bench
    ];

    if (allPlayers.length === 0) {
      return {
        starters: { QB: [], RB: [], WR: [], FLEX: [], K: [], DST: [] },
        bench: []
      };
    }

    // Sort all players descending by projected points
    const sorted = [...allPlayers].sort((a, b) => (b.projPts || 0) - (a.projPts || 0));

    const newStarters = { QB: [], RB: [], WR: [], FLEX: [], K: [], DST: [] };
    const newBench = [];

    // 1. Assign QB (max 1)
    const qbs = sorted.filter(p => p.pos === 'QB');
    if (qbs.length > 0) {
      newStarters.QB.push(qbs[0]);
    }

    // 2. Assign K (max 1)
    const ks = sorted.filter(p => p.pos === 'K');
    if (ks.length > 0) {
      newStarters.K.push(ks[0]);
    }

    // 3. Assign DST (max 1)
    const dsts = sorted.filter(p => p.pos === 'DST');
    if (dsts.length > 0) {
      newStarters.DST.push(dsts[0]);
    }

    // 4. Assign Primary RBs (up to 2)
    const rbs = sorted.filter(p => p.pos === 'RB');
    const primaryRBs = rbs.slice(0, 2);
    primaryRBs.forEach(p => newStarters.RB.push(p));

    // 5. Assign Primary WRs (up to 2)
    const wrs = sorted.filter(p => p.pos === 'WR');
    const primaryWRs = wrs.slice(0, 2);
    primaryWRs.forEach(p => newStarters.WR.push(p));

    // 6. Assign FLEX (up to 2 from remaining RB, WR, TE)
    // Identify who is already assigned
    const assignedIds = new Set([
      ...newStarters.QB.map(p => p.id),
      ...newStarters.K.map(p => p.id),
      ...newStarters.DST.map(p => p.id),
      ...newStarters.RB.map(p => p.id),
      ...newStarters.WR.map(p => p.id)
    ]);

    const flexEligible = sorted.filter(p => ['RB', 'WR', 'TE'].includes(p.pos) && !assignedIds.has(p.id));
    const flexStarters = flexEligible.slice(0, 2);
    flexStarters.forEach(p => {
      newStarters.FLEX.push(p);
      assignedIds.add(p.id);
    });

    // 7. Place everything else on Bench (up to 6)
    sorted.forEach(p => {
      if (!assignedIds.has(p.id)) {
        if (newBench.length < 6) {
          newBench.push(p);
        } else {
          newBench.push(p); // overflow if over 15
        }
      }
    });

    return {
      starters: newStarters,
      bench: newBench
    };
  }

  /**
   * Tier Cliff & Scarcity Tracker
   * Checks if this player is 1 of 1 or 1 of 2 remaining in their tier at their position
   */
  getTierScarcity(player, undraftedPlayers) {
    if (!player || !player.tier) return null;

    const sameTierPos = undraftedPlayers.filter(p => 
      p.pos === player.pos && 
      p.tier === player.tier && 
      !p.drafted
    );

    const count = sameTierPos.length;
    if (count === 1) {
      return {
        isCliff: true,
        remainingCount: 1,
        tierName: player.tier,
        pos: player.pos,
        badgeText: `🔥 LAST ${player.pos} IN ${player.tier.toUpperCase()}!`,
        alertMessage: `This is the final remaining ${player.tier} ${player.pos} available on the board. Bidding will be highly competitive.`
      };
    } else if (count === 2) {
      return {
        isCliff: false,
        isNearCliff: true,
        remainingCount: 2,
        tierName: player.tier,
        pos: player.pos,
        badgeText: `⚠️ ONLY 2 ${player.pos}s LEFT IN ${player.tier.toUpperCase()}`,
        alertMessage: `Only 2 ${player.tier} ${player.pos}s remain. Position tier cliff approaching!`
      };
    }

    return null;
  }

  /**
   * Opponent Bidding Threat Radar
   * Evaluates all rival teams to see who has open starting needs at this position and cash to bid
   */
  getOpponentBiddingThreats(player, teams, userTeamId) {
    const threats = [];

    teams.forEach(t => {
      if (t.id === userTeamId) return; // skip user team

      const starters = t.roster.starters || {};
      const maxBid = this.calculateMaxBid(t);
      const remainingCash = t.budget - (t.spent || 0);

      // Check if team needs this position
      let hasNeed = false;
      let needDescription = '';

      if (player.pos === 'QB' && (!starters.QB || starters.QB.length < 1)) {
        hasNeed = true;
        needDescription = 'Needs QB1';
      } else if (player.pos === 'RB' && (!starters.RB || starters.RB.length < 2)) {
        hasNeed = true;
        needDescription = `Needs RB${(starters.RB?.length || 0) + 1}`;
      } else if (player.pos === 'WR' && (!starters.WR || starters.WR.length < 2)) {
        hasNeed = true;
        needDescription = `Needs WR${(starters.WR?.length || 0) + 1}`;
      } else if (['RB', 'WR', 'TE'].includes(player.pos) && (!starters.FLEX || starters.FLEX.length < 2)) {
        hasNeed = true;
        needDescription = `Needs FLEX${(starters.FLEX?.length || 0) + 1}`;
      } else if (player.pos === 'K' && (!starters.K || starters.K.length < 1)) {
        hasNeed = true;
        needDescription = 'Needs K';
      } else if (player.pos === 'DST' && (!starters.DST || starters.DST.length < 1)) {
        hasNeed = true;
        needDescription = 'Needs DST';
      }

      if (hasNeed && maxBid >= (player.baselineVal ? Math.min(10, player.baselineVal * 0.5) : 1)) {
        threats.push({
          teamId: t.id,
          teamName: t.name,
          maxBid,
          remainingCash,
          needDescription,
          threatLevel: maxBid >= (player.baselineVal || 1) ? 'HIGH' : 'MEDIUM'
        });
      }
    });

    // Sort threats: highest maxBid first
    threats.sort((a, b) => b.maxBid - a.maxBid);

    return threats;
  }

  /**
   * Computes dynamic auction valuation for a single player based on inflation rate
   */
  getDynamicPlayerValue(player, inflationRate) {
    if (!player.baselineVal || player.baselineVal <= 1) {
      return 1;
    }
    // High-value players absorb more of the inflation/deflation variance
    const base = player.baselineVal;
    let dyn = Math.round(base * inflationRate);
    return Math.max(1, dyn);
  }

  /**
   * Tactical Bidding Recommendation Engine
   * Evaluates if the user should bid on a player and what the max ceiling should be
   */
  getBiddingAdvice(player, userTeam, inflationRate) {
    const userMaxBid = this.calculateMaxBid(userTeam);
    const dynamicVal = this.getDynamicPlayerValue(player, inflationRate);
    const openStarters = this.getOpenStartingSpots(userTeam.roster);
    const remainingBudget = userTeam.budget - userTeam.spent;

    // Check if player fits team needs
    const starters = userTeam.roster.starters || {};
    let needLevel = 'LOW';
    if (player.pos === 'QB' && (!starters.QB || starters.QB.length < 1)) needLevel = 'CRITICAL';
    else if (player.pos === 'RB' && (!starters.RB || starters.RB.length < 2)) needLevel = 'HIGH';
    else if (player.pos === 'WR' && (!starters.WR || starters.WR.length < 2)) needLevel = 'HIGH';
    else if (['RB', 'WR', 'TE'].includes(player.pos) && (!starters.FLEX || starters.FLEX.length < 2)) needLevel = 'MEDIUM';
    else if (['K', 'DST'].includes(player.pos) && (!starters[player.pos] || starters[player.pos].length < 1)) needLevel = 'STREAM';

    // Target bid ceiling for user
    const suggestedCeiling = Math.min(userMaxBid, player.hardMax ? Math.round(player.hardMax * inflationRate) : Math.round(dynamicVal * 1.1));
    const targetBid = Math.min(userMaxBid, dynamicVal);

    let status = 'TARGET';
    let badgeClass = 'text-emerald-400 bg-emerald-950/60 border-emerald-800';
    let message = `Strong fit. Recommended bid up to $${targetBid} (Hard max $${suggestedCeiling})`;

    if (userMaxBid < 2) {
      status = 'BUDGET CRITICAL';
      badgeClass = 'text-rose-400 bg-rose-950/60 border-rose-800';
      message = 'Preserve remaining dollars for mandatory $1 starter slots.';
    } else if (dynamicVal > userMaxBid) {
      status = 'PRICED OUT';
      badgeClass = 'text-amber-400 bg-amber-950/60 border-amber-800';
      message = `Player value ($${dynamicVal}) exceeds your max bid ($${userMaxBid}).`;
    } else if (player.isDND) {
      status = 'DO NOT DRAFT';
      badgeClass = 'text-red-400 bg-red-950/60 border-red-800';
      message = 'Player marked on your Do-Not-Draft blacklist.';
    }

    return {
      status,
      badgeClass,
      message,
      needLevel,
      targetBid,
      suggestedCeiling,
      userMaxBid
    };
  }

  /**
   * Serpentine nomination order helper
   * Supports:
   * 1. Custom draft order set on draft night
   * 2. Automatic elimination/skipping of teams that run out of cash ($0 left) or reach max 15-player roster limit
   * 3. Dynamic resizing of the serpentine round across active/eligible teams
   */
  getNominationTeam(pickNumber, teams, customOrder = null) {
    let orderedTeams = [...teams];
    if (customOrder && Array.isArray(customOrder) && customOrder.length > 0) {
      const teamMap = new Map(teams.map(t => [t.id, t]));
      const mapped = customOrder.map(id => teamMap.get(id)).filter(Boolean);
      // Append any team missing from customOrder
      teams.forEach(t => {
        if (!mapped.find(mt => mt.id === t.id)) {
          mapped.push(t);
        }
      });
      orderedTeams = mapped;
    }

    // Filter to ELIGIBLE teams only:
    // A team is out of the nomination rotation if they have $0 remaining cash OR their 15-player roster is full
    const eligibleTeams = orderedTeams.filter(t => {
      const remainingCash = t.budget - (t.spent || 0);
      const totalRostered = this.getTotalRosterCount(t.roster);
      return remainingCash > 0 && totalRostered < 15;
    });

    if (eligibleTeams.length === 0) {
      // Draft complete! All teams full or out of money
      return {
        pickNumber,
        round: 15,
        team: orderedTeams[0] || teams[0],
        isDraftComplete: true,
        eligibleCount: 0,
        eligibleTeams: []
      };
    }

    const numEligible = eligibleTeams.length;
    const round = Math.floor((pickNumber - 1) / numEligible);
    const roundPick = (pickNumber - 1) % numEligible;
    
    // Serpentine logic over the active/eligible teams
    let teamIndex;
    if (round % 2 === 0) {
      teamIndex = roundPick;
    } else {
      teamIndex = numEligible - 1 - roundPick;
    }

    return {
      pickNumber,
      round: round + 1,
      team: eligibleTeams[teamIndex] || eligibleTeams[0],
      isDraftComplete: false,
      eligibleCount: numEligible,
      eligibleTeams
    };
  }

  /**
   * Calculate bye week conflicts for drafted team
   */
  checkByeConflicts(roster) {
    const byes = {};
    const starters = roster.starters || {};

    Object.values(starters).forEach(list => {
      list.forEach(p => {
        if (p.bye) {
          byes[p.bye] = (byes[p.bye] || 0) + 1;
        }
      });
    });

    const warnings = [];
    for (const [bye, count] of Object.entries(byes)) {
      if (count >= 3) {
        warnings.push(`Week ${bye} Bye Conflict: ${count} starters off!`);
      }
    }

    return warnings;
  }
}

