import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import packageJson from "../../package.json" with { type: "json" };
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { requireNodeSqlite } from "../infra/node-sqlite.js";
import { collectSqliteSchemaIssues } from "../infra/sqlite-schema-contract.js";
import { runSqliteImmediateTransactionSync } from "../infra/sqlite-transaction.js";
import { OpenClawAgentDatabaseMediaMigrationRequiredError } from "./openclaw-agent-db-migration-required.js";
import {
  closeOpenClawAgentDatabasesForTest,
  OPENCLAW_AGENT_SCHEMA_VERSION,
  openOpenClawAgentDatabase,
} from "./openclaw-agent-db.js";
import {
  assertOpenClawDatabasesReady,
  preflightOpenClawStateDatabasePath,
} from "./openclaw-database-preflight.js";
import {
  snapshotPreflightSourceManifest,
  snapshotSourceFamily,
} from "./openclaw-database-preflight.test-support.js";
import { repairAuditEventsSchema } from "./openclaw-state-db-audit-migration.js";
import { OPENCLAW_STATE_SCHEMA_VERSION } from "./openclaw-state-db-contract.js";
import { OpenClawStateDatabaseSchemaMigrationRequiredError } from "./openclaw-state-db-schema-migration-required.js";
import {
  closeOpenClawStateDatabaseForTest,
  openOpenClawStateDatabase,
} from "./openclaw-state-db.js";
import { resolveOpenClawStateSqlitePath } from "./openclaw-state-db.paths.js";
import { OPENCLAW_STATE_SCHEMA_SQL } from "./openclaw-state-schema.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);

afterEach(() => {
  closeOpenClawAgentDatabasesForTest();
  closeOpenClawStateDatabaseForTest();
});

describe("OpenClaw database schema preflight", () => {
  function createExplicitStateDatabase(schemaSql = OPENCLAW_STATE_SCHEMA_SQL): string {
    const stateDir = tempDirs.make("openclaw-explicit-state-preflight-");
    const databasePath = path.join(stateDir, "candidate.sqlite");
    const { DatabaseSync } = requireNodeSqlite();
    const database = new DatabaseSync(databasePath);
    try {
      // Match production bootstrap: one durable commit, not one per schema object.
      runSqliteImmediateTransactionSync(database, () => {
        database.exec(`${schemaSql}; PRAGMA user_version = ${OPENCLAW_STATE_SCHEMA_VERSION};`);
        database
          .prepare(
            `INSERT INTO schema_meta (
               meta_key, role, schema_version, agent_id, app_version, created_at, updated_at
             ) VALUES ('primary', 'global', ?, NULL, NULL, 1, 1)`,
          )
          .run(OPENCLAW_STATE_SCHEMA_VERSION);
      });
    } finally {
      database.close();
    }
    return databasePath;
  }

  function createReleasedStateDatabase() {
    const stateDir = tempDirs.make("openclaw-startup-database-admission-");
    const env = { OPENCLAW_STATE_DIR: stateDir };
    const statePath = resolveOpenClawStateSqlitePath(env);
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(
      statePath,
      gunzipSync(
        fs.readFileSync(
          new URL(
            "../../test/fixtures/sqlite/openclaw-state-v2026.7.1-2.sqlite.gz",
            import.meta.url,
          ),
        ),
      ),
    );
    fs.writeFileSync(path.join(stateDir, "openclaw.json"), "{}\n");
    return { env, stateDir, statePath };
  }

  it("refuses released legacy audit state before changing any persistent artifact", async () => {
    const { env, stateDir, statePath } = createReleasedStateDatabase();
    const before = snapshotPreflightSourceManifest(stateDir);
    await expect(
      assertOpenClawDatabasesReady({ env, operation: "gateway-startup", config: {} }),
    ).rejects.toBeInstanceOf(OpenClawStateDatabaseSchemaMigrationRequiredError);
    expect(snapshotPreflightSourceManifest(stateDir)).toEqual(before);
    await expect(preflightOpenClawStateDatabasePath(statePath)).resolves.toMatchObject({
      foundVersion: 1,
    });
  });

  it("refuses a configured legacy agent database without mutating its WAL or creating stores", async () => {
    const stateDir = tempDirs.make("openclaw-agent-startup-admission-");
    const env = { OPENCLAW_STATE_DIR: stateDir };
    const agentPath = path.join(stateDir, "custom", "openclaw-agent.sqlite");
    openOpenClawAgentDatabase({ agentId: "main", path: agentPath, env });
    closeOpenClawAgentDatabasesForTest();
    closeOpenClawStateDatabaseForTest();
    const { DatabaseSync } = requireNodeSqlite();
    const writer = new DatabaseSync(agentPath);
    try {
      writer.exec(
        "PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0; PRAGMA user_version = 15; UPDATE schema_meta SET schema_version = 15;",
      );
      const config = { session: { store: path.join(stateDir, "custom", "sessions.json") } };
      const before = snapshotPreflightSourceManifest(stateDir, agentPath);
      await expect(
        assertOpenClawDatabasesReady({ env, operation: "gateway-startup", config }),
      ).rejects.toBeInstanceOf(OpenClawAgentDatabaseMediaMigrationRequiredError);
      expect(snapshotPreflightSourceManifest(stateDir, agentPath)).toEqual(before);
    } finally {
      writer.close();
    }
  });

  it("admits startup for a media-safe configured agent database that needs session identity migration", async () => {
    const stateDir = tempDirs.make("openclaw-agent-startup-session-identity-admission-");
    const env = { OPENCLAW_STATE_DIR: stateDir };
    const agentPath = path.join(stateDir, "agents", "main", "agent", "openclaw-agent.sqlite");
    openOpenClawAgentDatabase({ agentId: "main", path: agentPath, env });
    closeOpenClawAgentDatabasesForTest();
    closeOpenClawStateDatabaseForTest();
    const { DatabaseSync } = requireNodeSqlite();
    const writer = new DatabaseSync(agentPath);
    try {
      writer.exec(
        "PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0; PRAGMA user_version = 17; UPDATE schema_meta SET schema_version = 17;",
      );
      const before = snapshotPreflightSourceManifest(stateDir, agentPath);
      await expect(
        assertOpenClawDatabasesReady({ env, operation: "gateway-startup", config: {} }),
      ).resolves.toBeUndefined();
      expect(snapshotPreflightSourceManifest(stateDir, agentPath)).toEqual(before);
    } finally {
      writer.close();
    }
  });

  it("rejects a canonical configured agent path owned by another agent before writes", async () => {
    const root = tempDirs.make("openclaw-configured-agent-owner-");
    const env = { OPENCLAW_STATE_DIR: path.join(root, "active") };
    const agentDir = path.join(root, "external", "agents", "alpha");
    const agentPath = path.join(agentDir, "agent", "openclaw-agent.sqlite");
    const store = path.join(agentDir, "sessions", "sessions.json");
    openOpenClawAgentDatabase({
      agentId: "beta",
      path: agentPath,
      env: { OPENCLAW_STATE_DIR: path.join(root, "donor") },
    });
    closeOpenClawAgentDatabasesForTest();
    closeOpenClawStateDatabaseForTest();
    const before = snapshotPreflightSourceManifest(root);
    await expect(
      assertOpenClawDatabasesReady({
        env,
        operation: "gateway-startup",
        config: { session: { store } },
      }),
    ).rejects.toThrow("belongs to agent beta; requested agent alpha");
    expect(snapshotPreflightSourceManifest(root)).toEqual(before);
  });

  it("admits supported forward state migration after the Doctor-owned audit repair", async () => {
    const { env, stateDir, statePath } = createReleasedStateDatabase();
    const { DatabaseSync } = requireNodeSqlite();
    const database = new DatabaseSync(statePath);
    try {
      expect(repairAuditEventsSchema(database)).toBe(true);
    } finally {
      database.close();
    }
    const before = snapshotPreflightSourceManifest(stateDir);
    await expect(
      assertOpenClawDatabasesReady({ env, operation: "gateway-startup", config: {} }),
    ).resolves.toBeUndefined();
    expect(snapshotPreflightSourceManifest(stateDir)).toEqual(before);
    const migrated = openOpenClawStateDatabase({ env });
    expect(migrated.db.prepare("PRAGMA user_version").get()).toEqual({
      user_version: OPENCLAW_STATE_SCHEMA_VERSION,
    });
  });

  it("reports an exact current schema for one explicit copied database", async () => {
    const stateDir = tempDirs.make("openclaw-runtime-state-preflight-");
    const env = { OPENCLAW_STATE_DIR: stateDir };
    const opened = openOpenClawStateDatabase({ env });
    const databasePath = opened.path;
    expect(
      opened.db
        .prepare(
          "SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'execution_identity_contexts'",
        )
        .get(),
    ).toBeUndefined();
    closeOpenClawStateDatabaseForTest();

    await expect(preflightOpenClawStateDatabasePath(databasePath)).resolves.toEqual({
      schema: "openclaw.state-schema-preflight.v1",
      databasePath,
      targetVersion: OPENCLAW_STATE_SCHEMA_VERSION,
      foundVersion: OPENCLAW_STATE_SCHEMA_VERSION,
      ownership: null,
      issues: [],
      status: "exact",
      requiresWrite: false,
    });
  });

  it("treats a supported persistent column definition as exact", async () => {
    const databasePath = createExplicitStateDatabase(
      OPENCLAW_STATE_SCHEMA_SQL.replace(
        "  kind TEXT NOT NULL,\n  sensitivity TEXT NOT NULL,",
        "  kind TEXT NOT NULL DEFAULT 'followup',\n  sensitivity TEXT NOT NULL,",
      ),
    );

    await expect(preflightOpenClawStateDatabasePath(databasePath)).resolves.toEqual({
      schema: "openclaw.state-schema-preflight.v1",
      databasePath,
      targetVersion: OPENCLAW_STATE_SCHEMA_VERSION,
      foundVersion: OPENCLAW_STATE_SCHEMA_VERSION,
      ownership: null,
      status: "exact",
      requiresWrite: false,
      issues: [],
    });
  });

  it("accepts a copied current schema with a future bare nullable column without touching it", async () => {
    const sourcePath = createExplicitStateDatabase();
    const databasePath = path.join(
      tempDirs.make("openclaw-copied-state-preflight-"),
      "candidate.sqlite",
    );
    fs.copyFileSync(sourcePath, databasePath);
    const { DatabaseSync } = requireNodeSqlite();
    const database = new DatabaseSync(databasePath);
    try {
      database.exec("ALTER TABLE worktrees ADD COLUMN future_note TEXT;");
    } finally {
      database.close();
    }
    const before = snapshotSourceFamily(databasePath);

    await expect(preflightOpenClawStateDatabasePath(databasePath)).resolves.toEqual({
      schema: "openclaw.state-schema-preflight.v1",
      databasePath,
      targetVersion: OPENCLAW_STATE_SCHEMA_VERSION,
      foundVersion: OPENCLAW_STATE_SCHEMA_VERSION,
      ownership: null,
      status: "exact",
      requiresWrite: false,
      issues: [],
    });
    expect(snapshotSourceFamily(databasePath)).toEqual(before);
  });

  it("classifies a drifted canonical named index as startup-repairable", async () => {
    const databasePath = createExplicitStateDatabase();
    const { DatabaseSync } = requireNodeSqlite();
    const database = new DatabaseSync(databasePath);
    try {
      database.exec(`
        DROP INDEX idx_task_runs_status;
        CREATE INDEX idx_task_runs_status ON task_runs(task_id);
      `);
    } finally {
      database.close();
    }

    await expect(preflightOpenClawStateDatabasePath(databasePath)).resolves.toEqual({
      schema: "openclaw.state-schema-preflight.v1",
      databasePath,
      targetVersion: OPENCLAW_STATE_SCHEMA_VERSION,
      foundVersion: OPENCLAW_STATE_SCHEMA_VERSION,
      ownership: null,
      status: "startup-repairable",
      requiresWrite: true,
      issues: [
        {
          code: "missing-or-drifted-index",
          message: "missing or drifted index idx_task_runs_status",
          objectName: "idx_task_runs_status",
        },
      ],
    });
  });

  it.each([false, true])(
    "admits legacy additive columns without writes, rejecting genuine drift=%s",
    async (drift) => {
      const initialPath = createExplicitStateDatabase();
      const stateDir = path.dirname(initialPath);
      const databasePath = path.join(stateDir, "state", "openclaw.sqlite");
      fs.mkdirSync(path.dirname(databasePath));
      fs.renameSync(initialPath, databasePath);
      const database = new (requireNodeSqlite().DatabaseSync)(databasePath);
      database.exec(
        "ALTER TABLE task_runs DROP COLUMN tool_use_count; ALTER TABLE task_runs DROP COLUMN last_tool_name; ALTER TABLE apns_registrations DROP COLUMN relay_origin;",
      );
      if (drift) {
        database.exec("ALTER TABLE task_runs ADD COLUMN unrecognized INTEGER NOT NULL DEFAULT 0");
      }
      database.close();
      const before = snapshotSourceFamily(databasePath);
      expect(await preflightOpenClawStateDatabasePath(databasePath)).toMatchObject({
        foundVersion: OPENCLAW_STATE_SCHEMA_VERSION,
        status: drift ? "incompatible" : "startup-repairable",
      });
      const admission = assertOpenClawDatabasesReady({
        env: { OPENCLAW_STATE_DIR: stateDir },
        operation: "gateway-startup",
        config: {},
      });
      if (drift) {
        await expect(admission).rejects.toThrow("requires repair");
      } else {
        await expect(admission).resolves.toBeUndefined();
      }
      expect(snapshotSourceFamily(databasePath)).toEqual(before);
    },
  );

  it("classifies the same-version run-end cleanup column as startup-repairable without touching the source", async () => {
    const sourcePath = createExplicitStateDatabase(
      OPENCLAW_STATE_SCHEMA_SQL.replace(
        "  removed_at INTEGER,\n  run_end_cleanup_json TEXT\n",
        "  removed_at INTEGER\n",
      ),
    );
    const snapshotPath = path.join(
      tempDirs.make("openclaw-consolidated-state-preflight-"),
      "candidate.sqlite",
    );
    const sqlite = requireNodeSqlite();
    const writer = new sqlite.DatabaseSync(sourcePath);
    try {
      writer.exec("PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0;");
      writer
        .prepare(
          "INSERT INTO config_machine_state (state_key, value_json, updated_at_ms) VALUES ('preflight.probe', '{}', 1)",
        )
        .run();
      await sqlite.backup(writer, snapshotPath);
      writer
        .prepare(
          "INSERT INTO config_machine_state (state_key, value_json, updated_at_ms) VALUES ('preflight.after-backup', '{}', 2)",
        )
        .run();
      expect(fs.existsSync(`${sourcePath}-wal`)).toBe(true);
      expect(fs.existsSync(`${sourcePath}-shm`)).toBe(true);
      for (const suffix of ["-wal", "-shm", "-journal"]) {
        expect(fs.existsSync(`${snapshotPath}${suffix}`)).toBe(false);
      }
      const before = snapshotSourceFamily(sourcePath);

      const result = await preflightOpenClawStateDatabasePath(snapshotPath);

      expect(result).toMatchObject({
        foundVersion: OPENCLAW_STATE_SCHEMA_VERSION,
        status: "startup-repairable",
        requiresWrite: true,
        issues: [
          {
            code: "missing-column",
            objectName: "worktrees.run_end_cleanup_json",
          },
        ],
      });
      expect(snapshotSourceFamily(sourcePath)).toEqual(before);
    } finally {
      writer.close();
    }
  });

  it("accepts first-use session group columns without requiring a startup write", async () => {
    const databasePath = createExplicitStateDatabase(
      OPENCLAW_STATE_SCHEMA_SQL.replace(
        "  created_at INTEGER NOT NULL,\n  cwd TEXT,\n  worktree INTEGER\n",
        "  created_at INTEGER NOT NULL\n",
      ),
    );

    await expect(preflightOpenClawStateDatabasePath(databasePath)).resolves.toMatchObject({
      status: "exact",
      requiresWrite: false,
      issues: [],
    });
  });

  it("rejects an explicit preflight path with sidecars without touching it", async () => {
    const databasePath = createExplicitStateDatabase();
    const sqlite = requireNodeSqlite();
    const writer = new sqlite.DatabaseSync(databasePath);
    try {
      writer.exec("PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0;");
      writer
        .prepare(
          "INSERT INTO config_machine_state (state_key, value_json, updated_at_ms) VALUES ('preflight.live', '{}', 1)",
        )
        .run();
      const before = snapshotSourceFamily(databasePath);

      await expect(preflightOpenClawStateDatabasePath(databasePath)).resolves.toMatchObject({
        foundVersion: null,
        status: "indeterminate",
        requiresWrite: false,
        reason: expect.stringMatching(/consolidated snapshot.*sidecars.*online backup/iu),
      });
      expect(snapshotSourceFamily(databasePath)).toEqual(before);
    } finally {
      writer.close();
    }
  });

  it("reports an explicit unreadable path as indeterminate", async () => {
    const stateDir = tempDirs.make("openclaw-explicit-unreadable-preflight-");
    const databasePath = path.join(stateDir, "not-sqlite.db");
    fs.writeFileSync(databasePath, "not a sqlite database");

    await expect(preflightOpenClawStateDatabasePath(databasePath)).resolves.toMatchObject({
      databasePath,
      foundVersion: null,
      status: "indeterminate",
      requiresWrite: false,
      reason: expect.stringMatching(/database|file/iu),
    });
  });

  it("reports invalid negative schema metadata as indeterminate", async () => {
    const databasePath = createExplicitStateDatabase();
    const { DatabaseSync } = requireNodeSqlite();
    const database = new DatabaseSync(databasePath);
    try {
      database.exec("PRAGMA user_version = -1;");
    } finally {
      database.close();
    }

    await expect(preflightOpenClawStateDatabasePath(databasePath)).resolves.toMatchObject({
      foundVersion: -1,
      status: "indeterminate",
      reason: expect.stringContaining("invalid schema version metadata"),
    });
  });

  it("treats a current-v6 additive column as incompatible with the older v6 shape", () => {
    const { DatabaseSync } = requireNodeSqlite();
    const database = new DatabaseSync(":memory:");
    try {
      database.exec(OPENCLAW_STATE_SCHEMA_SQL);
      const olderV6Schema = OPENCLAW_STATE_SCHEMA_SQL.replace(
        "  removed_at INTEGER,\n  run_end_cleanup_json TEXT\n",
        "  removed_at INTEGER\n",
      );

      expect(collectSqliteSchemaIssues(database, olderV6Schema)).toContainEqual(
        expect.objectContaining({
          code: "unexpected-column",
          objectName: "worktrees.run_end_cleanup_json",
        }),
      );
    } finally {
      database.close();
    }
  });

  it("keeps package schema support metadata aligned", () => {
    expect(packageJson.openclaw.schemaVersions).toEqual({
      state: OPENCLAW_STATE_SCHEMA_VERSION,
      agent: OPENCLAW_AGENT_SCHEMA_VERSION,
    });
  });
});
