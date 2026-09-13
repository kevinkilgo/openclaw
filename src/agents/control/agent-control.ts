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

export type AgentControlRegistrySnapshotDefaults = {
  ownerTeam: string;
  role: string;
  status: AgentControlStatus;
  endpointBasePath?: string;
  endpointNetworks?: string[];
  workspaceRootPrefix: string;
  managedFiles: string[];
  capabilities: string[];
  management: AgentControlScope;
};

export type AgentControlRegistrySnapshotSource = {
  agentId: string;
  displayName?: string;
  serviceName: string;
  ownerTeam?: string;
  role?: string;
  status?: AgentControlStatus;
  workspaceRoot?: string;
  managedFiles?: string[];
  capabilities?: string[];
  management?: AgentControlScope;
};

export type AgentControlRegistrySnapshotPlan = {
  status: "planned";
  executionMode: AgentControlExecutionMode;
  registry: AgentControlRegistry;
  sourceCount: number;
  normalizedAgentIds: string[];
};

export type AgentControlRegistrySnapshotSummary = {
  totalAgents: number;
  statusCounts: Record<AgentControlStatus, number>;
  ownerTeamCounts: Record<string, number>;
  roleCounts: Record<string, number>;
  capabilityCounts: Record<string, number>;
  managementActionCounts: Record<AgentControlAction, number>;
  fleetManagementEnabled: boolean;
  upchainCommunicationEnabled: boolean;
};

export type AgentControlArtifactPrivacy = {
  classification: "private";
  redaction: "none" | "redacted";
  publicCommit: "forbidden";
  containsProductionTopology: boolean;
  containsWorkspaceRoots: boolean;
};

export type AgentControlRegistrySnapshotArtifact = {
  version: 1;
  snapshotVersion: 1;
  generatedAt: string;
  source?: string;
  privacy: AgentControlArtifactPrivacy;
  plan: AgentControlRegistrySnapshotPlan;
  summary: AgentControlRegistrySnapshotSummary;
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

export type AgentControlShadowRequest =
  | AgentControlOperationRequest
  | ({
      action: "requestManagedFileUpdate";
    } & ManagedFileUpdateRequest);

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

export type AgentControlRegistrySnapshotParseResult =
  | { ok: true; snapshot: AgentControlRegistrySnapshotArtifact }
  | { ok: false; errors: string[] };

export type AgentControlRegistryFileReader = (
  filePath: string,
  encoding: BufferEncoding,
) => Promise<string>;

export type AgentControlShadowAuditAppender = (params: {
  audit: AgentControlAuditEvent;
  request: AgentControlShadowRequest;
}) => Promise<void> | void;

export type AgentControlInternalRouteLiveAdapters = {
  delivery: "disabled";
  workspaceWrites: "disabled";
  serviceMutation: "disabled";
  secretReads: "disabled";
  cronMutation: "disabled";
  databaseMutation: "disabled";
  liveHandlerCalls: "disabled";
};

export type AgentControlInternalRouteRegistrySource = {
  source: "private-artifact";
  path: string;
  failClosed: true;
};

export type AgentControlInternalRouteAuditSink = {
  sink: string;
  failClosed: true;
  requiredFields: readonly [
    "requestId",
    "sourceService",
    "principalAgentId",
    "targetAgentId",
    "action",
    "decision",
  ];
};

export type AgentControlInternalRouteConfig = {
  enabled?: boolean;
  mode: "shadow";
  path: string;
  bind: "internal-gateway-only";
  trustedIdentitySource: "gateway-request-scope";
  allowedPrincipals: {
    agentIds: string[];
    teams: string[];
  };
  allowedActions: AgentControlAction[];
  deniedActions?: AgentControlAction[];
  registry: AgentControlInternalRouteRegistrySource;
  audit: AgentControlInternalRouteAuditSink;
  liveAdapters: AgentControlInternalRouteLiveAdapters;
};

export type AgentControlInternalRouteReadiness =
  | {
      status: "disabled";
      path: string;
      httpStatus: 404 | 403;
      logMarker: "agent-control.route.disabled";
      reason: "route_not_configured" | "route_disabled" | "path_mismatch";
    }
  | {
      status: "enabled_shadow";
      path: string;
      allowedActions: AgentControlAction[];
      deniedActions: AgentControlAction[];
      trustedIdentitySource: "gateway-request-scope";
      registry: AgentControlInternalRouteRegistrySource;
      audit: AgentControlInternalRouteAuditSink;
      liveAdapters: AgentControlInternalRouteLiveAdapters;
    };

export type AgentControlShadowSideEffectCounters = {
  deliveryAttempts: number;
  workspaceWrites: number;
  serviceMutations: number;
  secretReads: number;
  cronMutations: number;
  liveHandlerCalls: number;
};

export type AgentControlShadowRunResult = {
  status: "shadow_allowed" | "shadow_denied";
  executionMode: AgentControlExecutionMode;
  request: AgentControlShadowRequest;
  audit: AgentControlAuditEvent;
  operation?: AgentControlOperationPlan;
  managedFileUpdate?: ReturnType<typeof buildManagedFileUpdatePlan>;
  deniedReason?: string;
  sideEffectCounters: AgentControlShadowSideEffectCounters;
};

export type AgentControlShadowMatrixAttempt = {
  principal: AgentControlPrincipal;
  request: AgentControlShadowRequest;
  auditContext?: AgentControlAuditContext;
};

export type AgentControlShadowMatrixSummary = {
  totalAttempts: number;
  allowed: number;
  denied: number;
  byAction: Record<AgentControlAction, { allowed: number; denied: number }>;
  byReason: Record<string, number>;
  sideEffectCounters: AgentControlShadowSideEffectCounters;
};

export type AgentControlShadowMatrixResult = {
  status: "shadow_matrix_recorded";
  executionMode: AgentControlExecutionMode;
  results: AgentControlShadowRunResult[];
  summary: AgentControlShadowMatrixSummary;
};

export type AgentControlShadowEvidencePackage = {
  version: 1;
  status: "shadow_evidence_ready" | "shadow_evidence_blocked";
  executionMode: AgentControlExecutionMode;
  generatedAt: string;
  evidenceId?: string;
  source?: string;
  privacy: AgentControlArtifactPrivacy;
  approvalDocument?: string;
  riskRegisterDocument?: string;
  summary: AgentControlShadowMatrixSummary & {
    auditEvents: number;
    requestIds: number;
    missingRequestIds: number;
  };
  nonInterruption: {
    liveSideEffectFree: boolean;
    sideEffectCounters: AgentControlShadowSideEffectCounters;
  };
  blockers: string[];
};

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

const ZERO_SHADOW_SIDE_EFFECT_COUNTERS: AgentControlShadowSideEffectCounters = {
  deliveryAttempts: 0,
  workspaceWrites: 0,
  serviceMutations: 0,
  secretReads: 0,
  cronMutations: 0,
  liveHandlerCalls: 0,
};

const APP03_LIVE_ADAPTER_KEYS = [
  "delivery",
  "workspaceWrites",
  "serviceMutation",
  "secretReads",
  "cronMutation",
  "databaseMutation",
  "liveHandlerCalls",
] as const satisfies readonly (keyof AgentControlInternalRouteLiveAdapters)[];

const APP03_AUDIT_REQUIRED_FIELDS = [
  "requestId",
  "sourceService",
  "principalAgentId",
  "targetAgentId",
  "action",
  "decision",
] as const satisfies AgentControlInternalRouteAuditSink["requiredFields"];

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

const AgentControlRegistrySnapshotPlanSchema = z
  .object({
    status: z.literal("planned"),
    executionMode: z.literal("dry_run"),
    registry: AgentControlRegistrySchema,
    sourceCount: z.number().int().nonnegative(),
    normalizedAgentIds: z.array(z.string().trim().min(1)),
  })
  .strict();

const AgentControlRegistrySnapshotSummarySchema = z
  .object({
    totalAgents: z.number().int().nonnegative(),
    statusCounts: z.record(z.enum(AGENT_CONTROL_STATUSES), z.number().int().nonnegative()),
    ownerTeamCounts: z.record(z.string().trim().min(1), z.number().int().nonnegative()),
    roleCounts: z.record(z.string().trim().min(1), z.number().int().nonnegative()),
    capabilityCounts: z.record(z.string().trim().min(1), z.number().int().nonnegative()),
    managementActionCounts: z.record(z.enum(AGENT_CONTROL_ACTIONS), z.number().int().nonnegative()),
    fleetManagementEnabled: z.boolean(),
    upchainCommunicationEnabled: z.boolean(),
  })
  .strict();

const AgentControlArtifactPrivacySchema = z
  .object({
    classification: z.literal("private"),
    redaction: z.enum(["none", "redacted"]),
    publicCommit: z.literal("forbidden"),
    containsProductionTopology: z.boolean(),
    containsWorkspaceRoots: z.boolean(),
  })
  .strict();

const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const AgentControlRegistrySnapshotArtifactSchema = z
  .object({
    version: z.literal(1),
    snapshotVersion: z.literal(1),
    generatedAt: z.string().regex(ISO_INSTANT_PATTERN, "generatedAt must be an ISO instant"),
    source: z.string().trim().min(1).optional(),
    privacy: AgentControlArtifactPrivacySchema,
    plan: AgentControlRegistrySnapshotPlanSchema,
    summary: AgentControlRegistrySnapshotSummarySchema,
  })
  .strict()
  .superRefine((snapshot, ctx) => {
    const registryErrors = validateAgentControlRegistryIntegrity(snapshot.plan.registry);
    for (const error of registryErrors) {
      ctx.addIssue({ code: "custom", path: ["plan", "registry"], message: error });
    }

    const expectedAgentIds = normalizeAgentControlRegistry(snapshot.plan.registry)
      .agents.map((agent) => agent.id)
      .sort((left, right) => left.localeCompare(right));
    if (snapshot.plan.sourceCount !== snapshot.plan.registry.agents.length) {
      ctx.addIssue({
        code: "custom",
        path: ["plan", "sourceCount"],
        message: "sourceCount must match registry agents length",
      });
    }
    if (snapshot.plan.normalizedAgentIds.join("\n") !== expectedAgentIds.join("\n")) {
      ctx.addIssue({
        code: "custom",
        path: ["plan", "normalizedAgentIds"],
        message: "normalizedAgentIds must match sorted normalized registry ids",
      });
    }
    if (snapshot.summary.totalAgents !== snapshot.plan.registry.agents.length) {
      ctx.addIssue({
        code: "custom",
        path: ["summary", "totalAgents"],
        message: "totalAgents must match registry agents length",
      });
    }
  });

function formatRegistryParseIssues(issues: readonly z.core.$ZodIssue[]): string[] {
  return issues.map((issue) => {
    const location = issue.path.length > 0 ? issue.path.join(".") : "registry";
    return `${location}: ${issue.message}`;
  });
}

function sortStrings(values: readonly string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function incrementCount<T extends string>(counts: Record<T, number>, key: T): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

function sortCountRecord<T extends string>(counts: Record<T, number>): Record<T, number> {
  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)),
  ) as Record<T, number>;
}

function emptyStatusCounts(): Record<AgentControlStatus, number> {
  return Object.fromEntries(AGENT_CONTROL_STATUSES.map((status) => [status, 0])) as Record<
    AgentControlStatus,
    number
  >;
}

function emptyActionCounts(): Record<AgentControlAction, number> {
  return Object.fromEntries(AGENT_CONTROL_ACTIONS.map((action) => [action, 0])) as Record<
    AgentControlAction,
    number
  >;
}

function emptyShadowActionSummary(): Record<
  AgentControlAction,
  { allowed: number; denied: number }
> {
  return Object.fromEntries(
    AGENT_CONTROL_ACTIONS.map((action) => [action, { allowed: 0, denied: 0 }]),
  ) as Record<AgentControlAction, { allowed: number; denied: number }>;
}

function mergeShadowSideEffectCounters(
  left: AgentControlShadowSideEffectCounters,
  right: AgentControlShadowSideEffectCounters,
): AgentControlShadowSideEffectCounters {
  return {
    deliveryAttempts: left.deliveryAttempts + right.deliveryAttempts,
    workspaceWrites: left.workspaceWrites + right.workspaceWrites,
    serviceMutations: left.serviceMutations + right.serviceMutations,
    secretReads: left.secretReads + right.secretReads,
    cronMutations: left.cronMutations + right.cronMutations,
    liveHandlerCalls: left.liveHandlerCalls + right.liveHandlerCalls,
  };
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

function mergeActions(
  base: readonly AgentControlAction[],
  overrides?: readonly AgentControlAction[],
): AgentControlAction[] {
  return [...normalizeActionSet([...(overrides ?? base)])];
}

function buildWorkspaceRoot(params: { workspaceRootPrefix: string; agentId: string }): string {
  return path.posix.join(params.workspaceRootPrefix.replaceAll("\\", "/"), params.agentId);
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

function assertApp03LiveAdaptersDisabled(
  liveAdapters: AgentControlInternalRouteLiveAdapters,
): void {
  for (const key of APP03_LIVE_ADAPTER_KEYS) {
    if (liveAdapters[key] !== "disabled") {
      throw new Error(`APP-03 route contract requires liveAdapters.${key}=disabled`);
    }
  }
}

function assertApp03RegistrySource(registry: AgentControlInternalRouteRegistrySource): void {
  if (registry.source !== "private-artifact") {
    throw new Error("APP-03 route contract requires registry.source=private-artifact");
  }
  if (registry.failClosed !== true) {
    throw new Error("APP-03 route contract requires registry.failClosed=true");
  }
  if (!normalizePrivateArtifactPath(registry.path)) {
    throw new Error(
      "APP-03 route contract requires registry.path under .artifacts/ without path escapes",
    );
  }
}

function assertApp03AuditSink(audit: AgentControlInternalRouteAuditSink): void {
  if (audit.failClosed !== true) {
    throw new Error("APP-03 route contract requires audit.failClosed=true");
  }
  if (!normalizePrivateArtifactPath(audit.sink)) {
    throw new Error(
      "APP-03 route contract requires audit.sink under .artifacts/ without path escapes",
    );
  }
  for (const field of APP03_AUDIT_REQUIRED_FIELDS) {
    if (!audit.requiredFields.includes(field)) {
      throw new Error(`APP-03 route contract requires audit.requiredFields.${field}`);
    }
  }
}

function normalizeRoutePath(pathInput: string): string {
  const routePath = pathInput.trim();
  if (!routePath.startsWith("/")) {
    throw new Error("APP-03 route contract path must be absolute");
  }
  return routePath.length > 1 ? routePath.replace(/\/+$/, "") : routePath;
}

function normalizePrivateArtifactPath(pathInput: string): string | undefined {
  const normalized = normalizeRelativePath(pathInput.trim());
  if (!normalized?.startsWith(".artifacts/")) {
    return undefined;
  }
  return normalized;
}

export function resolveAgentControlInternalRouteReadiness(params: {
  config?: AgentControlInternalRouteConfig;
  requestPath?: string;
}): AgentControlInternalRouteReadiness {
  const requestPath = normalizeRoutePath(params.requestPath ?? "/internal/agent-control/v1/shadow");
  if (!params.config) {
    return {
      status: "disabled",
      path: requestPath,
      httpStatus: 404,
      logMarker: "agent-control.route.disabled",
      reason: "route_not_configured",
    };
  }

  const configuredPath = normalizeRoutePath(params.config.path);
  if (configuredPath !== requestPath) {
    return {
      status: "disabled",
      path: requestPath,
      httpStatus: 404,
      logMarker: "agent-control.route.disabled",
      reason: "path_mismatch",
    };
  }
  if (params.config.enabled !== true) {
    return {
      status: "disabled",
      path: configuredPath,
      httpStatus: 404,
      logMarker: "agent-control.route.disabled",
      reason: "route_disabled",
    };
  }
  if (params.config.mode !== "shadow") {
    throw new Error("APP-03 route contract only supports shadow mode");
  }
  if (params.config.bind !== "internal-gateway-only") {
    throw new Error("APP-03 route contract must bind internal-gateway-only");
  }
  if (params.config.trustedIdentitySource !== "gateway-request-scope") {
    throw new Error("APP-03 route contract requires trustedIdentitySource=gateway-request-scope");
  }
  if (params.config.allowedPrincipals.agentIds.length === 0) {
    throw new Error("APP-03 route contract requires at least one allowed principal agent");
  }

  const allowedActions = [...normalizeActionSet(params.config.allowedActions)];
  const deniedActions = [...normalizeActionSet(params.config.deniedActions ?? [])];
  if (allowedActions.includes("sendMessage")) {
    throw new Error("APP-03 route contract must not allow sendMessage");
  }
  if (!deniedActions.includes("sendMessage")) {
    deniedActions.push("sendMessage");
  }
  assertApp03RegistrySource(params.config.registry);
  assertApp03AuditSink(params.config.audit);
  assertApp03LiveAdaptersDisabled(params.config.liveAdapters);

  return {
    status: "enabled_shadow",
    path: configuredPath,
    allowedActions,
    deniedActions,
    trustedIdentitySource: params.config.trustedIdentitySource,
    registry: params.config.registry,
    audit: params.config.audit,
    liveAdapters: params.config.liveAdapters,
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

export function buildAgentControlRegistrySnapshot(params: {
  sources: AgentControlRegistrySnapshotSource[];
  defaults: AgentControlRegistrySnapshotDefaults;
  fleetManagement?: AgentControlFleetManagementScope;
  upchainCommunication?: AgentControlUpchainCommunicationPolicy;
}): AgentControlRegistrySnapshotPlan {
  const agents = params.sources
    .map((source) => {
      const agentId = normalizeAgentId(source.agentId);
      if (!agentId) {
        throw new Error("Agent control registry snapshot denied: empty source agent id");
      }
      const serviceName = source.serviceName.trim();
      if (!serviceName) {
        throw new Error(`Agent control registry snapshot denied: ${agentId} missing service name`);
      }
      const management = normalizeManagementScope(source.management ?? params.defaults.management);
      const managedFiles = source.managedFiles ?? params.defaults.managedFiles;
      const capabilities = source.capabilities ?? params.defaults.capabilities;

      return {
        id: agentId,
        ...(source.displayName?.trim() ? { displayName: source.displayName.trim() } : {}),
        ownerTeam: source.ownerTeam?.trim() || params.defaults.ownerTeam,
        role: source.role?.trim() || params.defaults.role,
        status: source.status ?? params.defaults.status,
        endpoint: {
          serviceName,
          ...(params.defaults.endpointBasePath
            ? { basePath: params.defaults.endpointBasePath }
            : {}),
          ...(params.defaults.endpointNetworks
            ? { networks: params.defaults.endpointNetworks }
            : {}),
        },
        workspace: {
          root:
            source.workspaceRoot ??
            buildWorkspaceRoot({
              workspaceRootPrefix: params.defaults.workspaceRootPrefix,
              agentId,
            }),
          managedFiles,
        },
        capabilities,
        management: {
          ...management,
          actions: mergeActions(params.defaults.management.actions, source.management?.actions),
        },
      } satisfies AgentControlRecord;
    })
    .sort((left, right) => left.id.localeCompare(right.id));

  const registry: AgentControlRegistry = {
    version: 1,
    ...(params.fleetManagement ? { fleetManagement: params.fleetManagement } : {}),
    ...(params.upchainCommunication ? { upchainCommunication: params.upchainCommunication } : {}),
    agents,
  };
  const errors = validateAgentControlRegistryIntegrity(registry);
  if (errors.length > 0) {
    throw new Error(`Invalid agent control registry snapshot: ${errors.join("; ")}`);
  }
  const normalized = normalizeAgentControlRegistry(registry);
  return {
    status: "planned",
    executionMode: "dry_run",
    registry: normalized,
    sourceCount: params.sources.length,
    normalizedAgentIds: normalized.agents.map((agent) => agent.id),
  };
}

function summarizeAgentControlRegistrySnapshotPlan(
  plan: AgentControlRegistrySnapshotPlan,
): AgentControlRegistrySnapshotSummary {
  const statusCounts = emptyStatusCounts();
  const ownerTeamCounts: Record<string, number> = {};
  const roleCounts: Record<string, number> = {};
  const capabilityCounts: Record<string, number> = {};
  const managementActionCounts = emptyActionCounts();

  for (const agent of plan.registry.agents) {
    incrementCount(statusCounts, agent.status);
    incrementCount(ownerTeamCounts, agent.ownerTeam);
    incrementCount(roleCounts, agent.role);
    for (const capability of sortStrings(agent.capabilities)) {
      incrementCount(capabilityCounts, capability);
    }
    for (const action of agent.management.actions) {
      incrementCount(managementActionCounts, action);
    }
  }

  return {
    totalAgents: plan.registry.agents.length,
    statusCounts,
    ownerTeamCounts: sortCountRecord(ownerTeamCounts),
    roleCounts: sortCountRecord(roleCounts),
    capabilityCounts: sortCountRecord(capabilityCounts),
    managementActionCounts,
    fleetManagementEnabled: plan.registry.fleetManagement !== undefined,
    upchainCommunicationEnabled: plan.registry.upchainCommunication !== undefined,
  };
}

export function buildAgentControlRegistrySnapshotArtifact(params: {
  snapshot: AgentControlRegistrySnapshotPlan;
  generatedAt?: Date;
  source?: string;
}): AgentControlRegistrySnapshotArtifact {
  const source = params.source?.trim();
  const artifact: AgentControlRegistrySnapshotArtifact = {
    version: 1,
    snapshotVersion: 1,
    generatedAt: (params.generatedAt ?? new Date()).toISOString(),
    ...(source ? { source } : {}),
    privacy: {
      classification: "private",
      redaction: "none",
      publicCommit: "forbidden",
      containsProductionTopology: true,
      containsWorkspaceRoots: true,
    },
    plan: params.snapshot,
    summary: summarizeAgentControlRegistrySnapshotPlan(params.snapshot),
  };
  const result = AgentControlRegistrySnapshotArtifactSchema.safeParse(artifact);
  if (!result.success) {
    throw new Error(
      `Invalid agent control registry snapshot artifact: ${formatRegistryParseIssues(result.error.issues).join("; ")}`,
    );
  }
  return result.data;
}

export function parseAgentControlRegistrySnapshotJson(params: {
  raw: string;
  source?: string;
}): AgentControlRegistrySnapshotParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(params.raw);
  } catch (error) {
    return {
      ok: false,
      errors: [
        `${params.source ?? "agent-control registry snapshot"}: invalid JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ],
    };
  }

  const result = AgentControlRegistrySnapshotArtifactSchema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, errors: formatRegistryParseIssues(result.error.issues) };
  }

  return { ok: true, snapshot: result.data };
}

export function serializeAgentControlRegistrySnapshot(
  snapshot: AgentControlRegistrySnapshotArtifact,
): string {
  const result = AgentControlRegistrySnapshotArtifactSchema.safeParse(snapshot);
  if (!result.success) {
    throw new Error(
      `Invalid agent control registry snapshot artifact: ${formatRegistryParseIssues(result.error.issues).join("; ")}`,
    );
  }
  return `${JSON.stringify(result.data, null, 2)}\n`;
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

function shadowDeniedAudit(params: {
  audit: AgentControlAuditEvent;
  reason: string;
}): AgentControlAuditEvent {
  return {
    ...params.audit,
    decision: "deny",
    reason: params.reason,
  };
}

function auditReasonFromError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const marker = "denied: ";
  const markerIndex = message.indexOf(marker);
  if (markerIndex >= 0) {
    return message.slice(markerIndex + marker.length).trim() || "shadow_validation_denied";
  }
  if (message.startsWith("Unknown agent control target:")) {
    return "target_not_found";
  }
  return "shadow_validation_denied";
}

export async function runAgentControlShadowOperation(params: {
  registry: AgentControlRegistry;
  principal: AgentControlPrincipal;
  request: AgentControlShadowRequest;
  auditAppender: AgentControlShadowAuditAppender;
  now?: Date;
  auditContext?: AgentControlAuditContext;
}): Promise<AgentControlShadowRunResult> {
  const authorization = authorizeAgentControlAction({
    registry: params.registry,
    principal: params.principal,
    targetAgentId: params.request.targetAgentId,
    action: params.request.action,
    now: params.now,
    auditContext: params.auditContext,
  });

  if (!authorization.allowed) {
    await params.auditAppender({ audit: authorization.audit, request: params.request });
    return {
      status: "shadow_denied",
      executionMode: "dry_run",
      request: params.request,
      audit: authorization.audit,
      deniedReason: authorization.reason,
      sideEffectCounters: { ...ZERO_SHADOW_SIDE_EFFECT_COUNTERS },
    };
  }

  try {
    if (params.request.action === "requestManagedFileUpdate") {
      const managedFileUpdate = buildManagedFileUpdatePlan({
        registry: params.registry,
        principal: params.principal,
        request: params.request,
        now: params.now,
        auditContext: params.auditContext,
      });
      await params.auditAppender({ audit: managedFileUpdate.audit, request: params.request });
      return {
        status: "shadow_allowed",
        executionMode: "dry_run",
        request: params.request,
        audit: managedFileUpdate.audit,
        managedFileUpdate,
        sideEffectCounters: { ...ZERO_SHADOW_SIDE_EFFECT_COUNTERS },
      };
    }

    const operation = buildAgentControlOperationPlan({
      registry: params.registry,
      principal: params.principal,
      request: params.request,
      now: params.now,
      auditContext: params.auditContext,
    });
    await params.auditAppender({ audit: operation.audit, request: params.request });
    return {
      status: "shadow_allowed",
      executionMode: "dry_run",
      request: params.request,
      audit: operation.audit,
      operation,
      sideEffectCounters: { ...ZERO_SHADOW_SIDE_EFFECT_COUNTERS },
    };
  } catch (error) {
    const reason = auditReasonFromError(error);
    const audit = shadowDeniedAudit({ audit: authorization.audit, reason });
    await params.auditAppender({ audit, request: params.request });
    return {
      status: "shadow_denied",
      executionMode: "dry_run",
      request: params.request,
      audit,
      deniedReason: reason,
      sideEffectCounters: { ...ZERO_SHADOW_SIDE_EFFECT_COUNTERS },
    };
  }
}

export async function runAgentControlShadowMatrix(params: {
  registry: AgentControlRegistry;
  attempts: AgentControlShadowMatrixAttempt[];
  auditAppender: AgentControlShadowAuditAppender;
  now?: Date;
}): Promise<AgentControlShadowMatrixResult> {
  const results: AgentControlShadowRunResult[] = [];
  for (const attempt of params.attempts) {
    results.push(
      await runAgentControlShadowOperation({
        registry: params.registry,
        principal: attempt.principal,
        request: attempt.request,
        auditAppender: params.auditAppender,
        now: params.now,
        auditContext: attempt.auditContext,
      }),
    );
  }

  const byAction = emptyShadowActionSummary();
  const byReason: Record<string, number> = {};
  let sideEffectCounters = { ...ZERO_SHADOW_SIDE_EFFECT_COUNTERS };
  for (const result of results) {
    const actionSummary = byAction[result.request.action];
    if (result.status === "shadow_allowed") {
      actionSummary.allowed += 1;
    } else {
      actionSummary.denied += 1;
      incrementCount(byReason, result.deniedReason ?? result.audit.reason);
    }
    sideEffectCounters = mergeShadowSideEffectCounters(
      sideEffectCounters,
      result.sideEffectCounters,
    );
  }

  return {
    status: "shadow_matrix_recorded",
    executionMode: "dry_run",
    results,
    summary: {
      totalAttempts: results.length,
      allowed: results.filter((result) => result.status === "shadow_allowed").length,
      denied: results.filter((result) => result.status === "shadow_denied").length,
      byAction,
      byReason: sortCountRecord(byReason),
      sideEffectCounters,
    },
  };
}

export function buildAgentControlShadowEvidencePackage(params: {
  matrix: AgentControlShadowMatrixResult;
  generatedAt: Date;
  evidenceId?: string;
  source?: string;
  redaction?: AgentControlArtifactPrivacy["redaction"];
  approvalDocument?: string;
  riskRegisterDocument?: string;
}): AgentControlShadowEvidencePackage {
  const blockers: string[] = [];
  const sideEffectCounters = { ...params.matrix.summary.sideEffectCounters };
  const liveSideEffectFree = Object.values(sideEffectCounters).every((count) => count === 0);
  if (!liveSideEffectFree) {
    blockers.push("live side-effect counter is nonzero");
  }

  const auditEvents = params.matrix.results.length;
  const requestIds = new Set(
    params.matrix.results
      .map((result) => result.audit.requestId?.trim())
      .filter((requestId): requestId is string => Boolean(requestId)),
  );
  const missingRequestIds = params.matrix.results.filter(
    (result) => !result.audit.requestId?.trim(),
  ).length;
  if (missingRequestIds > 0) {
    blockers.push("one or more shadow attempts are missing request ids");
  }
  if (params.matrix.summary.totalAttempts !== auditEvents) {
    blockers.push("shadow matrix attempt count does not match audit event count");
  }

  return {
    version: 1,
    status: blockers.length === 0 ? "shadow_evidence_ready" : "shadow_evidence_blocked",
    executionMode: "dry_run",
    generatedAt: params.generatedAt.toISOString(),
    evidenceId: params.evidenceId?.trim() || undefined,
    source: params.source?.trim() || undefined,
    privacy: {
      classification: "private",
      redaction: params.redaction ?? "redacted",
      publicCommit: "forbidden",
      containsProductionTopology: false,
      containsWorkspaceRoots: false,
    },
    approvalDocument: params.approvalDocument?.trim() || undefined,
    riskRegisterDocument: params.riskRegisterDocument?.trim() || undefined,
    summary: {
      ...params.matrix.summary,
      auditEvents,
      requestIds: requestIds.size,
      missingRequestIds,
    },
    nonInterruption: {
      liveSideEffectFree,
      sideEffectCounters,
    },
    blockers,
  };
}
