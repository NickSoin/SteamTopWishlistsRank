const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const shared = require("../src/shared.js");
const {
  isConfirmedRelease,
  updateLedger,
  writeV2Artifacts
} = require("../scripts/update-feed.js");

async function runNewUpcomingTest() {
  const ledger = await updateLedger({
    ledger: {},
    currentEntries: {
      "111": createCurrentEntry(10, "Game One")
    },
    now: new Date("2026-05-15T00:00:00.000Z"),
    fetchReleaseInfo: failIfCalled
  });

  assert.deepEqual(ledger, {
    "111": {
      name: "Game One",
      state: "upcoming",
      preRelease: { rank: 10, estimate: "1.5m+" }
    }
  });
}

async function runUpcomingRankUpdateTest() {
  const ledger = await updateLedger({
    ledger: {
      "111": {
        name: "Game One",
        state: "upcoming",
        preRelease: { rank: 120, estimate: "200k+" }
      }
    },
    currentEntries: {
      "111": createCurrentEntry(80, "Game One")
    },
    now: new Date("2026-05-15T00:00:00.000Z"),
    fetchReleaseInfo: failIfCalled
  });

  assert.deepEqual(ledger["111"].preRelease, { rank: 80, estimate: "300k+" });
}

async function runMissingStillUpcomingTest() {
  const ledger = await updateLedger({
    ledger: {
      "111": {
        name: "Game One",
        state: "upcoming",
        preRelease: { rank: 80, estimate: "300k+" }
      }
    },
    currentEntries: {},
    now: new Date("2026-05-15T00:00:00.000Z"),
    fetchReleaseInfo: async () => ({ released: false, releaseDate: null, name: "Game One" })
  });

  assert.equal(ledger["111"].state, "upcoming");
  assert.deepEqual(ledger["111"].preRelease, { rank: 80, estimate: "300k+" });
}

async function runReleaseFreezeTest() {
  const ledger = await updateLedger({
    ledger: {
      "111": {
        name: "Game One",
        state: "upcoming",
        preRelease: { rank: 80, estimate: "300k+" }
      }
    },
    currentEntries: {},
    now: new Date("2026-05-15T00:00:00.000Z"),
    fetchReleaseInfo: async () => ({
      released: true,
      releaseDate: "2026-05-14",
      name: "Game One"
    })
  });

  assert.deepEqual(ledger["111"], {
    name: "Game One",
    state: "released",
    preRelease: { rank: 80, estimate: "300k+" },
    releaseDate: "2026-05-14"
  });
}

async function runCurrentReleaseCandidateFreezeTest() {
  const ledger = await updateLedger({
    ledger: {
      "111": {
        name: "Game One",
        state: "upcoming",
        preRelease: { rank: 80, estimate: "300k+" }
      }
    },
    currentEntries: {
      "111": createCurrentEntry(5, "Game One", "14 May, 2026")
    },
    now: new Date("2026-05-15T00:00:00.000Z"),
    fetchReleaseInfo: async () => ({
      released: true,
      releaseDate: "2026-05-14",
      name: "Game One"
    })
  });

  assert.deepEqual(ledger["111"], {
    name: "Game One",
    state: "released",
    preRelease: { rank: 80, estimate: "300k+" },
    releaseDate: "2026-05-14"
  });
}

async function runCurrentCandidateUnknownStatusTest() {
  const ledger = await updateLedger({
    ledger: {
      "111": {
        name: "Game One",
        state: "upcoming",
        preRelease: { rank: 80, estimate: "300k+" }
      }
    },
    currentEntries: {
      "111": createCurrentEntry(5, "Game One", "14 May, 2026")
    },
    now: new Date("2026-05-15T00:00:00.000Z"),
    fetchReleaseInfo: async () => null
  });

  assert.deepEqual(ledger["111"], {
    name: "Game One",
    state: "upcoming",
    preRelease: { rank: 80, estimate: "300k+" }
  });
}

async function runReleasedEntryIsFrozenTest() {
  const ledger = await updateLedger({
    ledger: {
      "111": {
        name: "Game One",
        state: "released",
        preRelease: { rank: 80, estimate: "300k+" },
        releaseDate: "2026-05-14"
      }
    },
    currentEntries: {
      "111": createCurrentEntry(5, "Game One")
    },
    now: new Date("2026-05-15T00:00:00.000Z"),
    fetchReleaseInfo: failIfCalled
  });

  assert.deepEqual(ledger["111"], {
    name: "Game One",
    state: "released",
    preRelease: { rank: 80, estimate: "300k+" },
    releaseDate: "2026-05-14"
  });
}

async function runFutureReleaseSignalIsRejectedTest() {
  assert.equal(
    isConfirmedRelease(
      { released: true, releaseDate: "2027-06-08" },
      "2026-08-01"
    ),
    false
  );

  const ledger = await updateLedger({
    ledger: {
      "111": {
        name: "Future Game",
        state: "upcoming",
        preRelease: { rank: 80, estimate: "300k+" }
      }
    },
    currentEntries: {},
    now: new Date("2026-08-01T00:00:00.000Z"),
    fetchReleaseInfo: async () => ({
      released: true,
      releaseDate: "2027-06-08",
      name: "Future Game"
    })
  });

  assert.equal(ledger["111"].state, "upcoming");
}

async function runFutureReleasedEntryIsRestoredTest() {
  const ledger = await updateLedger({
    ledger: {
      "111": {
        name: "Future Game",
        state: "released",
        preRelease: { rank: 80, estimate: "300k+" },
        releaseDate: "2027-06-08"
      }
    },
    currentEntries: {
      "111": createCurrentEntry(5, "Future Game")
    },
    now: new Date("2026-08-01T00:00:00.000Z"),
    fetchReleaseInfo: failIfCalled
  });

  assert.deepEqual(ledger["111"], {
    name: "Future Game",
    state: "upcoming",
    preRelease: { rank: 5, estimate: "1.5m+" }
  });
}

async function runShardWriterTest() {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "wishlist-v2-"));
  const updatedAt = "2026-05-15T00:00:00.000Z";

  const releasedShardId = shared.getShardId("222");
  await fs.mkdir(path.join(outputDir, "pre-release"), { recursive: true });
  await fs.writeFile(
    path.join(outputDir, "pre-release", `${releasedShardId}.json`),
    JSON.stringify({
      schemaVersion: 2,
      kind: "pre_release",
      updatedAt: "2026-05-14T00:00:00.000Z",
      entryCount: 2,
      entries: {
        "444": {
          rank: 90,
          estimate: "250k+",
          name: "Stale Tracked Game",
          releaseDate: "2027-06-08",
          source: "tracked"
        },
        "555": {
          rank: 100,
          estimate: "200k+",
          name: "Historical Game",
          releaseDate: "2020-01-01",
          source: "historical"
        }
      }
    }),
    "utf8"
  );

  await writeV2Artifacts({
    ledger: {
      "111": {
        name: "Upcoming Game",
        state: "upcoming",
        preRelease: { rank: 10, estimate: "1.5m+" }
      },
      "222": {
        name: "Released Game",
        state: "released",
        preRelease: { rank: 80, estimate: "300k+" },
        releaseDate: "2026-05-14"
      },
      "333": {
        name: "Released Without Snapshot",
        state: "released",
        releaseDate: "2026-05-13"
      }
    },
    currentEntries: {
      "111": createCurrentEntry(10, "Upcoming Game"),
      "222": createCurrentEntry(5, "Released Game")
    },
    outputDir,
    updatedAt,
    trackingSince: "2026-05-15"
  });

  const currentShard = JSON.parse(
    await fs.readFile(
      path.join(outputDir, "current", `${shared.getShardId("111")}.json`),
      "utf8"
    )
  );
  const preReleaseShard = JSON.parse(
    await fs.readFile(
      path.join(outputDir, "pre-release", `${shared.getShardId("222")}.json`),
      "utf8"
    )
  );
  const meta = JSON.parse(await fs.readFile(path.join(outputDir, "meta.json"), "utf8"));

  assert.deepEqual(currentShard.entries["111"], {
    rank: 10,
    estimate: "1.5m+",
    name: "Upcoming Game"
  });
  assert.equal(currentShard.entries["222"], undefined);
  assert.deepEqual(preReleaseShard.entries["222"], {
    rank: 80,
    estimate: "300k+",
    name: "Released Game",
    releaseDate: "2026-05-14",
    source: "tracked"
  });
  assert.equal(preReleaseShard.entries["444"], undefined);
  assert.deepEqual(preReleaseShard.entries["555"], {
    rank: 100,
    estimate: "200k+",
    name: "Historical Game",
    releaseDate: "2020-01-01",
    source: "historical"
  });
  assert.equal(preReleaseShard.entries["333"], undefined);
  assert.deepEqual(meta.current, { updatedAt, entryCount: 1 });
  assert.deepEqual(meta.released, { updatedAt, entryCount: 2 });
  assert.deepEqual(meta.preRelease, { updatedAt, entryCount: 2 });
  assert.equal(meta.trackingSince, "2026-05-15");
}

function createCurrentEntry(rank, name, releaseText = "Coming soon") {
  const estimates = {
    5: "1.5m+",
    10: "1.5m+",
    80: "300k+",
    120: "200k+"
  };

  return {
    appId: "111",
    rank,
    estimate: estimates[rank],
    name,
    releaseText
  };
}

async function failIfCalled() {
  throw new Error("release check should not be called");
}

async function main() {
  await runNewUpcomingTest();
  await runUpcomingRankUpdateTest();
  await runMissingStillUpcomingTest();
  await runReleaseFreezeTest();
  await runCurrentReleaseCandidateFreezeTest();
  await runCurrentCandidateUnknownStatusTest();
  await runReleasedEntryIsFrozenTest();
  await runFutureReleaseSignalIsRejectedTest();
  await runFutureReleasedEntryIsRestoredTest();
  await runShardWriterTest();
  console.log("All ledger tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
