import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { normalizeAgentId } from "../../routing/session-key.js";

export type AgentControlAction =
  | "list"
  | "readStatus"
  | "sendMessage"
  | "readManagedFile"
  | "requestManagedFileUpdate";

export type AgentControlStatus =
  | "unknown"
  | "provisioning"
  | "ready"
  | "degraded"
  | "blocked"
  | "retired";

export type AgentControlEndpoint = {
  /** Logical in-swarm service identity, never a container id or transient task IP. */
  serviceName: string;
  /** Optional API base path relative to the service, e.g. `/agent-control`. */
  basePath?: string;
  /** Overlay networks where the service identity is expected to resolve. */
  networks?: string[];
};

export type AgentControlWorkspace = {
  /** Host or mounted workspace root. Used for policy/audit only; access is mediated elsewhere. */
  root: string;
  /** Explicit list of manager-controlled relative Markdown files or folders. */
  managedFiles: string[];
};

export type AgentControlScope = {
  /** Manager agent ids that may operate this agent. Empty means no direct agent grant. */
  managers?: string[];
  /** Manager team ids that may operate this agent. Empty means no team grant. */
  managerTeams?: string[];
  /** Allowed safe operations for granted managers. */
  actions: AgentControlAction[];
};

export type AgentControlRecord = {
  id: string;
  displayName?: string;
  ownerTeam: string;
  role: string;
  status: AgentControlStatus;
  endpoint: AgentControlEndpoint;
  workspace: AgentControlWorkspace;
  capabilities: string[];
  management: AgentControlScope;
};

export type AgentControlRegistry = {
  version: 1;
  agents: AgentControlRecord[];
};

export type AgentControlPrincipal = {
  agentId: string;
  teams: string[];
  roles: string[];
};

export type AgentControlResolution = {
  agent: AgentControlRecord;
  endpoint: AgentControlEndpoint;
  workspace: AgentControlWorkspace;
  capabilities: string[];
  authorizedAction: AgentControlAction;
};

export type AgentControlAuditEvent = {
  type: "agent-control.authorization";
  at: string;
  principalAgentId: string;
  targetAgentId: string;
  action: AgentControlAction;
  decision: "allow" | "deny";
  reason: string;
};

export type ManagedFileUpdateRequest = {
  targetAgentId: string;
  relativePath: string;
  proposedContent: string;
  reason: string;
};

export type AgentControlRegistryParseResult =
  | { ok: true; registry: AgentControlRegistry }
  | { ok: false; errors: string[] };

export type AgentControlRegistryFileReader = (
  filePath: string,
  encoding: BufferEncoding,
) => Promise<string>;

const AGENT_CONTROL_ACTIONS = [
  "list",
  "readStatus",
  "sendMessage",
  "readManagedFile",
  "requestManagedFileUpdate",
] as const satisfies readonly AgentControlAction[];

const AGENT_CONTROL_STATUSES = [
  "unknown",
  "provisioning",
  "ready",
  "degraded",
  "blocked",
  "retired",
] as const satisfies readonly AgentControlStatus[];

const ALL_ACTIONS: ReadonlySet<AgentControlAction> = new Set(AGENT_CONTROL_ACTIONS);

const MARKDOWN_FILE_PATTERN = /(^|\/)[^/]+\.md$/i;

const AgentControlEndpointSchema = z
  .object({
    serviceName: z.string().trim().min(1),
    basePath: z.string().trim().min(1).optional(),
    networks: z.array(z.string().trim().min(1)).optional(),
  })
  .strict();

const AgentControlWorkspaceSchema = z
  .object({
    root: z.string().trim().min(1),
    managedFiles: z.array(z.string().trim().min(1)),
  })
  .strict()
  .superRefine((workspace, ctx) => {
    for (const [index, managedFile] of workspace.managedFiles.entries()) {
      if (!normalizeRelativePath(managedFile)) {
        ctx.addIssue({
          code: "custom",
          path: ["managedFiles", index],
          message: "managed file path must be relative and stay within the workspace",
        });
      }
    }
  });

const AgentControlScopeSchema = z
  .object({
    managers: z.array(z.string().trim().min(1)).optional(),
    managerTeams: z.array(z.string().trim().min(1)).optional(),
    actions: z.array(z.enum(AGENT_CONTROL_ACTIONS)),
  })
  .strict();

const AgentControlRecordSchema = z
  .object({
    id: z.string().trim().min(1),
    displayName: z.string().trim().min(1).optional(),
    ownerTeam: z.string().trim().min(1),
    role: z.string().trim().min(1),
    status: z.enum(AGENT_CONTROL_STATUSES),
    endpoint: AgentControlEndpointSchema,
    workspace: AgentControlWorkspaceSchema,
    capabilities: z.array(z.string().trim().min(1)),
    management: AgentControlScopeSchema,
  })
  .strict();

const AgentControlRegistrySchema = z
  .object({
    version: z.literal(1),
    agents: z.array(AgentControlRecordSchema),
  })
  .strict();

function formatRegistryParseIssues(issues: readonly z.core.$ZodIssue[]): string[] {
  return issues.map((issue) => {
    const location = issue.path.length > 0 ? issue.path.join(".") : "registry";
    return `${location}: ${issue.message}`;
  });
}

function normalizeRelativePath(input: string): string | undefined {
  if (typeof input !== "string" || input.length === 0 || input.includes("\0")) {
    return undefined;
  }
  if (path.isAbsolute(input)) {
    return undefined;
  }
  const normalized = path.posix.normalize(input.replaceAll("\\", "/"));
  if (normalized === "." || normalized.startsWith("../") || normalized === "..") {
    return undefined;
  }
  return normalized;
}

function normalizeRelativePathPrefix(input: string): string | undefined {
  const normalized = normalizeRelativePath(input.replace(/\/+$/, ""));
  return normalized === undefined ? undefined : `${normalized}/`;
}

function normalizePrincipal(principal: AgentControlPrincipal): AgentControlPrincipal {
  return {
    agentId: normalizeAgentId(principal.agentId),
    teams: [...new Set(principal.teams.map((team) => team.trim()).filter(Boolean))],
    roles: [...new Set(principal.roles.map((role) => role.trim()).filter(Boolean))],
  };
}

function normalizeActionSet(actions: readonly AgentControlAction[]): Set<AgentControlAction> {
  const normalized = new Set<AgentControlAction>();
  for (const action of actions) {
    if (ALL_ACTIONS.has(action)) {
      normalized.add(action);
    }
  }
  return normalized;
}

export function normalizeAgentControlRecord(record: AgentControlRecord): AgentControlRecord {
  return {
    ...record,
    id: normalizeAgentId(record.id),
    capabilities: [
      ...new Set(record.capabilities.map((capability) => capability.trim()).filter(Boolean)),
    ],
    management: {
      managers: [...new Set((record.management.managers ?? []).map(normalizeAgentId))],
      managerTeams: [
        ...new Set(
          (record.management.managerTeams ?? []).map((team) => team.trim()).filter(Boolean),
        ),
      ],
      actions: [...normalizeActionSet(record.management.actions)],
    },
    workspace: {
      ...record.workspace,
      managedFiles: [
        ...new Set(
          record.workspace.managedFiles
            .map((managedFile) => normalizeRelativePath(managedFile))
            .filter((managedFile): managedFile is string => managedFile !== undefined),
        ),
      ],
    },
  };
}

export function normalizeAgentControlRegistry(
  registry: AgentControlRegistry,
): AgentControlRegistry {
  const byId = new Map<string, AgentControlRecord>();
  for (const record of registry.agents) {
    const normalized = normalizeAgentControlRecord(record);
    if (!byId.has(normalized.id)) {
      byId.set(normalized.id, normalized);
    }
  }
  return { version: 1, agents: [...byId.values()] };
}

export function parseAgentControlRegistryJson(params: {
  raw: string;
  source?: string;
}): AgentControlRegistryParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(params.raw);
  } catch (error) {
    return {
      ok: false,
      errors: [
        `${params.source ?? "agent-control registry"}: invalid JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ],
    };
  }

  const result = AgentControlRegistrySchema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, errors: formatRegistryParseIssues(result.error.issues) };
  }

  return { ok: true, registry: normalizeAgentControlRegistry(result.data) };
}

export async function loadAgentControlRegistryFile(params: {
  filePath: string;
  readFile?: AgentControlRegistryFileReader;
}): Promise<AgentControlRegistry> {
  const readFile = params.readFile ?? fs.readFile;
  const raw = await readFile(params.filePath, "utf8");
  const result = parseAgentControlRegistryJson({ raw, source: params.filePath });
  if (!result.ok) {
    throw new Error(
      `Invalid agent control registry ${params.filePath}: ${result.errors.join("; ")}`,
    );
  }
  return result.registry;
}

export function resolveAgentControlRecord(
  registry: AgentControlRegistry,
  targetAgentId: string,
): AgentControlRecord | undefined {
  const normalizedId = normalizeAgentId(targetAgentId);
  return normalizeAgentControlRegistry(registry).agents.find((agent) => agent.id === normalizedId);
}

export function authorizeAgentControlAction(params: {
  registry: AgentControlRegistry;
  principal: AgentControlPrincipal;
  targetAgentId: string;
  action: AgentControlAction;
  now?: Date;
}): { allowed: boolean; reason: string; audit: AgentControlAuditEvent } {
  const principal = normalizePrincipal(params.principal);
  const target = resolveAgentControlRecord(params.registry, params.targetAgentId);
  let allowed = false;
  let reason = "target_not_found";

  if (target) {
    const actions = normalizeActionSet(target.management.actions);
    const directGrant = (target.management.managers ?? [])
      .map(normalizeAgentId)
      .includes(principal.agentId);
    const teamGrant = (target.management.managerTeams ?? []).some((team) =>
      principal.teams.includes(team),
    );
    const actionGrant = actions.has(params.action);
    allowed = (directGrant || teamGrant) && actionGrant;
    if (!directGrant && !teamGrant) {
      reason = "principal_not_in_management_scope";
    } else if (!actionGrant) {
      reason = "action_not_allowed";
    } else {
      reason = "allowed_by_management_scope";
    }
  }

  return {
    allowed,
    reason,
    audit: {
      type: "agent-control.authorization",
      at: (params.now ?? new Date()).toISOString(),
      principalAgentId: principal.agentId,
      targetAgentId: normalizeAgentId(params.targetAgentId),
      action: params.action,
      decision: allowed ? "allow" : "deny",
      reason,
    },
  };
}

export function listManageableAgents(params: {
  registry: AgentControlRegistry;
  principal: AgentControlPrincipal;
  action?: AgentControlAction;
}): AgentControlRecord[] {
  const action = params.action ?? "readStatus";
  return normalizeAgentControlRegistry(params.registry).agents.filter(
    (agent) =>
      authorizeAgentControlAction({
        registry: params.registry,
        principal: params.principal,
        targetAgentId: agent.id,
        action,
      }).allowed,
  );
}

export function resolveAgentControlTarget(params: {
  registry: AgentControlRegistry;
  principal: AgentControlPrincipal;
  targetAgentId: string;
  action: AgentControlAction;
}): AgentControlResolution {
  const target = resolveAgentControlRecord(params.registry, params.targetAgentId);
  if (!target) {
    throw new Error(`Unknown agent control target: ${params.targetAgentId}`);
  }
  const authorization = authorizeAgentControlAction(params);
  if (!authorization.allowed) {
    throw new Error(
      `Agent ${params.principal.agentId} may not ${params.action} ${params.targetAgentId}: ${authorization.reason}`,
    );
  }
  return {
    agent: target,
    endpoint: target.endpoint,
    workspace: target.workspace,
    capabilities: target.capabilities,
    authorizedAction: params.action,
  };
}

export function isManagedAgentMarkdownFile(params: {
  agent: AgentControlRecord;
  relativePath: string;
}): boolean {
  const relativePath = normalizeRelativePath(params.relativePath);
  if (!relativePath || !MARKDOWN_FILE_PATTERN.test(relativePath)) {
    return false;
  }
  const managedFiles = normalizeAgentControlRecord(params.agent).workspace.managedFiles;
  return managedFiles.some((managedFile) => {
    if (managedFile.endsWith("/")) {
      return relativePath.startsWith(managedFile);
    }
    const prefix = normalizeRelativePathPrefix(managedFile);
    return (
      relativePath === managedFile || (prefix !== undefined && relativePath.startsWith(prefix))
    );
  });
}

export function buildManagedFileUpdatePlan(params: {
  registry: AgentControlRegistry;
  principal: AgentControlPrincipal;
  request: ManagedFileUpdateRequest;
  now?: Date;
}): {
  status: "pending_review";
  request: ManagedFileUpdateRequest;
  target: AgentControlRecord;
  audit: AgentControlAuditEvent;
} {
  const target = resolveAgentControlRecord(params.registry, params.request.targetAgentId);
  if (!target) {
    throw new Error(`Unknown agent control target: ${params.request.targetAgentId}`);
  }
  const authorization = authorizeAgentControlAction({
    registry: params.registry,
    principal: params.principal,
    targetAgentId: params.request.targetAgentId,
    action: "requestManagedFileUpdate",
    now: params.now,
  });
  if (!authorization.allowed) {
    throw new Error(`Managed file update denied: ${authorization.reason}`);
  }
  if (!isManagedAgentMarkdownFile({ agent: target, relativePath: params.request.relativePath })) {
    throw new Error(`Managed file update denied: unmanaged path ${params.request.relativePath}`);
  }
  return {
    status: "pending_review",
    request: {
      ...params.request,
      targetAgentId: normalizeAgentId(params.request.targetAgentId),
      relativePath: normalizeRelativePath(params.request.relativePath)!,
    },
    target,
    audit: authorization.audit,
  };
}
