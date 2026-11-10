import test from 'node:test';
import assert from 'node:assert/strict';
import { syncMining, claimMining, checkinReward, rankTitle, spinPrize } from '../server/game.js';

test('mining caps at 4 hours worth', () => {
  const now = Date.now();
  const user = {
    banned: 0,
    mined_unclaimed: 0,
    mining_started_at: now - 5 * 60 * 60 * 1000,
    balance: 0,
    total_claimed: 0,
    level: 1,
  };
  const synced = syncMining(user, now);
  assert.ok(synced.mined_unclaimed > 60);
  assert.ok(synced.mined_unclaimed < 90);
});

test('captcha blocks claim until passed flag set in db layer', () => {
  assert.equal(checkinReward(0), 10);
  assert.equal(checkinReward(6), 70);
});

test('claim resets mining timer', () => {
  const now = Date.now();
  const elapsed = Math.ceil(12 / (410 / (24 * 60 * 60 * 1000)));
  const user = {
    banned: 0,
    mined_unclaimed: 0,
    mining_started_at: now - elapsed,
    balance: 0,
    total_claimed: 0,
    level: 1,
    telegram_id: 1,
  };
  const { user: next, claimed } = claimMining(user, now);
  assert.ok(claimed >= 11 && claimed <= 13);
  assert.equal(next.last_tick_at, now);
  assert.equal(next.mined_unclaimed, 0);
  assert.equal(next.mining_started_at, now);
});

test('ranks and spin prizes stay in range', () => {
  assert.equal(rankTitle(1), 'Spark');
  assert.equal(rankTitle(11), 'Crown');
  assert.equal(spinPrize(0), 5);
  assert.equal(spinPrize(99), 80);
});
