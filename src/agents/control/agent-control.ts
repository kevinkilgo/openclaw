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

export type AgentControlFleetManagementScope = AgentControlScope & {
  /** Explicit targets removed from the fleet-wide management grant. */
  excludedAgentIds?: string[];
};

export type AgentControlUpchainCommunicationPolicy = {
  /** Managerial agents allowed as upward communication targets, e.g. Artemis/Fiona. */
  targetAgentIds: string[];
  /** Explicit employee or subagent ids allowed to initiate upward communication. */
  allowedSourceAgentIds?: string[];
  /** Optional source owner-team allowlist for generated employee cohorts. */
  allowedSourceOwnerTeams?: string[];
  /** Upward actions start with message delivery only. */
  actions: Extract<AgentControlAction, "sendMessage">[];
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
  /** Optional fleet-wide management policy for executives/managers such as Artemis/Fiona. */
  fleetManagement?: AgentControlFleetManagementScope;
  /** Strict allowlist for employee/subagent initiated communication up to Artemis/Fiona. */
  upchainCommunication?: AgentControlUpchainCommunicationPolicy;
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

export type AgentControlExecutionMode = "dry_run";

export type AgentControlAuditContext = {
  /** Caller-provided correlation id for durable audit appenders. */
  requestId?: string;
  /** Trusted internal service identity that submitted the request. */
  sourceService?: string;
  /** Source-only plans are inert until a later approved runtime adapter consumes them. */
  executionMode?: AgentControlExecutionMode;
};

export type AgentControlAuditEvent = {
  type: "agent-control.authorization";
  at: string;
  principalAgentId: string;
  targetAgentId: string;
  action: AgentControlAction;
  decision: "allow" | "deny";
  reason: string;
  executionMode: AgentControlExecutionMode;
  requestId?: string;
  sourceService?: string;
};

export type ManagedFileUpdateRequest = {
  targetAgentId: string;
  relativePath: string;
  proposedContent: string;
  reason: string;
};

export type AgentControlOperationRequest =
  | { action: "readStatus"; targetAgentId: string }
  | { action: "sendMessage"; targetAgentId: string; message: string }
  | { action: "readManagedFile"; targetAgentId: string; relativePath: string };

export type AgentControlOperationPlan = {
  status: "planned";
  executionMode: AgentControlExecutionMode;
  action: AgentControlOperationRequest["action"];
  target: AgentControlRecord;
  audit: AgentControlAuditEvent;
  endpoint?: AgentControlEndpoint;
  workspace?: AgentControlWorkspace;
  relativePath?: string;
  message?: string;
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

const AgentControlFleetManagementScopeSchema = AgentControlScopeSchema.extend({
  excludedAgentIds: z.array(z.string().trim().min(1)).optional(),
}).strict();

const AgentControlUpchainCommunicationPolicySchema = z
  .object({
    targetAgentIds: z.array(z.string().trim().min(1)),
    allowedSourceAgentIds: z.array(z.string().trim().min(1)).optional(),
    allowedSourceOwnerTeams: z.array(z.string().trim().min(1)).optional(),
    actions: z.array(z.literal("sendMessage")),
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
    fleetManagement: AgentControlFleetManagementScopeSchema.optional(),
    upchainCommunication: AgentControlUpchainCommunicationPolicySchema.optional(),
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

function normalizeAuditContext(context?: AgentControlAuditContext): AgentControlAuditContext {
  const requestId = context?.requestId?.trim();
  const sourceService = context?.sourceService?.trim();
  return {
    executionMode: "dry_run",
    ...(requestId ? { requestId } : {}),
    ...(sourceService ? { sourceService } : {}),
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

function normalizeManagementScope<T extends AgentControlScope>(
  scope: T,
): Omit<T, "managers" | "managerTeams" | "actions"> & AgentControlScope {
  return {
    ...scope,
    managers: [...new Set((scope.managers ?? []).map(normalizeAgentId).filter(Boolean))],
    managerTeams: [
      ...new Set((scope.managerTeams ?? []).map((team) => team.trim()).filter(Boolean)),
    ],
    actions: [...normalizeActionSet(scope.actions)],
  };
}

function normalizeFleetManagementScope(
  scope: AgentControlFleetManagementScope,
): AgentControlFleetManagementScope {
  const normalized = normalizeManagementScope(scope);
  return {
    ...normalized,
    excludedAgentIds: [
      ...new Set((scope.excludedAgentIds ?? []).map(normalizeAgentId).filter(Boolean)),
    ],
  };
}

function normalizeUpchainCommunicationPolicy(
  policy: AgentControlUpchainCommunicationPolicy,
): AgentControlUpchainCommunicationPolicy {
  return {
    targetAgentIds: [...new Set(policy.targetAgentIds.map(normalizeAgentId).filter(Boolean))],
    allowedSourceAgentIds: [
      ...new Set((policy.allowedSourceAgentIds ?? []).map(normalizeAgentId).filter(Boolean)),
    ],
    allowedSourceOwnerTeams: [
      ...new Set((policy.allowedSourceOwnerTeams ?? []).map((team) => team.trim()).filter(Boolean)),
    ],
    actions: [...new Set(policy.actions)],
  };
}

export function normalizeAgentControlRecord(record: AgentControlRecord): AgentControlRecord {
  return {
    ...record,
    id: normalizeAgentId(record.id),
    capabilities: [
      ...new Set(record.capabilities.map((capability) => capability.trim()).filter(Boolean)),
    ],
    management: normalizeManagementScope(record.management),
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
  return {
    version: 1,
    ...(registry.fleetManagement
      ? { fleetManagement: normalizeFleetManagementScope(registry.fleetManagement) }
      : {}),
    ...(registry.upchainCommunication
      ? { upchainCommunication: normalizeUpchainCommunicationPolicy(registry.upchainCommunication) }
      : {}),
    agents: [...byId.values()],
  };
}

function containsParentDirectorySegment(input: string): boolean {
  return input.replaceAll("\\", "/").split("/").includes("..");
}

export function validateAgentControlRegistryIntegrity(registry: AgentControlRegistry): string[] {
  const errors: string[] = [];
  const agentIndexesById = new Map<string, number>();

  if (registry.fleetManagement) {
    const managers = (registry.fleetManagement.managers ?? [])
      .map(normalizeAgentId)
      .filter(Boolean);
    const managerTeams = (registry.fleetManagement.managerTeams ?? [])
      .map((team) => team.trim())
      .filter(Boolean);
    if (managers.length === 0 && managerTeams.length === 0) {
      errors.push("fleetManagement: at least one manager or manager team is required");
    }
    if (registry.fleetManagement.actions.length === 0) {
      errors.push("fleetManagement.actions: at least one action is required");
    }
  }

  if (registry.upchainCommunication) {
    const policy = registry.upchainCommunication;
    const targetAgentIds = policy.targetAgentIds.map(normalizeAgentId).filter(Boolean);
    const allowedSourceAgentIds = (policy.allowedSourceAgentIds ?? [])
      .map(normalizeAgentId)
      .filter(Boolean);
    const allowedSourceOwnerTeams = (policy.allowedSourceOwnerTeams ?? [])
      .map((team) => team.trim())
      .filter(Boolean);
    if (targetAgentIds.length === 0) {
      errors.push("upchainCommunication.targetAgentIds: at least one target is required");
    }
    if (allowedSourceAgentIds.length === 0 && allowedSourceOwnerTeams.length === 0) {
      errors.push(
        "upchainCommunication: at least one allowed source agent or owner team is required",
      );
    }
    if (policy.actions.length === 0) {
      errors.push("upchainCommunication.actions: at least one action is required");
    }
  }

  for (const [index, record] of registry.agents.entries()) {
    const normalizedId = normalizeAgentId(record.id);
    const existingIndex = agentIndexesById.get(normalizedId);
    if (existingIndex !== undefined) {
      errors.push(
        `agents.${index}.id: duplicate agent id "${normalizedId}" already declared at agents.${existingIndex}.id`,
      );
    } else {
      agentIndexesById.set(normalizedId, index);
    }

    const managers = (record.management.managers ?? []).map(normalizeAgentId).filter(Boolean);
    const managerTeams = (record.management.managerTeams ?? [])
      .map((team) => team.trim())
      .filter(Boolean);
    if (managers.length === 0 && managerTeams.length === 0) {
      errors.push(`agents.${index}.management: at least one manager or manager team is required`);
    }
    if (record.management.actions.length === 0) {
      errors.push(`agents.${index}.management.actions: at least one action is required`);
    }

    for (const [managedFileIndex, managedFile] of record.workspace.managedFiles.entries()) {
      if (containsParentDirectorySegment(managedFile)) {
        errors.push(
          `agents.${index}.workspace.managedFiles.${managedFileIndex}: managed file path must not contain parent directory segments`,
        );
      }
    }
  }

  return errors;
}

function hasManagementGrant(scope: AgentControlScope, principal: AgentControlPrincipal): boolean {
  const directGrant = (scope.managers ?? []).map(normalizeAgentId).includes(principal.agentId);
  const teamGrant = (scope.managerTeams ?? []).some((team) => principal.teams.includes(team));
  return directGrant || teamGrant;
}

function hasFleetManagementGrant(params: {
  registry: AgentControlRegistry;
  principal: AgentControlPrincipal;
  targetAgentId: string;
  action: AgentControlAction;
}): boolean {
  const fleetManagement = normalizeAgentControlRegistry(params.registry).fleetManagement;
  if (!fleetManagement) {
    return false;
  }
  if ((fleetManagement.excludedAgentIds ?? []).includes(normalizeAgentId(params.targetAgentId))) {
    return false;
  }
  return (
    hasManagementGrant(fleetManagement, params.principal) &&
    normalizeActionSet(fleetManagement.actions).has(params.action)
  );
}

function hasUpchainCommunicationGrant(params: {
  registry: AgentControlRegistry;
  principal: AgentControlPrincipal;
  targetAgentId: string;
  action: AgentControlAction;
}): boolean {
  if (params.action !== "sendMessage") {
    return false;
  }
  const registry = normalizeAgentControlRegistry(params.registry);
  const policy = registry.upchainCommunication;
  if (!policy || !policy.targetAgentIds.includes(normalizeAgentId(params.targetAgentId))) {
    return false;
  }
  const source = resolveAgentControlRecord(registry, params.principal.agentId);
  if (!source) {
    return false;
  }
  return (
    (policy.allowedSourceAgentIds ?? []).includes(source.id) ||
    (policy.allowedSourceOwnerTeams ?? []).includes(source.ownerTeam)
  );
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

  const integrityErrors = validateAgentControlRegistryIntegrity(result.data);
  if (integrityErrors.length > 0) {
    return { ok: false, errors: integrityErrors };
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
  auditContext?: AgentControlAuditContext;
}): { allowed: boolean; reason: string; audit: AgentControlAuditEvent } {
  const principal = normalizePrincipal(params.principal);
  const auditContext = normalizeAuditContext(params.auditContext);
  const target = resolveAgentControlRecord(params.registry, params.targetAgentId);
  let allowed = false;
  let reason = "target_not_found";

  if (target) {
    const actions = normalizeActionSet(target.management.actions);
    const scopedGrant = hasManagementGrant(target.management, principal);
    const fleetGrant = hasFleetManagementGrant({
      registry: params.registry,
      principal,
      targetAgentId: params.targetAgentId,
      action: params.action,
    });
    const upchainGrant = hasUpchainCommunicationGrant({
      registry: params.registry,
      principal,
      targetAgentId: params.targetAgentId,
      action: params.action,
    });
    const actionGrant = actions.has(params.action);
    allowed = fleetGrant || upchainGrant || (scopedGrant && actionGrant);
    if (fleetGrant) {
      reason = "allowed_by_fleet_management_scope";
    } else if (upchainGrant) {
      reason = "allowed_by_upchain_communication_allowlist";
    } else if (!scopedGrant) {
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
      executionMode: auditContext.executionMode ?? "dry_run",
      ...(auditContext.requestId ? { requestId: auditContext.requestId } : {}),
      ...(auditContext.sourceService ? { sourceService: auditContext.sourceService } : {}),
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
  auditContext?: AgentControlAuditContext;
}): {
  status: "pending_review";
  executionMode: AgentControlExecutionMode;
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
    auditContext: params.auditContext,
  });
  if (!authorization.allowed) {
    throw new Error(`Managed file update denied: ${authorization.reason}`);
  }
  if (!isManagedAgentMarkdownFile({ agent: target, relativePath: params.request.relativePath })) {
    throw new Error(`Managed file update denied: unmanaged path ${params.request.relativePath}`);
  }
  return {
    status: "pending_review",
    executionMode: "dry_run",
    request: {
      ...params.request,
      targetAgentId: normalizeAgentId(params.request.targetAgentId),
      relativePath: normalizeRelativePath(params.request.relativePath)!,
    },
    target,
    audit: authorization.audit,
  };
}

export function buildAgentControlOperationPlan(params: {
  registry: AgentControlRegistry;
  principal: AgentControlPrincipal;
  request: AgentControlOperationRequest;
  now?: Date;
  auditContext?: AgentControlAuditContext;
}): AgentControlOperationPlan {
  const target = resolveAgentControlRecord(params.registry, params.request.targetAgentId);
  if (!target) {
    throw new Error(`Unknown agent control target: ${params.request.targetAgentId}`);
  }

  const authorization = authorizeAgentControlAction({
    registry: params.registry,
    principal: params.principal,
    targetAgentId: params.request.targetAgentId,
    action: params.request.action,
    now: params.now,
    auditContext: params.auditContext,
  });
  if (!authorization.allowed) {
    throw new Error(`Agent control operation denied: ${authorization.reason}`);
  }

  if (params.request.action === "readManagedFile") {
    if (!isManagedAgentMarkdownFile({ agent: target, relativePath: params.request.relativePath })) {
      throw new Error(
        `Agent control operation denied: unmanaged path ${params.request.relativePath}`,
      );
    }
    return {
      status: "planned",
      executionMode: "dry_run",
      action: params.request.action,
      target,
      workspace: target.workspace,
      relativePath: normalizeRelativePath(params.request.relativePath)!,
      audit: authorization.audit,
    };
  }

  if (params.request.action === "sendMessage") {
    const message = params.request.message.trim();
    if (message.length === 0) {
      throw new Error("Agent control operation denied: empty message");
    }
    return {
      status: "planned",
      executionMode: "dry_run",
      action: params.request.action,
      target,
      endpoint: target.endpoint,
      message,
      audit: authorization.audit,
    };
  }

  return {
    status: "planned",
    executionMode: "dry_run",
    action: params.request.action,
    target,
    endpoint: target.endpoint,
    audit: authorization.audit,
  };
}
