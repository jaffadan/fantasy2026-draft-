const fs = require('fs');
const path = require('path');

const dataFilePath = path.join(__dirname, '..', 'data', 'default_data.json');
const raw = JSON.parse(fs.readFileSync(dataFilePath, 'utf8'));

// Custom calibrated values dictionary for league rules (6pt PaTD, distance bonuses, flex-only TE)
const calibratedOverrides = {
  // QBs (6pt PaTD boosted)
  'Josh Allen': { val: 25, target: '$22-$28', max: 30, pts: 418.5, note: '[VALUE PICK - 6PT PaTD + GOAL-LINE RUSHING GOD] Highest fantasy ceiling in football. 6pt PaTD + QB sneak volume makes him an undisputed auction priority.' },
  'Lamar Jackson': { val: 23, target: '$20-$26', max: 28, pts: 402.0, note: '[VALUE PICK - 6PT PaTD + ELITE RUSHING FLOOR] Unstoppable dual-threat MVP with rushing floor and improved passing weapons.' },
  'Jalen Hurts': { val: 21, target: '$18-$24', max: 26, pts: 388.5, note: '[VALUE PICK - 6PT PaTD + TUSH PUSH TD FLOOR] Guaranteed 10+ rushing TD floor with elite WR tandem (AJB + Smith).' },
  'Jayden Daniels': { val: 19, target: '$16-$22', max: 24, pts: 382.0, note: '[VALUE PICK - YEAR 2 BREAKOUT] Dual-threat superstar with explosive rushing speed and aggressive downfield accuracy.' },
  'Patrick Mahomes': { val: 16, target: '$13-$18', max: 20, pts: 374.0, note: '[VALUE PICK - 6PT PaTD PASS VOLUME] Elite passing yardage & touchdown floor in Andy Reid offense with Worthy + Rice.' },
  'Drake Maye': { val: 15, target: '$12-$17', max: 19, pts: 368.0, note: 'Massive dual-threat arm and mobility entering Year 2 with upgraded weapons.' },
  'Joe Burrow': { val: 14, target: '$11-$16', max: 18, pts: 366.0, note: 'Pure pocket sniper throwing to Ja\'Marr Chase & Tee Higgins; massive 6pt PaTD upside.' },
  'C.J. Stroud': { val: 13, target: '$10-$15', max: 17, pts: 362.0, note: 'Elite deep ball passer benefiting from Nico Collins, Tank Dell, and Stefon Diggs.' },
  'Kyler Murray': { val: 12, target: '$9-$14', max: 16, pts: 358.0, note: 'Dynamic dual-threat quarterback feeding Marvin Harrison Jr. and Trey McBride.' },
  'Jordan Love': { val: 11, target: '$8-$13', max: 15, pts: 352.0, note: 'High-efficiency red zone passer in Matt LaFleur spread offense.' },
  'Baker Mayfield': { val: 9, target: '$6-$11', max: 13, pts: 344.0, note: 'Aggressive gunslinger with elite weapons in Evans and Godwin.' },
  'Caleb Williams': { val: 9, target: '$6-$11', max: 13, pts: 342.0, note: 'Dynamic Year 2 playmaker with Moore, Odunze, and Allen target tree.' },
  'Bo Nix': { val: 8, target: '$5-$10', max: 12, pts: 338.0, note: 'Sneaky rushing mobility and quick-strike Sean Payton offensive system.' },
  'Brock Purdy': { val: 7, target: '$4-$9', max: 11, pts: 335.0, note: 'Point-guard distributor surrounded by elite 49ers playmakers.' },
  'Jared Goff': { val: 6, target: '$3-$8', max: 10, pts: 330.0, note: 'Immaculate clean-pocket distributor in Ben Johnson top-3 scoring offense.' },
  'Trevor Lawrence': { val: 5, target: '$2-$7', max: 9, pts: 325.0, note: 'Armed with Brian Thomas Jr. deep threat and Christian Kirk slot security.' },
  'Justin Herbert': { val: 5, target: '$2-$7', max: 9, pts: 322.0, note: 'Elite arm talent in run-heavy Harbaugh/Roman scheme; late-game comeback volume.' },

  // RBs (Explosive distance bonuses + bellcow share)
  'Jahmyr Gibbs': { val: 60, target: '$56-$63', max: 66, pts: 335.0, note: '[PRIME SMASH TARGET - EXPLOSIVE TD MULTIPLIER] League-winner in distance bonus scoring. Breakaway speed creates monster 50+ yard scoring weeks.' },
  'Bijan Robinson': { val: 58, target: '$54-$61', max: 64, pts: 328.0, note: 'True three-down bellcow with immense receiving and goal-line domination.' },
  'Christian McCaffrey': { val: 50, target: '$46-$53', max: 56, pts: 302.0, note: 'Per-game fantasy king in Shanahan offense. Elite PPR & red zone touch floor.' },
  'Jonathan Taylor': { val: 48, target: '$44-$51', max: 54, pts: 295.0, note: 'Workhorse behind dominant Colts offensive line with elite breakaway home-run ability.' },
  'De\'Von Achane': { val: 44, target: '$40-$47', max: 50, pts: 288.0, note: '[VALUE PICK - DISTANCE BONUS PHENOM] Historical yards per touch efficiency; hits 40+ and 50+ yard scoring bonuses at highest rate in NFL.' },
  'James Cook III': { val: 40, target: '$36-$43', max: 46, pts: 278.0, note: 'Explosive Bills lead back with heavy passing game role in Josh Allen offense.' },
  'Ashton Jeanty': { val: 38, target: '$34-$41', max: 44, pts: 274.0, note: '[ELITE ROOKIE BELLCOW] Generational college prospect stepping into heavy NFL workload.' },
  'Saquon Barkley': { val: 36, target: '$32-$39', max: 42, pts: 268.0, note: 'Dominant rushing share and goal-line opportunities behind elite Eagles offensive line.' },
  'Chase Brown': { val: 35, target: '$31-$38', max: 41, pts: 265.0, note: 'Explosive 4.43 speed in high-scoring Bengals attack with unchallenged lead role.' },
  'Breece Hall': { val: 34, target: '$30-$37', max: 40, pts: 262.0, note: 'Dual-threat bellcow with elite pass-catching floor and breakaway speed.' },
  'Kyren Williams': { val: 33, target: '$29-$36', max: 39, pts: 258.0, note: 'Sean McVay red-zone touchdown vacuum with immense snap share.' },
  'Derrick Henry': { val: 32, target: '$28-$35', max: 38, pts: 254.0, note: 'Goal-line hammer in lethal Ravens option offense with Lamar Jackson.' },
  'Josh Jacobs': { val: 30, target: '$26-$33', max: 36, pts: 248.0, note: 'Packers workhorse with guaranteed volume in top-10 scoring offense.' },
  'Kenneth Walker III': { val: 28, target: '$24-$31', max: 34, pts: 242.0, note: '[DISTANCE BONUS THREAT] Home-run hitter with explosive burst in Ryan Grubb offense.' },
  'Joe Mixon': { val: 26, target: '$22-$29', max: 32, pts: 236.0, note: 'Reliable three-down role and goal-line domination in explosive Texans offense.' },
  'Travis Etienne Jr.': { val: 24, target: '$20-$27', max: 30, pts: 230.0, note: 'Dynamic space weapon with receiving chops and big-play upside.' },
  'Alvin Kamara': { val: 22, target: '$18-$25', max: 28, pts: 224.0, note: 'High-volume receiving back and red-zone operator.' },
  'Isiah Pacheco': { val: 22, target: '$18-$25', max: 28, pts: 222.0, note: 'Violent downhill runner in elite Chiefs offensive system.' },
  'David Montgomery': { val: 20, target: '$16-$23', max: 26, pts: 218.0, note: 'Goal-line touch monster behind dominant Lions offensive line.' },
  'Brian Robinson Jr.': { val: 18, target: '$14-$21', max: 24, pts: 212.0, note: 'Early-down and short-yardage thumper in high-scoring Commanders offense.' },
  'Aaron Jones': { val: 18, target: '$14-$21', max: 24, pts: 210.0, note: 'Hyper-efficient runner and receiver in Kevin O\'Connell scheme.' },
  'Jonathon Brooks': { val: 18, target: '$14-$21', max: 24, pts: 206.0, note: '[VALUE PICK - POST-ACL UPSIDE] Top tier collegiate back with 3-down skillset taking over Panthers backfield.' },
  'D\'Andre Swift': { val: 16, target: '$12-$19', max: 22, pts: 204.0, note: 'Dual-threat back in versatile Shane Waldron attack.' },
  'Tony Pollard': { val: 15, target: '$11-$18', max: 21, pts: 198.0, note: 'Lead rusher with pass-game involvement.' },
  'Trey Benson': { val: 15, target: '$11-$18', max: 21, pts: 194.0, note: '[VALUE SLEEPER] 4.39 speed workhorse with massive standalone and contingent ceiling.' },
  'Najee Harris': { val: 14, target: '$10-$17', max: 20, pts: 192.0, note: 'Early-down power back in Arthur Smith run-heavy scheme.' },
  'Jaylen Warren': { val: 13, target: '$9-$16', max: 19, pts: 184.0, note: 'High-efficiency passing downs back with explosive tackle-breaking.' },
  'Zach Charbonnet': { val: 11, target: '$7-$14', max: 17, pts: 176.0, note: 'Versatile 3-down back with high standalone flex floor & elite cuff upside.' },
  'Tyjae Spears': { val: 10, target: '$6-$13', max: 16, pts: 172.0, note: 'Electric space creator with breakaway ability in Titans spread.' },

  // WRs (Distance bonus scaling + alpha target shares)
  'Ja\'Marr Chase': { val: 58, target: '$54-$61', max: 64, pts: 325.0, note: '[SMASH TARGET - HIGHEST DEEP BONUS CEILING] #1 wide receiver in format. Burrow\'s alpha target with unrivaled 40-70+ yard touchdown bonus generation.' },
  'Puka Nacua': { val: 54, target: '$50-$57', max: 60, pts: 312.0, note: 'Target sponge in McVay offense. Elite route separation and 10+ target weekly floor.' },
  'Jaxon Smith-Njigba': { val: 50, target: '$46-$53', max: 56, pts: 304.0, note: 'Alpha Year 3 ascending superstar dominating target share in Seattle spread system.' },
  'Amon-Ra St. Brown': { val: 49, target: '$45-$52', max: 55, pts: 300.0, note: 'The Sun God. Flawless intermediate separator and red zone favorite in Lions machine.' },
  'CeeDee Lamb': { val: 46, target: '$42-$49', max: 52, pts: 290.0, note: '30%+ target share monster with slot and outside versatility.' },
  'Justin Jefferson': { val: 45, target: '$41-$48', max: 51, pts: 286.0, note: 'Uncoverable route runner with unmatched weekly yardage ceiling.' },
  'Nico Collins': { val: 38, target: '$34-$41', max: 44, pts: 272.0, note: '[VALUE PICK - AIR YARDS & BIG PLAY MONSTER] 3.1+ yards per route run beast. Deep ball synergy with C.J. Stroud produces huge bonus points.' },
  'Malik Nabers': { val: 36, target: '$32-$39', max: 42, pts: 268.0, note: '[VALUE PICK - IMMENSE TARGET FUNNEL + RAC] Ascending superstar with 32%+ target rate and electric after-catch burst.' },
  'Drake London': { val: 35, target: '$31-$38', max: 41, pts: 265.0, note: 'Contested catch alpha in Zac Robinson high-volume passing offense.' },
  'A.J. Brown': { val: 34, target: '$30-$37', max: 40, pts: 262.0, note: 'Physical monster with devastating slant RAC ability and deep touchdown bonuses.' },
  'Marvin Harrison Jr.': { val: 32, target: '$28-$35', max: 38, pts: 256.0, note: 'Elite technician and primary perimeter alpha for Kyler Murray.' },
  'Garrett Wilson': { val: 30, target: '$26-$33', max: 36, pts: 250.0, note: 'Acrobatic separator with immense target share in upgraded passing scheme.' },
  'Brian Thomas Jr.': { val: 28, target: '$24-$31', max: 34, pts: 244.0, note: '[VALUE PICK - 4.33 SPEED HOME-RUN BONUS KING] Explosive perimeter deep threat who hits maximum distance bonus multipliers on long touchdowns.' },
  'George Pickens': { val: 25, target: '$21-$28', max: 31, pts: 238.0, note: '[VALUE PICK - AIR YARDS DOMINATOR] Dominates contested deep targets and downfield yardage.' },
  'Tyreek Hill': { val: 26, target: '$22-$29', max: 32, pts: 240.0, note: 'Speed merchant who can win weeks with 60+ yard distance bonus touchdowns.' },
  'Jaylen Waddle': { val: 24, target: '$20-$27', max: 30, pts: 234.0, note: 'Explosive complementary deep threat in Miami high-motion offense.' },
  'DK Metcalf': { val: 24, target: '$20-$27', max: 30, pts: 232.0, note: 'Physically imposing perimeter burner in Ryan Grubb vertical passing attack.' },
  'DeVonta Smith': { val: 22, target: '$18-$25', max: 28, pts: 226.0, note: 'Silky smooth route separator with immense per-target efficiency.' },
  'Chris Olave': { val: 22, target: '$18-$25', max: 28, pts: 224.0, note: 'High-volume target funnel in Klint Kubiak motion scheme.' },
  'DJ Moore': { val: 20, target: '$16-$23', max: 26, pts: 218.0, note: 'YAC dominator and red-zone favorite in Chicago offense.' },
  'Tee Higgins': { val: 20, target: '$16-$23', max: 26, pts: 216.0, note: 'Boundary contested-catch monster in Joe Burrow passing attack.' },
  'Rashee Rice': { val: 20, target: '$16-$23', max: 26, pts: 214.0, note: 'Underneath crossing route specialist and RAC weapon for Mahomes.' },
  'Zay Flowers': { val: 18, target: '$14-$21', max: 24, pts: 208.0, note: 'Dynamic open-field creator with expanding route tree for Lamar Jackson.' },
  'Tank Dell': { val: 18, target: '$14-$21', max: 24, pts: 206.0, note: 'Electric deep-ball separator and red-zone creator with C.J. Stroud.' },
  'Terry McLaurin': { val: 17, target: '$13-$20', max: 23, pts: 202.0, note: 'Uncontested primary weapon for Jayden Daniels.' },
  'Michael Pittman Jr.': { val: 16, target: '$12-$19', max: 22, pts: 198.0, note: 'Chain-moving target vacuum in Shane Steichen system.' },
  'Mike Evans': { val: 16, target: '$12-$19', max: 22, pts: 196.0, note: 'Legendary 1,000-yard streak machine and primary red-zone touchdown threat.' },
  'Jameson Williams': { val: 16, target: '$12-$19', max: 22, pts: 198.0, note: '[VALUE PICK - 50+ YD TD MACHINE] Elite deep burner in high-scoring Lions offense; huge distance bonus multiplier.' },
  'Ladd McConkey': { val: 16, target: '$12-$19', max: 22, pts: 192.0, note: '[VALUE PICK - TARGET SHARE MONSTER] Undisputed slot/flanker alpha separator for Justin Herbert.' },
  'Xavier Worthy': { val: 15, target: '$11-$18', max: 21, pts: 188.0, note: '[DISTANCE BONUS WEAPON] 4.21 speed deployed downfield by Patrick Mahomes.' },
  'Rome Odunze': { val: 14, target: '$10-$17', max: 20, pts: 184.0, note: 'Ascending Year 2 boundary alpha with complete 3-level route tree.' },
  'Keon Coleman': { val: 13, target: '$9-$16', max: 19, pts: 178.0, note: 'Contested catch playmaker and red-zone endzone threat for Josh Allen.' },
  'Khalil Shakir': { val: 13, target: '$9-$16', max: 19, pts: 176.0, note: '[SLOT ALPHA] Unbelievable catch rate and RAC efficiency with Josh Allen.' },
  'Rashid Shaheed': { val: 12, target: '$8-$15', max: 18, pts: 172.0, note: '[DEEP THREAT BONUS] True 4.30 speedster who regularly triggers 50+ yard distance bonuses.' },

  // TEs (Flex-only discount: only Bowers, McBride, Kittle warrant draft capital)
  'Brock Bowers': { val: 28, target: '$24-$31', max: 34, pts: 255.0, note: '[SMASH TARGET - WR1 TRAJECTORY AT FLEX] Only TE in football with legitimate top-10 WR target share and RAC explosiveness.' },
  'Trey McBride': { val: 18, target: '$15-$21', max: 24, pts: 230.0, note: 'Target sponge over middle of field with high PPR floor for Kyler Murray.' },
  'George Kittle': { val: 13, target: '$10-$15', max: 17, pts: 195.0, note: 'Elite efficiency, tackle-breaking RAC, and red zone touchdown threat.' },
  'Colston Loveland': { val: 8, target: '$5-$10', max: 12, pts: 180.0, note: '[FLEX-ONLY DISCOUNT] Athletic rookie tight end with receiving profile.' },
  'Sam LaPorta': { val: 7, target: '$4-$9', max: 11, pts: 170.0, note: '[FLEX-ONLY DISCOUNT] Red zone weapon in crowded Lions passing tree.' },
  'Mark Andrews': { val: 6, target: '$3-$8', max: 10, pts: 165.0, note: '[FLEX-ONLY DISCOUNT] Veteran red zone favorite sharing snaps with Isaiah Likely.' },
  'Dalton Kincaid': { val: 5, target: '$3-$7', max: 9, pts: 160.0, note: '[FLEX-ONLY DISCOUNT] Pass-catching tight end in Josh Allen spread offense.' },
  'Kenyon Sadiq': { val: 4, target: '$2-$5', max: 7, pts: 155.0, note: '[FLEX-ONLY DISCOUNT] Athletic prospect.' },
  'Eli Stowers': { val: 4, target: '$2-$5', max: 7, pts: 150.0, note: '[FLEX-ONLY DISCOUNT] Athletic move tight end.' }
};

// Update all player objects in raw
raw.players = raw.players.map((p, idx) => {
  const override = calibratedOverrides[p.name];
  if (override) {
    return {
      ...p,
      baselineVal: override.val,
      targetRange: override.target,
      hardMax: override.max,
      projPts: override.pts || p.projPts,
      notes: override.note || p.notes
    };
  }
  return p;
});

// Re-sort players by baselineVal descending, then projPts descending
raw.players.sort((a, b) => (b.baselineVal - a.baselineVal) || (b.projPts - a.projPts));

// Re-assign ranks 1..N
raw.players.forEach((p, idx) => {
  p.rank = idx + 1;
});

// Recompute positional ranks
const posCounts = {};
raw.players.forEach(p => {
  posCounts[p.pos] = (posCounts[p.pos] || 0) + 1;
  p.posRank = p.pos + posCounts[p.pos];
});

// Write to default_data.json
fs.writeFileSync(dataFilePath, JSON.stringify(raw, null, 2), 'utf8');

// Write to default_data.js
const jsContent = `/**
 * Default Seed Data for Fantasy Auction Draft App 2026
 * Calibrated for 12 Teams, $200 Cap, 0.5 PPR, 6pt PaTD, Distance Bonus Matrix, 2 FLEX (no mandatory TE)
 */

const defaultData = ${JSON.stringify(raw, null, 2)};

if (typeof window !== 'undefined') {
  window.INITIAL_DRAFT_DATA = defaultData;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { defaultData };
}

export { defaultData };
`;

fs.writeFileSync(path.join(__dirname, '..', 'data', 'default_data.js'), jsContent, 'utf8');

// Also mirror to public/data/
const publicDir = path.join(__dirname, '..', 'public', 'data');
if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });
fs.writeFileSync(path.join(publicDir, 'default_data.json'), JSON.stringify(raw, null, 2), 'utf8');
fs.writeFileSync(path.join(publicDir, 'default_data.js'), jsContent, 'utf8');

console.log('Successfully calibrated and wrote default_data files!');
console.log('Top 180 baseline sum:', raw.players.slice(0, 180).reduce((a,b)=>a+(b.baselineVal||1), 0));
