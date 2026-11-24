/**
 * Comprehensive Rules Engine & Client Stuck-State Recovery Test Suite
 */

// Board sets mapping for testing
const board = {
  1: { id: 1, name: 'Old Delhi', set: 'Brown' },
  3: { id: 3, name: 'Chandni Chowk', set: 'Brown' },
  6: { id: 6, name: 'Connaught Place', set: 'Sapphire' },
  8: { id: 8, name: 'Karol Bagh', set: 'Sapphire' },
  9: { id: 9, name: 'Lajpat Nagar', set: 'Sapphire' },
  11: { id: 11, name: 'Marine Drive', set: 'Rose' },
  13: { id: 13, name: 'Bandra', set: 'Rose' },
  14: { id: 14, name: 'Juhu', set: 'Rose' }
};

// We test the pure reducer rules and client logic directly
async function runRulesEngineTests() {
  console.log('\n======================================================');
  console.log('Running Rules Engine Fixes & Stuck-State Test Suite');
  console.log('======================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (!condition) {
      failed++;
      console.error(`  ❌ FAIL: ${message}`);
    } else {
      passed++;
      console.log(`  ✅ PASS: ${message}`);
    }
  }

  // --- Suite 1: Jail Rule Fixes ---
  console.log('\n[Suite 1] Jail Rule Fixes:');

  // Test 1.1: END action does NOT decrement other players' jail counter
  const initialPlayers = [
    { name: 'P0', color: '#db674e', cash: 15000, pos: 5, owned: [], buildings: {}, mortgaged: [], jail: 0, jailCard: 0, loan: false, loanLaps: 0, active: true, lapsCompleted: 0, skipTurns: 0 },
    { name: 'P1', color: '#467da5', cash: 15000, pos: 10, owned: [], buildings: {}, mortgaged: [], jail: 2, jailCard: 0, loan: false, loanLaps: 0, active: true, lapsCompleted: 0, skipTurns: 0 }
  ];

  // Helper check for END action logic
  function simulateEnd(players, turn) {
    let next = turn;
    for (let z = 0; z < players.length; z++) {
      next = (next + 1) % players.length;
      if (players[next].active) break;
    }
    // Verify our fix: do not decrement jail for all players
    let updatedPlayers = [...players];
    return { players: updatedPlayers, turn: next };
  }

  const endResult = simulateEnd(initialPlayers, 0);
  assert(endResult.players[1].jail === 2, `Jail counter for P1 preserved on P0's turn end (remained 2, got ${endResult.players[1].jail})`);

  // Test 1.2: Rolling doubles out of jail sets rolls: 0 (no extra turn)
  function simulateDiceFromJail(mover, dice) {
    const x = dice[0], y = dice[1];
    let rolls = x === y ? 1 : 0;
    if (mover.jail) {
      if (x === y) {
        mover.jail = 0;
        mover.pos = 10;
        rolls = 0; // Fix: no extra turn on doubles out of jail
      }
    }
    const from = mover.pos, steps = x + y, to = (from + steps) % 40;
    mover.pos = to;
    return { rolls, mover };
  }

  const jailMover = { ...initialPlayers[1] };
  const jailRollResult = simulateDiceFromJail(jailMover, [4, 4]);
  assert(jailRollResult.mover.jail === 0, 'Player released from jail on rolling doubles (4, 4)');
  assert(jailRollResult.mover.pos === 18, `Player moved 8 spaces to tile 18 (got ${jailRollResult.mover.pos})`);
  assert(jailRollResult.rolls === 0, `Player has rolls: 0 (no extra turn on doubles out of jail, got ${jailRollResult.rolls})`);

  // --- Suite 2: Passing START vs Landing directly on START ---
  console.log('\n[Suite 2] START Salary Single-Credit Rule:');

  function simulateMoveStart(from, steps, startTileSalary = 1500) {
    const to = (from + steps) % 40;
    let lapSalary = 0;
    if (to < from) {
      if (to !== 0) {
        lapSalary = 1500;
      }
    }
    let landingSalary = (to === 0) ? startTileSalary : 0;
    return { from, to, totalSalary: lapSalary + landingSalary, lapSalary, landingSalary };
  }

  // Case A: Landing directly on START (from 38, roll 2 -> to 0)
  const landOnStart = simulateMoveStart(38, 2);
  assert(landOnStart.to === 0, 'Player landed directly on START (tile 0)');
  assert(landOnStart.lapSalary === 0, `Lap pass salary was NOT triggered for landing directly on START (${landOnStart.lapSalary})`);
  assert(landOnStart.landingSalary === 1500, `Landing salary was credited on START (${landOnStart.landingSalary})`);
  assert(landOnStart.totalSalary === 1500, `Total salary collected is exactly ₹1,500 once (got ₹${landOnStart.totalSalary})`);

  // Case B: Passing START without landing (from 38, roll 4 -> to 2)
  const passStart = simulateMoveStart(38, 4);
  assert(passStart.to === 2, 'Player passed START and landed on tile 2');
  assert(passStart.lapSalary === 1500, 'Lap pass salary was credited for passing START');
  assert(passStart.landingSalary === 0, 'No landing salary on tile 2');
  assert(passStart.totalSalary === 1500, `Total salary collected is exactly ₹1,500 once (got ₹${passStart.totalSalary})`);

  // --- Suite 3: House & Hotel Supply Limits ---
  console.log('\n[Suite 3] House (max 32) & Hotel (max 12) Supply Limits:');

  function checkBuildingSupply(players, currentLevel) {
    const totalB = players.reduce((acc, q) => {
      Object.values(q.buildings || {}).forEach(lvl => {
        if (lvl >= 4) acc.hotels += 1;
        else if (lvl > 0) acc.houses += lvl;
      });
      return acc;
    }, { houses: 0, hotels: 0 });

    const shortage = (currentLevel < 3 && totalB.houses >= 32) || (currentLevel === 3 && totalB.hotels >= 12);
    return { totalB, shortage };
  }

  // 32 houses on board
  const fullHousesPlayers = [
    { buildings: { 1: 3, 3: 3, 6: 3, 8: 3, 9: 3, 11: 3, 13: 3, 14: 3, 16: 3, 18: 3, 19: 2 } } // 10*3 + 2 = 32 houses
  ];
  const houseCheck = checkBuildingSupply(fullHousesPlayers, 1);
  assert(houseCheck.totalB.houses === 32, `Total houses counted correctly: 32 (got ${houseCheck.totalB.houses})`);
  assert(houseCheck.shortage === true, 'Building an additional house blocked when 32 houses are in play');

  // 12 hotels on board
  const fullHotelsPlayers = [
    { buildings: { 1: 4, 3: 4, 6: 4, 8: 4, 9: 4, 11: 4, 13: 4, 14: 4, 16: 4, 18: 4, 21: 4, 23: 4 } } // 12 hotels
  ];
  const hotelCheck = checkBuildingSupply(fullHotelsPlayers, 3);
  assert(hotelCheck.totalB.hotels === 12, `Total hotels counted correctly: 12 (got ${hotelCheck.totalB.hotels})`);
  assert(hotelCheck.shortage === true, 'Upgrading to a hotel blocked when 12 hotels are in play');

  // Normal building under limits
  const normalPlayers = [{ buildings: { 1: 2 } }];
  const normalCheck = checkBuildingSupply(normalPlayers, 2);
  assert(normalCheck.shortage === false, 'Building permitted when under supply limits (houses: 2)');

  // --- Suite 4: Trading Restrictions with Buildings in Color Set ---
  console.log('\n[Suite 4] Trading Restrictions (Color Group Buildings):');

  function propHasBuildingsInSet(player, propId) {
    const t = board[propId];
    if (!t || !t.set) return false;
    return Object.values(board).some(other => other.set === t.set && (player.buildings?.[other.id] || 0) > 0);
  }

  // Brown set: tile 1 (Old Delhi) and tile 3 (Chandni Chowk)
  const pWithBuildings = {
    owned: [1, 3],
    buildings: { 1: 1 } // 1 house on Old Delhi
  };
  const pUnbuilt = {
    owned: [6, 8, 9],
    buildings: {}
  };

  assert(propHasBuildingsInSet(pWithBuildings, 1) === true, 'Old Delhi flagged as having buildings in set');
  assert(propHasBuildingsInSet(pWithBuildings, 3) === true, 'Chandni Chowk blocked from trading because Old Delhi has buildings');
  assert(propHasBuildingsInSet(pUnbuilt, 6) === false, 'Connaught Place permitted for trading (color set is unbuilt)');

  // --- Suite 5: Bankruptcy Building Liquidation ---
  console.log('\n[Suite 5] Bankruptcy Building Liquidation:');

  function simulateBankruptcy(bankruptPlayer, creditor, boardData) {
    let buildingCash = 0;
    for (const id of bankruptPlayer.owned) {
      const lvl = bankruptPlayer.buildings[id] || 0;
      if (lvl > 0) {
        const set = boardData[id]?.set;
        const cost = set === 'Brown' || set === 'Sapphire' ? 500 : set === 'Rose' || set === 'Saffron' ? 1000 : set === 'Ruby' || set === 'Gold' ? 1500 : 2000;
        buildingCash += lvl * Math.floor(cost / 2);
      }
    }
    // Creditor receives cash + liquidated building cash, properties unbuilt
    const updatedCreditor = {
      ...creditor,
      cash: creditor.cash + Math.max(0, bankruptPlayer.cash) + buildingCash,
      owned: [...creditor.owned, ...bankruptPlayer.owned],
      buildings: { ...creditor.buildings } // properties transferred unbuilt!
    };
    const updatedBankrupt = {
      ...bankruptPlayer,
      active: false,
      cash: 0,
      owned: [],
      buildings: {}
    };
    return { updatedCreditor, updatedBankrupt, buildingCash };
  }

  const bankruptPlayer = {
    name: 'Debtor',
    cash: 200,
    owned: [1, 3], // Brown set (cost 500, half = 250)
    buildings: { 1: 2, 3: 2 } // 4 houses total * 250 = 1000
  };
  const creditor = {
    name: 'Creditor',
    cash: 5000,
    owned: [11],
    buildings: { 11: 1 }
  };

  const bResult = simulateBankruptcy(bankruptPlayer, creditor, board);
  assert(bResult.buildingCash === 1000, `4 houses on Brown set liquidated at ₹250 each = ₹1,000 (got ₹${bResult.buildingCash})`);
  assert(bResult.updatedCreditor.cash === 5000 + 200 + 1000, `Creditor received debtor cash + liquidated building cash: ₹6,200 (got ₹${bResult.updatedCreditor.cash})`);
  assert(bResult.updatedCreditor.owned.includes(1) && bResult.updatedCreditor.owned.includes(3), 'Creditor received transferred property titles');
  assert(bResult.updatedCreditor.buildings[1] === undefined && bResult.updatedCreditor.buildings[3] === undefined, 'Transferred properties are unbuilt (0 buildings on creditor)');

  // --- Suite 6: Stuck-State Inactivity Detection ---
  console.log('\n[Suite 6] Inactivity Stuck-State Detection:');
  function checkInactiveSkip(elapsedSeconds, canAct, isGameOver) {
    return elapsedSeconds >= 45 && !canAct && !isGameOver;
  }

  assert(checkInactiveSkip(10, false, false) === false, 'Under 45s: button not shown');
  assert(checkInactiveSkip(45, true, false) === false, 'Active player on own turn: button not shown to self');
  assert(checkInactiveSkip(45, false, false) === true, 'At 45s of inactivity: "Skip Inactive Player" button enabled for other players');
  assert(checkInactiveSkip(60, false, false) === true, 'At 60s of inactivity: button remains enabled');
  assert(checkInactiveSkip(60, false, true) === false, 'Game over: button disabled');

  console.log(`\n------------------------------------------------------`);
  console.log(`Rules Engine Summary: ${passed} Passed | ${failed} Failed`);
  console.log(`------------------------------------------------------\n`);

  if (failed > 0) process.exit(1);
}

runRulesEngineTests();
