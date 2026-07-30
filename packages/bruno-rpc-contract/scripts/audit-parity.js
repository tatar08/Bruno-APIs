#!/usr/bin/env node

/**
 * Parity audit for the RPC contract (Improvement.md P0.5).
 *
 * Boots the real bruno-server process (the same one that actually serves
 * the Browser Bridge) with BRUNO_RPC_CONTRACT_DUMP=true, which registers
 * every bruno-electron IPC handler exactly as production does, dumps the
 * live channel -> source-file map as JSON, and exits without binding a
 * port. This script then diffs that live map against the committed
 * fixtures/real-channel-sources.json that channels.js and capabilities.js
 * are generated from.
 *
 * A clean diff means the typed CHANNELS constants and the capability
 * taxonomy are not stale. A dirty diff means bruno-electron registered,
 * removed, or moved a channel since the fixture was last captured, and
 * fixtures/real-channel-sources.json needs regenerating (re-run this
 * script with --write to do that).
 *
 * There is no CI pipeline in this repo yet (no .github/workflows or
 * equivalent), so this script is not currently wired into a merge gate —
 * it's the check a future CI job would run. Until then, run it by hand
 * (`npm run audit:parity` from this package) after touching any
 * bruno-electron ipc/*.js file.
 */

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const FIXTURE_PATH = path.join(__dirname, '..', 'fixtures', 'real-channel-sources.json');
const SERVER_ENTRY = path.join(__dirname, '..', '..', 'bruno-server', 'src', 'index.js');

function dumpLiveChannels() {
  const result = spawnSync(process.execPath, [SERVER_ENTRY], {
    env: { ...process.env, BRUNO_RPC_CONTRACT_DUMP: 'true' },
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024
  });

  if (result.status !== 0) {
    throw new Error(`Dumping live channels failed (exit ${result.status}):\n${result.stderr}`);
  }

  try {
    return JSON.parse(result.stdout);
  } catch (err) {
    throw new Error(`Live channel dump was not valid JSON: ${err.message}\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`);
  }
}

function toMap(entries) {
  const map = new Map();
  for (const { channel, sourceFile } of entries) map.set(channel, sourceFile);
  return map;
}

function diff(committed, live) {
  const committedMap = toMap(committed);
  const liveMap = toMap(live);

  const added = [];
  const removed = [];
  const moved = [];

  for (const [channel, sourceFile] of liveMap) {
    if (!committedMap.has(channel)) {
      added.push({ channel, sourceFile });
    } else if (committedMap.get(channel) !== sourceFile) {
      moved.push({ channel, from: committedMap.get(channel), to: sourceFile });
    }
  }

  for (const [channel, sourceFile] of committedMap) {
    if (!liveMap.has(channel)) removed.push({ channel, sourceFile });
  }

  return { added, removed, moved };
}

function main() {
  const shouldWrite = process.argv.includes('--write');

  const committed = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
  const live = dumpLiveChannels();
  const { added, removed, moved } = diff(committed, live);
  const isClean = added.length === 0 && removed.length === 0 && moved.length === 0;

  if (isClean) {
    console.log(`✅ RPC contract parity check passed — ${live.length} channels match fixtures/real-channel-sources.json.`);
    process.exit(0);
  }

  console.error(`❌ RPC contract drift detected between the live handler registry (${live.length} channels) and the committed fixture (${committed.length} channels):\n`);
  if (added.length) {
    console.error(`  Added (registered live, missing from fixture):`);
    added.forEach(({ channel, sourceFile }) => console.error(`    + ${channel}  (${sourceFile})`));
  }
  if (removed.length) {
    console.error(`  Removed (in fixture, no longer registered live):`);
    removed.forEach(({ channel, sourceFile }) => console.error(`    - ${channel}  (${sourceFile})`));
  }
  if (moved.length) {
    console.error(`  Moved (source file changed):`);
    moved.forEach(({ channel, from, to }) => console.error(`    ~ ${channel}  (${from} -> ${to})`));
  }

  if (shouldWrite) {
    fs.writeFileSync(FIXTURE_PATH, JSON.stringify(live, null, 2) + '\n');
    console.error(`\n📝 --write passed: fixtures/real-channel-sources.json regenerated. Re-run channels.js/capabilities.js consumers' tests and review the diff before committing.`);
    process.exit(0);
  }

  console.error(`\nRun with --write to regenerate fixtures/real-channel-sources.json, then review the diff (channels.js's CHANNELS constants and capabilities.js's SOURCE_TO_CAPABILITY may need updating too) before committing.`);
  process.exit(1);
}

main();
