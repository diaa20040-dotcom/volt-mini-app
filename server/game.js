const DAILY_VOLT = 410;
const RATE_PER_MS = DAILY_VOLT / (24 * 60 * 60 * 1000);
const CAP_MS = 4 * 60 * 60 * 1000;
const STREAK_REWARDS = [10, 20, 30, 40, 50, 60, 70];

export function syncMining(user, now = Date.now()) {
  if (user.banned) return user;
  let { mined_unclaimed, mining_started_at } = user;
  if (!mining_started_at) {
    mining_started_at = now;
  }
  const elapsed = Math.min(now - mining_started_at, CAP_MS);
  mined_unclaimed = Math.min(DAILY_VOLT, elapsed * RATE_PER_MS);
  return { ...user, mined_unclaimed, mining_started_at };
}

export function claimMining(user, now = Date.now()) {
  const synced = syncMining(user, now);
  const amount = synced.mined_unclaimed;
  if (amount <= 0) return { user: synced, claimed: 0 };
  const newBalance = synced.balance + amount;
  const totalClaimed = synced.total_claimed + amount;
  const level = Math.max(1, Math.floor(totalClaimed / 200) + 1);
  return {
    user: {
      ...synced,
      balance: newBalance,
      total_claimed: totalClaimed,
      level,
      mined_unclaimed: 0,
      mining_started_at: now,
    },
    claimed: amount,
  };
}

export function checkinReward(streak) {
  if (streak >= STREAK_REWARDS.length) return STREAK_REWARDS[STREAK_REWARDS.length - 1];
  return STREAK_REWARDS[streak] ?? 10;
}

export function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}
