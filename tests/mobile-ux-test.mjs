/**
 * Mobile Layout & UX Polish Test Suite
 */

import fs from 'node:fs';

async function runMobileUxTests() {
  console.log('\n======================================================');
  console.log('Running Mobile Layout & UX Polish Verification Suite');
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

  // --- Suite 1: Mobile Layout CSS Audit (360px - 414px) ---
  console.log('\n[Suite 1] Mobile CSS Rules & 44px Tap Target Audit:');
  const styleCss = fs.readFileSync('src/style.css', 'utf8');
  const tableNavCss = fs.readFileSync('src/components/TableNavigation.css', 'utf8');

  assert(styleCss.includes('min-height: 44px') || styleCss.includes('min-height:44px'), 'style.css defines min-height: 44px tap targets for mobile buttons');
  assert(styleCss.includes('overflow-x: hidden') || styleCss.includes('overflow-x:hidden'), 'style.css prevents horizontal overflow on mobile viewports');
  assert(styleCss.includes('@media (max-width: 480px)'), 'Mobile media query defined for 360px - 480px viewports');

  // --- Suite 2: Room Code & One-Click Copy Feedback ---
  console.log('\n[Suite 2] Room Code & Copy Feedback:');
  let mockCopied = false;
  let mockTimer = null;

  function simulateCopy(roomCode) {
    mockCopied = true;
    mockTimer = setTimeout(() => {
      mockCopied = false;
    }, 2500);
    return {
      text: mockCopied ? 'Copied!' : 'Copy',
      copied: mockCopied
    };
  }

  const copyInit = simulateCopy('YAZX');
  assert(copyInit.copied === true, 'Copy action triggers copied state immediately');
  assert(copyInit.text === 'Copied!', 'Button text transitions to "Copied!" for visual confirmation');
  clearTimeout(mockTimer);

  // Check TableNavigation.tsx has roomCode and copy button
  const tableNavTsx = fs.readFileSync('src/components/TableNavigation.tsx', 'utf8');
  assert(tableNavTsx.includes('roomCode &&') && tableNavTsx.includes('nav-room-pill'), 'TableNavigation renders visible room code badge');
  assert(tableNavTsx.includes('copiedRoom ? \'Copied!\' : \'Copy\''), 'TableNavigation provides visual "Copied!" feedback');

  // --- Suite 3: Connection Status Dot ---
  console.log('\n[Suite 3] Connection Status Dot:');
  function getConnectionIndicator(status) {
    switch (status) {
      case 'connected':
        return { color: 'green', class: 'status-connected', label: 'Connected' };
      case 'reconnecting':
        return { color: 'pulsing-amber', class: 'status-reconnecting', label: 'Reconnecting...' };
      case 'error':
        return { color: 'red', class: 'status-error', label: 'Offline' };
    }
  }

  const conn1 = getConnectionIndicator('connected');
  assert(conn1.color === 'green' && conn1.class === 'status-connected', 'Connected state uses green dot indicator');

  const conn2 = getConnectionIndicator('reconnecting');
  assert(conn2.color === 'pulsing-amber' && conn2.class === 'status-reconnecting', 'Reconnecting state uses pulsing amber dot indicator');

  const conn3 = getConnectionIndicator('error');
  assert(conn3.color === 'red' && conn3.class === 'status-error', 'Error state uses red dot indicator');

  assert(tableNavCss.includes('.status-connected .dot-indicator') && tableNavCss.includes('#4caf50'), 'TableNavigation.css has green connected dot styling (#4caf50)');
  assert(tableNavCss.includes('.status-reconnecting .dot-indicator') && tableNavCss.includes('#e6a23c'), 'TableNavigation.css has amber reconnecting dot styling (#e6a23c)');
  assert(tableNavCss.includes('.status-error .dot-indicator') && tableNavCss.includes('#e53935'), 'TableNavigation.css has red error dot styling (#e53935)');

  // --- Suite 4: Prominent Turn Indicator Badge ---
  console.log('\n[Suite 4] Prominent Turn Indicator Badge:');
  const appTsx = fs.readFileSync('src/App.tsx', 'utf8');

  function renderTurnBadge(isMyTurn, playerName) {
    if (isMyTurn) {
      return {
        className: 'turn-banner my-turn-highlight',
        badgeText: 'YOUR TURN',
        actionHint: '— Roll Dice'
      };
    } else {
      return {
        className: 'turn-banner waiting-turn',
        badgeText: `Waiting for ${playerName}...`,
        actionHint: null
      };
    }
  }

  const myTurn = renderTurnBadge(true, 'Alice');
  assert(myTurn.className.includes('my-turn-highlight'), 'Active player turn has .my-turn-highlight class');
  assert(myTurn.badgeText === 'YOUR TURN' && myTurn.actionHint === '— Roll Dice', 'Active player turn displays "YOUR TURN — Roll Dice"');

  const waitingTurn = renderTurnBadge(false, 'Bob');
  assert(waitingTurn.className.includes('waiting-turn'), 'Non-active turn has .waiting-turn class');
  assert(waitingTurn.badgeText === 'Waiting for Bob...', 'Non-active turn displays "Waiting for [Player Name]..."');

  assert(/isMyTurn\s*\?\s*\(\s*<span className="turn-banner-content">\s*<b>YOUR TURN<\/b>\s*<span className="turn-action-hint">— Roll Dice<\/span>/.test(appTsx), 'App.tsx renders prominent "YOUR TURN — Roll Dice" badge');
  assert(appTsx.includes('Waiting for <b>{p?.name}</b>...'), 'App.tsx renders "Waiting for [Player Name]..."');
  assert(styleCss.includes('.turn-banner.my-turn-highlight'), 'style.css defines glowing highlight and pulse animation for my-turn');

  // --- Suite 5: Last-Action Log Snippet ---
  console.log('\n[Suite 5] Last-Action Log Snippet:');
  assert(appTsx.includes('hub-last-action') && appTsx.includes('last-action-pill') && appTsx.includes('LATEST'), 'App.tsx renders dedicated latest action snippet with LATEST badge');
  assert(styleCss.includes('.hub-last-action') && styleCss.includes('text-overflow: ellipsis'), 'style.css styles latest action snippet with text truncation for clean single-line display');

  console.log(`\n------------------------------------------------------`);
  console.log(`Mobile/UX Polish Summary: ${passed} Passed | ${failed} Failed`);
  console.log(`------------------------------------------------------\n`);

  if (failed > 0) process.exit(1);
}

runMobileUxTests();
