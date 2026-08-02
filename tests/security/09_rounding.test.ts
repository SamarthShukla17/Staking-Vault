import { expect } from "chai";
import { runScenario } from "../helpers/setup";

const SCALE = 1_000_000_000_000n;

/**
 * Simple, deterministic seedable PRNG (mulberry32) — NOT cryptographic, chosen purely so the
 * property test below is reproducible across runs given the same seed. `Math.random()` cannot
 * be seeded at all.
 */
function mulberry32(seed: number): () => number {
  let state = seed;
  return function next() {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Exact model of one accrue() + claim() cycle: points += amount * elapsed * rate (checked in the
 * real program's u128; plain BigInt here since the randomized ranges below stay far under
 * u128::MAX), reward = floor(points / SCALE), and the sub-SCALE remainder carries forward
 * unzeroed — mirrors state.rs's accrue() and claim.rs's handle_claim() exactly.
 */
function accrueAndClaim(carriedPoints: bigint, amount: bigint, elapsed: bigint, rate: bigint) {
  const points = carriedPoints + amount * elapsed * rate;
  const reward = points / SCALE;
  const remainder = points % SCALE;
  return { reward, remainder };
}

/** A single claim over the entire elapsed period, starting from zero carried points. */
function simulateSingleClaim(amount: bigint, rate: bigint, totalElapsed: bigint): bigint {
  return accrueAndClaim(0n, amount, totalElapsed, rate).reward;
}

/**
 * `splitCount` sequential claims covering the same total elapsed time, each one accruing since
 * the previous claim's checkpoint and carrying its remainder into the next — exactly what
 * `stake_account.points %= SCALE` (never reset to 0) preserves between real claim() calls.
 */
function simulateSplitClaims(amount: bigint, rate: bigint, totalElapsed: bigint, splitCount: number): bigint {
  const base = totalElapsed / BigInt(splitCount);
  let leftoverSeconds = totalElapsed % BigInt(splitCount);

  let carriedPoints = 0n;
  let totalReward = 0n;
  for (let i = 0; i < splitCount; i++) {
    let segmentElapsed = base;
    if (leftoverSeconds > 0n) {
      segmentElapsed += 1n;
      leftoverSeconds -= 1n;
    }
    const { reward, remainder } = accrueAndClaim(carriedPoints, amount, segmentElapsed, rate);
    totalReward += reward;
    carriedPoints = remainder;
  }
  return totalReward;
}

const PROPERTY_TEST_SEED = 0xc0ffee;
const PROPERTY_TEST_CASES = 200;

/**
 * Security suite: 09_rounding. claimable = floor(points / SCALE), and the sub-SCALE remainder is
 * carried forward (points %= SCALE), never zeroed and never rounded up. This is a deliberate
 * design choice: floor always favors the protocol, so a user gains nothing by splitting one
 * claim into many. The bulk of this suite is a fast, pure-arithmetic property test — no LiteSVM
 * involved — since suite 06's case (e) already proved empirically, via real on-chain claim()
 * calls, that this exact model matches the deployed program's behavior for a representative
 * case. The two on-chain cases below cover edges the pure model can't: a real dust-sized
 * position, and a real carried remainder that crosses the SCALE threshold. Those run in their
 * own subprocess (see runScenario / tests/helpers/runner.ts); this mocha process never touches
 * LiteSVM directly for them (see runner.ts's doc comment for why).
 */
describe("security: 09 rounding", () => {
  it(`splitting one claim into many never mints more than a single claim, across ${PROPERTY_TEST_CASES} randomized cases (seed=${PROPERTY_TEST_SEED})`, () => {
    const rng = mulberry32(PROPERTY_TEST_SEED);

    for (let i = 0; i < PROPERTY_TEST_CASES; i++) {
      // Kept well under u128::MAX (and even u64::MAX) so the real program's checked_mul chain
      // would never overflow for these inputs — this property is about rounding, not overflow
      // (suite 07 covers overflow separately).
      const amount = BigInt(1 + Math.floor(rng() * 1_000_000));
      const rate = BigInt(1 + Math.floor(rng() * 1_000_000));
      const totalElapsed = BigInt(1 + Math.floor(rng() * 100_000));
      const rawSplitCount = 2 + Math.floor(rng() * 8); // 2..9 splits
      const splitCount = Math.max(1, Math.min(rawSplitCount, Number(totalElapsed)));

      const single = simulateSingleClaim(amount, rate, totalElapsed);
      const split = simulateSplitClaims(amount, rate, totalElapsed, splitCount);

      const caseDescription =
        `seed=${PROPERTY_TEST_SEED} case=${i} amount=${amount} rate=${rate} ` +
        `totalElapsed=${totalElapsed} splitCount=${splitCount} single=${single} split=${split}`;

      expect(split <= single, `sum of split claims must never exceed a single claim (${caseDescription})`).to.equal(
        true,
      );
      // Stronger than the spec requires, but true by construction: the remainder carry is exact
      // (floor(a)+floor(b) telescopes to floor(a+b) regardless of where it's split), so splitting
      // never loses anything either.
      expect(split, `split claims should sum to exactly the single claim's reward (${caseDescription})`).to.equal(
        single,
      );
    }
  });

  it("dust: staking 1 base unit at rate 1 for a short period mints 0 and retains the exact sub-SCALE remainder", () => {
    const res = runScenario<{
      reward: string;
      points: string;
      vaultAmount: string;
      totalStaked: number;
      stakeAmount: number;
    }>("security-rounding-dust");

    expect(res.ok, `scenario failed: ${JSON.stringify(res.error)}`).to.equal(true);
    const r = res.result!;

    expect(r.reward).to.equal("0");
    // Not lost (still 100, not 0) and not rounded up (still 100, not 1 or more).
    expect(r.points).to.equal("100");

    expect(r.vaultAmount).to.equal(String(r.totalStaked));
    expect(r.totalStaked).to.equal(r.stakeAmount);
  });

  it("a remainder accumulated across many prior (seeded) tiny claims is paid exactly once after a long wait, no double-credit", () => {
    const res = runScenario<{
      rewardAfterFirst: string;
      pointsAfterFirst: string;
      rewardAfterSecond: string;
      pointsAfterSecond: string;
      vaultAmount: string;
      totalStaked: number;
      stakeAmount: number;
    }>("security-rounding-accumulate-then-pay");

    expect(res.ok, `scenario failed: ${JSON.stringify(res.error)}`).to.equal(true);
    const r = res.result!;

    // 999_999_999_999 carried + 1_000_000 newly accrued = 1_000_000_999_999 -> floor = 1, with a
    // 999_999 remainder.
    expect(r.rewardAfterFirst).to.equal("1");
    expect(r.pointsAfterFirst).to.equal("999999");

    // The immediate re-claim (zero further elapsed time) must not pay out again.
    expect(r.rewardAfterSecond).to.equal(r.rewardAfterFirst);
    expect(r.pointsAfterSecond).to.equal(r.pointsAfterFirst);

    expect(r.vaultAmount).to.equal(String(r.totalStaked));
    expect(r.totalStaked).to.equal(r.stakeAmount);
  });
});
