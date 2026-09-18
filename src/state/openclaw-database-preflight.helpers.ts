import type { DatabaseSync } from "node:sqlite";
import { executeSqliteQuerySync, getNodeSqliteKysely } from "../infra/kysely-sync.js";
import {
  collectSqliteSchemaIssues,
  type SqliteSchemaIssue,
} from "../infra/sqlite-schema-contract.js";
import type { DeferredStateSchemaPublication } from "./openclaw-database-preflight.types.js";
import { assertOpenClawStateDatabaseOwner } from "./openclaw-state-db-maintenance.js";
import type { DB as OpenClawStateKyselyDatabase } from "./openclaw-state-db.generated.js";
import { resolveOpenClawRegisteredAgentDatabasePath } from "./openclaw-state-db.paths.js";
import {
  getOpenClawStateRuntimeSchema,
  isOpenClawStateFirstUseSchemaIssue,
  isOpenClawStateStartupRepairableSchemaIssue,
  OPENCLAW_STATE_MAINTENANCE_SCHEMA_COMPATIBILITY,
  STATE_PERSISTENT_SCHEMA_COMPATIBILITY,
} from "./openclaw-state-schema-compatibility.js";
import { readStateSchemaPublicationBlocker } from "./openclaw-state-schema-publication.js";
import { OPENCLAW_STATE_SCHEMA_SQL } from "./openclaw-state-schema.js";

type AgentRegistryDatabase = Pick<OpenClawStateKyselyDatabase, "agent_databases">;

export function describeDeferredStateSchemaPublication(
  database: DatabaseSync,
  databasePath: string,
  foundVersion: number,
  contentVersion: number,
): DeferredStateSchemaPublication {
  const blocker = readStateSchemaPublicationBlocker(database);
  return {
    kind: "state",
    path: databasePath,
    foundVersion,
    contentVersion,
    ...(blocker ? { runId: blocker.runId, publishAfterMs: blocker.publishAfterMs } : {}),
    message: blocker
      ? `Schema content applied; version publication deferred until update run ${blocker.runId} finishes and its five-minute grace expires (or the running driver is abandoned for 30 minutes).`
      : "Schema content applied; version publication will complete on the next writable database open.",
  };
}

export function readWriterAppVersion(database: DatabaseSync): string | undefined {
  try {
    const row = database
      .prepare("SELECT app_version FROM schema_meta WHERE meta_key = 'primary' LIMIT 1")
      .get() as { app_version?: unknown } | undefined;
    return typeof row?.app_version === "string" && row.app_version.length > 0
      ? row.app_version
      : undefined;
  } catch {
    return undefined;
  }
}

export function readRegisteredAgentDatabases(
  database: DatabaseSync,
  registryPath: string,
): Array<{
  agentId: string;
  path: string;
}> {
  const table = database
    .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'agent_databases'")
    .get();
  if (!table) {
    return [];
  }
  const db = getNodeSqliteKysely<AgentRegistryDatabase>(database);
  return executeSqliteQuerySync(
    database,
    db.selectFrom("agent_databases").select(["agent_id", "path"]),
  ).rows.flatMap((row) =>
    typeof row.agent_id === "string" && typeof row.path === "string"
      ? [
          {
            agentId: row.agent_id,
            path: resolveOpenClawRegisteredAgentDatabasePath(registryPath, row.path),
          },
        ]
      : [],
  );
}

function deduplicateSchemaIssues(issues: readonly SqliteSchemaIssue[]): SqliteSchemaIssue[] {
  return [
    ...new Map(
      issues.map((issue) => [`${issue.code}\0${issue.objectName}`, issue] as const),
    ).values(),
  ];
}

export function inspectCurrentStateStartupSchema(
  database: DatabaseSync,
  databasePath: string,
  foundVersion: number,
) {
  assertOpenClawStateDatabaseOwner(database, { pathname: databasePath });
  const metadata = database
    .prepare("SELECT schema_version FROM schema_meta WHERE meta_key = 'primary' LIMIT 1")
    .get() as { schema_version?: unknown } | undefined;
  if (metadata?.schema_version !== foundVersion) {
    throw new Error(
      `OpenClaw state database ${databasePath} metadata schema version ${typeof metadata?.schema_version === "number" ? metadata.schema_version : "invalid"} does not match ${foundVersion}.`,
    );
  }
  const issues = deduplicateSchemaIssues([
    ...collectSqliteSchemaIssues(
      database,
      OPENCLAW_STATE_SCHEMA_SQL,
      OPENCLAW_STATE_MAINTENANCE_SCHEMA_COMPATIBILITY,
    ),
    ...collectSqliteSchemaIssues(
      database,
      getOpenClawStateRuntimeSchema({ includeVersionLazyAdditiveTables: false }),
      STATE_PERSISTENT_SCHEMA_COMPATIBILITY,
    ),
  ]);
  return {
    blockingIssues: issues.filter(
      (issue) =>
        !isOpenClawStateStartupRepairableSchemaIssue(issue) &&
        !isOpenClawStateFirstUseSchemaIssue(issue),
    ),
    startupRepairableIssues: issues.filter(isOpenClawStateStartupRepairableSchemaIssue),
  };
}
