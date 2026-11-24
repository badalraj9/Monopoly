/**
 * Deploy & Vercel Configuration Verification Test
 * 
 * Verifies:
 * 1. api/room.js detects Vercel environment (VERCEL === '1', VERCEL_ENV, NOW_REGION).
 * 2. When on Vercel without Upstash credentials, fails loudly with HTTP 500 (UPSTASH_CONFIG_MISSING).
 * 3. When on Vercel with credentials (or in-game headers), proceeds normally without 500.
 * 4. When not on Vercel, operates in local dev mode without error.
 * 5. .env.example contains UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.
 * 6. README.md contains Vercel + Upstash deployment steps.
 */

import { callApi } from './chaos-test.mjs';
import fs from 'node:fs';
import path from 'node:path';

export async function runDeployTests() {
  console.log('\n======================================================');
  console.log('Running Deploy Verifier Suite (Vercel + Upstash Readiness)');
  console.log('======================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (!condition) {
      failed++;
      console.error(`  ❌ FAIL: ${message}`);
      return false;
    } else {
      passed++;
      console.log(`  ✅ PASS: ${message}`);
      return true;
    }
  }

  // --- Test 1: Vercel Missing Credentials Check ---
  console.log('\n[Suite 1] Vercel Environment Guard:');
  const savedVercel = process.env.VERCEL;
  const savedUrl = process.env.UPSTASH_REDIS_REST_URL;
  const savedToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  try {
    // Simulate Vercel environment without Upstash credentials
    process.env.VERCEL = '1';
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    delete process.env.UPSTASH_REST_URL;
    delete process.env.UPSTASH_REST_TOKEN;
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;

    const resFail = await callApi('GET', '/api/room?code=ABCD');
    assert(resFail.status === 500, 'Vercel without Upstash credentials returns HTTP 500');
    assert(resFail.data?.code === 'UPSTASH_CONFIG_MISSING', 'Error code: UPSTASH_CONFIG_MISSING');
    assert(resFail.data?.error?.includes('Vercel Deployment Error'), 'Explains missing Upstash credentials');

    // Simulate Vercel environment WITH headers override
    const resWithHeaders = await callApi('GET', '/api/room?code=ABCD', null, {
      'x-upstash-url': 'https://mock-redis.upstash.io',
      'x-upstash-token': 'mock-token'
    });
    assert(resWithHeaders.status !== 500, 'Providing x-upstash headers bypasses missing env 500');

  } finally {
    // Restore environment
    if (savedVercel !== undefined) process.env.VERCEL = savedVercel;
    else delete process.env.VERCEL;
    if (savedUrl !== undefined) process.env.UPSTASH_REDIS_REST_URL = savedUrl;
    if (savedToken !== undefined) process.env.UPSTASH_REDIS_REST_TOKEN = savedToken;
  }

  // --- Test 2: Local Development Environment ---
  console.log('\n[Suite 2] Local Development Fallback:');
  const localRes = await callApi('GET', '/api/room?code=ABCD');
  assert(localRes.status === 404, 'Local development without VERCEL env proceeds normally (returns 404 Room not found)');

  // --- Test 3: .env.example Verification ---
  console.log('\n[Suite 3] .env.example Entries:');
  const envExamplePath = path.resolve('.env.example');
  assert(fs.existsSync(envExamplePath), '.env.example file exists');
  const envContent = fs.readFileSync(envExamplePath, 'utf8');
  assert(envContent.includes('UPSTASH_REDIS_REST_URL='), '.env.example contains UPSTASH_REDIS_REST_URL');
  assert(envContent.includes('UPSTASH_REDIS_REST_TOKEN='), '.env.example contains UPSTASH_REDIS_REST_TOKEN');

  // --- Test 4: README.md Deployment Guide ---
  console.log('\n[Suite 4] README.md Deployment Documentation:');
  const readmePath = path.resolve('README.md');
  assert(fs.existsSync(readmePath), 'README.md exists');
  const readmeContent = fs.readFileSync(readmePath, 'utf8');
  assert(readmeContent.includes('Upstash Redis'), 'README.md documents Upstash Redis setup');
  assert(readmeContent.includes('UPSTASH_REDIS_REST_URL'), 'README.md specifies UPSTASH_REDIS_REST_URL');
  assert(readmeContent.includes('UPSTASH_REDIS_REST_TOKEN'), 'README.md specifies UPSTASH_REDIS_REST_TOKEN');
  assert(readmeContent.includes('Vercel'), 'README.md documents Vercel deployment');

  console.log('\n------------------------------------------------------');
  console.log(`Deploy Test Summary: ${passed} Passed | ${failed} Failed`);
  console.log('------------------------------------------------------\n');

  return { passed, failed };
}

if (process.argv[1]?.endsWith('deploy-test.mjs')) {
  runDeployTests().then(({ failed }) => {
    process.exit(failed > 0 ? 1 : 0);
  }).catch((err) => {
    console.error('Fatal deploy test failure:', err);
    process.exit(1);
  });
}
