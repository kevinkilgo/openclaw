import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  authorizeAgentControlAction,
  buildAgentControlOperationPlan,
  buildAgentControlRegistrySnapshot,
  buildAgentControlRegistrySnapshotArtifact,
  buildAgentControlShadowEvidencePackage,
  buildManagedFileUpdatePlan,
  isManagedAgentMarkdownFile,
  listManageableAgents,
  loadAgentControlRegistryFile,
  normalizeAgentControlRegistry,
  parseAgentControlRegistryJson,
  parseAgentControlRegistrySnapshotJson,
  resolveAgentControlTarget,
  runAgentControlShadowMatrix,
  runAgentControlShadowOperation,
  serializeAgentControlRegistrySnapshot,
  validateAgentControlRegistryIntegrity,
  type AgentControlRegistry,
} from "./agent-control.js";

const moduleSourcePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "agent-control.ts",
);

const registry: AgentControlRegistry = {
  version: 1,
  agents: [
    {
      id: "Reese",
      displayName: "Reese",
      ownerTeam: "artemis",
      role: "research",
      status: "ready",
      endpoint: {
        serviceName: "employee-agent-reese",
        basePath: "/agent-control",
        networks: ["openclaw-backplane"],
      },
      workspace: {
        root: "/srv/openclaw/agents/reese",
        managedFiles: ["AGENTS.md", "SOUL.md", "memory/", "knowledge/"],
      },
      capabilities: ["research", "synthesis", "source-analysis", "research"],
      management: {
        managers: ["Artemis"],
        managerTeams: ["artemis-leadership"],
        actions: [
          "list",
          "readStatus",
          "sendMessage",
          "readManagedFile",
          "requestManagedFileUpdate",
        ],
      },
    },
    {
      id: "Fiona",
      displayName: "Fiona",
      ownerTeam: "fiona",
      role: "finance-manager",
      status: "ready",
      endpoint: {
        serviceName: "employee-agent-fiona",
        basePath: "/agent-control",
        networks: ["openclaw-backplane"],
      },
      workspace: {
        root: "/srv/openclaw/agents/fiona",
        managedFiles: ["AGENTS.md", "knowledge/"],
      },
      capabilities: ["finance", "forecasting"],
      management: {
        managerTeams: ["fiona-leadership"],
        actions: ["list", "readStatus", "sendMessage"],
      },
    },
  ],
};

const fleetRegistry: AgentControlRegistry = {
  ...registry,
  fleetManagement: {
    managers: ["Artemis", "Fiona"],
    managerTeams: ["artemis-leadership", "fiona-leadership"],
    actions: ["list", "readStatus", "sendMessage", "readManagedFile"],
  },
  upchainCommunication: {
    targetAgentIds: ["Artemis", "Fiona"],
    allowedSourceAgentIds: ["babbey"],
    allowedSourceOwnerTeams: ["employee-agents"],
    actions: ["sendMessage"],
  },
  agents: [
    {
      id: "Artemis",
      displayName: "Artemis",
      ownerTeam: "artemis",
      role: "chief-of-staff",
      status: "ready",
      endpoint: {
        serviceName: "agent-artemis",
        basePath: "/agent-control",
        networks: ["openclaw-backplane"],
      },
      workspace: {
        root: "/srv/openclaw/agents/artemis",
        managedFiles: ["AGENTS.md", "knowledge/"],
      },
      capabilities: ["management", "orchestration"],
      management: {
        managers: ["Artemis"],
        actions: ["list", "readStatus", "sendMessage", "readManagedFile"],
      },
    },
    ...registry.agents,
    {
      id: "babbey",
      displayName: "Brian Abbey",
      ownerTeam: "employee-agents",
      role: "employee-agent",
      status: "ready",
      endpoint: {
        serviceName: "employee-agent-babbey",
        basePath: "/agent-control",
        networks: ["openclaw-backplane"],
      },
      workspace: {
        root: "/srv/openclaw/data/employee-agents/babbey",
        managedFiles: ["AGENTS.md", "memory/", "knowledge/"],
      },
      capabilities: ["teams", "microsoft365"],
      management: {
        managers: ["brian-abbey"],
        actions: ["readStatus"],
      },
    },
  ],
};

describe("agent control registry", () => {
  it("parses file-backed JSON registry content into normalized records", () => {
    const parsed = parseAgentControlRegistryJson({
      raw: JSON.stringify(registry),
      source: "agent-control.registry.json",
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.registry.agents.map((agent) => agent.id)).toEqual(["reese", "fiona"]);
    expect(parsed.registry.agents[0]?.capabilities).toEqual([
      "research",
      "synthesis",
      "source-analysis",
    ]);
  });

  it("reports malformed registry files without returning a partial registry", () => {
    const wrongVersion = parseAgentControlRegistryJson({
      raw: JSON.stringify({ ...registry, version: 2 }),
      source: "agent-control.registry.json",
    });
    const unsafeManagedPath = parseAgentControlRegistryJson({
      raw: JSON.stringify({
        ...registry,
        agents: [
          {
            ...registry.agents[0],
            workspace: { ...registry.agents[0]!.workspace, managedFiles: ["../AGENTS.md"] },
          },
        ],
      }),
      source: "agent-control.registry.json",
    });

    expect(wrongVersion).toMatchObject({ ok: false });
    expect(wrongVersion.ok ? [] : wrongVersion.errors.join("\n")).toContain("version");
    expect(unsafeManagedPath).toMatchObject({ ok: false });
    expect(unsafeManagedPath.ok ? [] : unsafeManagedPath.errors.join("\n")).toContain(
      "managed file path must be relative",
    );
  });

  it("fails closed on registry integrity gaps before normalization", () => {
    const duplicateId = parseAgentControlRegistryJson({
      raw: JSON.stringify({
        ...registry,
        agents: [
          { ...registry.agents[0], id: "Reese" },
          { ...registry.agents[0], id: "reese" },
        ],
      }),
      source: "agent-control.registry.json",
    });
    const emptyManagement = parseAgentControlRegistryJson({
      raw: JSON.stringify({
        ...registry,
        agents: [
          {
            ...registry.agents[0],
            management: { managers: [], managerTeams: [], actions: [] },
          },
        ],
      }),
      source: "agent-control.registry.json",
    });
    const suspiciousManagedPath = parseAgentControlRegistryJson({
      raw: JSON.stringify({
        ...registry,
        agents: [
          {
            ...registry.agents[0],
            workspace: {
              ...registry.agents[0]!.workspace,
              managedFiles: ["knowledge/../AGENTS.md"],
            },
          },
        ],
      }),
      source: "agent-control.registry.json",
    });

    expect(duplicateId).toMatchObject({ ok: false });
    expect(duplicateId.ok ? [] : duplicateId.errors.join("\n")).toContain("duplicate agent id");
    expect(emptyManagement).toMatchObject({ ok: false });
    expect(emptyManagement.ok ? [] : emptyManagement.errors.join("\n")).toContain(
      "at least one manager or manager team is required",
    );
    expect(emptyManagement.ok ? [] : emptyManagement.errors.join("\n")).toContain(
      "at least one action is required",
    );
    expect(suspiciousManagedPath).toMatchObject({ ok: false });
    expect(suspiciousManagedPath.ok ? [] : suspiciousManagedPath.errors.join("\n")).toContain(
      "must not contain parent directory segments",
    );
  });

  it("exposes registry integrity checks for offline registry preflight", () => {
    expect(validateAgentControlRegistryIntegrity(registry)).toEqual([]);
    expect(
      validateAgentControlRegistryIntegrity({
        ...registry,
        agents: [{ ...registry.agents[0]!, management: { actions: ["list"] } }],
      }),
    ).toEqual(["agents.0.management: at least one manager or manager team is required"]);
  });

  it("loads registry content through an injected file reader", async () => {
    const loaded = await loadAgentControlRegistryFile({
      filePath: "/non-live/agent-control.registry.json",
      readFile: async (filePath, encoding) => {
        expect(filePath).toBe("/non-live/agent-control.registry.json");
        expect(encoding).toBe("utf8");
        return JSON.stringify(registry);
      },
    });

    expect(loaded.agents.map((agent) => agent.id)).toEqual(["reese", "fiona"]);
  });

  it("normalizes ids and deduplicates capabilities without relying on placement", () => {
    const normalized = normalizeAgentControlRegistry(registry);

    expect(normalized.agents[0]?.id).toBe("reese");
    expect(normalized.agents[0]?.capabilities).toEqual([
      "research",
      "synthesis",
      "source-analysis",
    ]);
    expect(normalized.agents[0]?.endpoint.serviceName).toBe("employee-agent-reese");
  });

  it("authorizes manager actions by direct agent grant or team grant", () => {
    const direct = authorizeAgentControlAction({
      registry,
      principal: { agentId: "Artemis", teams: [], roles: ["manager"] },
      targetAgentId: "reese",
      action: "sendMessage",
      now: new Date("2026-09-11T00:00:00.000Z"),
    });
    const team = authorizeAgentControlAction({
      registry,
      principal: { agentId: "Willow", teams: ["artemis-leadership"], roles: ["manager"] },
      targetAgentId: "reese",
      action: "readManagedFile",
      now: new Date("2026-09-11T00:00:00.000Z"),
    });

    expect(direct.allowed).toBe(true);
    expect(direct.audit).toMatchObject({
      principalAgentId: "artemis",
      targetAgentId: "reese",
      decision: "allow",
    });
    expect(team.allowed).toBe(true);
  });

  it("authorizes Artemis and Fiona fleet management across registered agents", () => {
    const artemisToEmployee = authorizeAgentControlAction({
      registry: fleetRegistry,
      principal: { agentId: "Artemis", teams: [], roles: ["manager"] },
      targetAgentId: "babbey",
      action: "sendMessage",
      now: new Date("2026-09-12T00:00:00.000Z"),
    });
    const fionaTeamToEmployee = authorizeAgentControlAction({
      registry: fleetRegistry,
      principal: { agentId: "fiona-delegate", teams: ["fiona-leadership"], roles: ["manager"] },
      targetAgentId: "babbey",
      action: "readManagedFile",
      now: new Date("2026-09-12T00:00:00.000Z"),
    });

    expect(artemisToEmployee).toMatchObject({
      allowed: true,
      reason: "allowed_by_fleet_management_scope",
      audit: {
        principalAgentId: "artemis",
        targetAgentId: "babbey",
        decision: "allow",
      },
    });
    expect(fionaTeamToEmployee).toMatchObject({
      allowed: true,
      reason: "allowed_by_fleet_management_scope",
    });
  });

  it("lets fleet management explicitly exclude sensitive targets", () => {
    const excludedRegistry: AgentControlRegistry = {
      ...fleetRegistry,
      fleetManagement: {
        ...fleetRegistry.fleetManagement!,
        excludedAgentIds: ["babbey"],
      },
    };

    const denied = authorizeAgentControlAction({
      registry: excludedRegistry,
      principal: { agentId: "Fiona", teams: [], roles: ["manager"] },
      targetAgentId: "babbey",
      action: "sendMessage",
      now: new Date("2026-09-12T00:00:00.000Z"),
    });

    expect(denied).toMatchObject({
      allowed: false,
      reason: "principal_not_in_management_scope",
      audit: { decision: "deny" },
    });
  });

  it("allows only explicitly listed employees to send up the chain", () => {
    const allowedToArtemis = authorizeAgentControlAction({
      registry: fleetRegistry,
      principal: { agentId: "babbey", teams: [], roles: ["employee"] },
      targetAgentId: "Artemis",
      action: "sendMessage",
      now: new Date("2026-09-12T00:00:00.000Z"),
    });
    const allowedToFiona = authorizeAgentControlAction({
      registry: fleetRegistry,
      principal: { agentId: "babbey", teams: [], roles: ["employee"] },
      targetAgentId: "Fiona",
      action: "sendMessage",
      now: new Date("2026-09-12T00:00:00.000Z"),
    });

    expect(allowedToArtemis).toMatchObject({
      allowed: true,
      reason: "allowed_by_upchain_communication_allowlist",
      audit: {
        principalAgentId: "babbey",
        targetAgentId: "artemis",
        action: "sendMessage",
        decision: "allow",
      },
    });
    expect(allowedToFiona).toMatchObject({
      allowed: true,
      reason: "allowed_by_upchain_communication_allowlist",
    });
  });

  it("denies unlisted or unknown employees from communicating up the chain", () => {
    const explicitListOnlyRegistry: AgentControlRegistry = {
      ...fleetRegistry,
      upchainCommunication: {
        targetAgentIds: ["Artemis", "Fiona"],
        allowedSourceAgentIds: ["babbey"],
        actions: ["sendMessage"],
      },
    };
    const denied = authorizeAgentControlAction({
      registry: explicitListOnlyRegistry,
      principal: { agentId: "hdadabhoy", teams: [], roles: ["employee"] },
      targetAgentId: "Artemis",
      action: "sendMessage",
      now: new Date("2026-09-12T00:00:00.000Z"),
    });
    const unknownDenied = authorizeAgentControlAction({
      registry: fleetRegistry,
      principal: { agentId: "unknown-employee", teams: [], roles: ["employee"] },
      targetAgentId: "Fiona",
      action: "sendMessage",
      now: new Date("2026-09-12T00:00:00.000Z"),
    });

    expect(denied).toMatchObject({
      allowed: false,
      reason: "principal_not_in_management_scope",
      audit: { decision: "deny" },
    });
    expect(unknownDenied).toMatchObject({
      allowed: false,
      reason: "principal_not_in_management_scope",
      audit: { decision: "deny" },
    });
  });

  it("denies actions outside scope", () => {
    const denied = authorizeAgentControlAction({
      registry,
      principal: { agentId: "Richard", teams: ["platform"], roles: ["manager"] },
      targetAgentId: "fiona",
      action: "readManagedFile",
    });

    expect(denied.allowed).toBe(false);
    expect(denied.reason).toBe("principal_not_in_management_scope");
  });

  it("lists only targets manageable for the requested operation", () => {
    const artemisWritable = listManageableAgents({
      registry,
      principal: { agentId: "Artemis", teams: [], roles: ["manager"] },
      action: "requestManagedFileUpdate",
    });
    const fionaVisible = listManageableAgents({
      registry,
      principal: { agentId: "Fiona", teams: ["fiona-leadership"], roles: ["manager"] },
      action: "readStatus",
    });

    expect(artemisWritable.map((agent) => agent.id)).toEqual(["reese"]);
    expect(fionaVisible.map((agent) => agent.id)).toEqual(["fiona"]);
  });

  it("resolves target endpoint/workspace/capabilities only after authorization", () => {
    const resolution = resolveAgentControlTarget({
      registry,
      principal: { agentId: "Artemis", teams: [], roles: ["manager"] },
      targetAgentId: "reese",
      action: "sendMessage",
    });

    expect(resolution).toMatchObject({
      authorizedAction: "sendMessage",
      endpoint: { serviceName: "employee-agent-reese" },
      workspace: { root: "/srv/openclaw/agents/reese" },
    });
  });

  it("plans authorized status and message operations without executing them", () => {
    const statusPlan = buildAgentControlOperationPlan({
      registry,
      principal: { agentId: "Artemis", teams: [], roles: ["manager"] },
      request: { action: "readStatus", targetAgentId: "reese" },
      now: new Date("2026-09-11T00:00:00.000Z"),
    });
    const messagePlan = buildAgentControlOperationPlan({
      registry,
      principal: { agentId: "Artemis", teams: [], roles: ["manager"] },
      request: { action: "sendMessage", targetAgentId: "reese", message: "  status?  " },
      now: new Date("2026-09-11T00:00:00.000Z"),
    });

    expect(statusPlan).toMatchObject({
      status: "planned",
      executionMode: "dry_run",
      action: "readStatus",
      endpoint: { serviceName: "employee-agent-reese" },
      audit: { decision: "allow" },
    });
    expect(messagePlan).toMatchObject({
      status: "planned",
      executionMode: "dry_run",
      action: "sendMessage",
      message: "status?",
      endpoint: { serviceName: "employee-agent-reese" },
    });
  });

  it("carries sanitized audit correlation fields on inert operation plans", () => {
    const plan = buildAgentControlOperationPlan({
      registry,
      principal: { agentId: "Artemis", teams: [], roles: ["manager"] },
      request: { action: "readStatus", targetAgentId: "reese" },
      now: new Date("2026-09-11T00:00:00.000Z"),
      auditContext: {
        requestId: " request-123 ",
        sourceService: " agent-control-shadow-test ",
      },
    });

    expect(plan).toMatchObject({
      executionMode: "dry_run",
      audit: {
        executionMode: "dry_run",
        requestId: "request-123",
        sourceService: "agent-control-shadow-test",
      },
    });
  });

  it("rejects empty planned messages before any live operation can be wired", () => {
    expect(() =>
      buildAgentControlOperationPlan({
        registry,
        principal: { agentId: "Artemis", teams: [], roles: ["manager"] },
        request: { action: "sendMessage", targetAgentId: "reese", message: "  " },
      }),
    ).toThrow("empty message");
  });
});

describe("agent control registry snapshots", () => {
  const defaults = {
    ownerTeam: "employee-agents",
    role: "employee-agent",
    status: "ready" as const,
    endpointBasePath: "/agent-control",
    endpointNetworks: ["openclaw-backplane"],
    workspaceRootPrefix: "/srv/openclaw/data/employee-agents",
    managedFiles: ["AGENTS.md", "memory/", "knowledge/"],
    capabilities: ["teams"],
    management: {
      managerTeams: ["artemis-leadership", "fiona-leadership"],
      actions: ["list", "readStatus", "sendMessage", "readManagedFile"] as const,
    },
  };

  it("builds a deterministic dry-run registry snapshot from discovered services", () => {
    const snapshot = buildAgentControlRegistrySnapshot({
      sources: [
        {
          agentId: "Haseeb Dadabhoy",
          displayName: "Haseeb Dadabhoy",
          serviceName: "employee-agent-hdadabhoy",
          capabilities: ["teams", "microsoft365"],
        },
        {
          agentId: "babbey",
          displayName: "Brian Abbey",
          serviceName: "employee-agent-babbey",
        },
      ],
      defaults,
      fleetManagement: {
        managers: ["Artemis", "Fiona"],
        actions: ["list", "readStatus", "sendMessage", "readManagedFile"],
      },
      upchainCommunication: {
        targetAgentIds: ["Artemis", "Fiona"],
        allowedSourceOwnerTeams: ["employee-agents"],
        actions: ["sendMessage"],
      },
    });

    expect(snapshot).toMatchObject({
      status: "planned",
      executionMode: "dry_run",
      sourceCount: 2,
      normalizedAgentIds: ["babbey", "haseeb-dadabhoy"],
      registry: {
        version: 1,
        fleetManagement: {
          managers: ["artemis", "fiona"],
        },
      },
    });
    expect(snapshot.registry.agents.map((agent) => agent.endpoint.serviceName)).toEqual([
      "employee-agent-babbey",
      "employee-agent-hdadabhoy",
    ]);
    expect(snapshot.registry.agents[0]).toMatchObject({
      id: "babbey",
      workspace: {
        root: "/srv/openclaw/data/employee-agents/babbey",
      },
      management: {
        managerTeams: ["artemis-leadership", "fiona-leadership"],
      },
    });
  });

  it("serializes and validates deterministic registry snapshot artifacts", () => {
    const snapshot = buildAgentControlRegistrySnapshot({
      sources: [
        {
          agentId: "Haseeb Dadabhoy",
          displayName: "Haseeb Dadabhoy",
          serviceName: "employee-agent-hdadabhoy",
          capabilities: ["teams", "microsoft365"],
        },
        {
          agentId: "babbey",
          displayName: "Brian Abbey",
          serviceName: "employee-agent-babbey",
        },
      ],
      defaults,
      fleetManagement: {
        managers: ["Artemis", "Fiona"],
        actions: ["list", "readStatus", "sendMessage", "readManagedFile"],
      },
      upchainCommunication: {
        targetAgentIds: ["Artemis", "Fiona"],
        allowedSourceOwnerTeams: ["employee-agents"],
        actions: ["sendMessage"],
      },
    });
    const artifact = buildAgentControlRegistrySnapshotArtifact({
      snapshot,
      generatedAt: new Date("2026-09-12T00:00:00.000Z"),
      source: " unit test discovery ",
    });
    const serialized = serializeAgentControlRegistrySnapshot(artifact);
    const parsed = parseAgentControlRegistrySnapshotJson({
      raw: serialized,
      source: "agent-control.snapshot.json",
    });

    expect(serialized).toBe(serializeAgentControlRegistrySnapshot(artifact));
    expect(parsed).toMatchObject({
      ok: true,
      snapshot: {
        version: 1,
        snapshotVersion: 1,
        generatedAt: "2026-09-12T00:00:00.000Z",
        source: "unit test discovery",
        plan: {
          status: "planned",
          executionMode: "dry_run",
          sourceCount: 2,
          normalizedAgentIds: ["babbey", "haseeb-dadabhoy"],
        },
        summary: {
          totalAgents: 2,
          statusCounts: { ready: 2 },
          ownerTeamCounts: { "employee-agents": 2 },
          capabilityCounts: { microsoft365: 1, teams: 2 },
          managementActionCounts: {
            list: 2,
            readStatus: 2,
            sendMessage: 2,
            readManagedFile: 2,
            requestManagedFileUpdate: 0,
          },
          fleetManagementEnabled: true,
          upchainCommunicationEnabled: true,
        },
      },
    });
    expect(serialized).toContain('"serviceName": "employee-agent-babbey"');
    expect(serialized).toContain('"serviceName": "employee-agent-hdadabhoy"');
  });

  it("rejects malformed registry snapshot artifacts without returning partial data", () => {
    const snapshot = buildAgentControlRegistrySnapshot({
      sources: [{ agentId: "Brian Abbey", serviceName: "employee-agent-babbey" }],
      defaults,
    });
    const artifact = buildAgentControlRegistrySnapshotArtifact({
      snapshot,
      generatedAt: new Date("2026-09-12T00:00:00.000Z"),
    });
    const parsed = parseAgentControlRegistrySnapshotJson({
      raw: JSON.stringify({
        ...artifact,
        plan: {
          ...artifact.plan,
          sourceCount: 2,
          normalizedAgentIds: ["wrong-id"],
        },
      }),
      source: "agent-control.snapshot.json",
    });

    expect(parsed).toMatchObject({ ok: false });
    expect(parsed.ok ? [] : parsed.errors.join("\n")).toContain("sourceCount must match");
    expect(parsed.ok ? [] : parsed.errors.join("\n")).toContain("normalizedAgentIds must match");
  });

  it("fails closed when a snapshot would create duplicate registry ids", () => {
    expect(() =>
      buildAgentControlRegistrySnapshot({
        sources: [
          { agentId: "Brian Abbey", serviceName: "employee-agent-babbey" },
          { agentId: "brian-abbey", serviceName: "employee-agent-babbey-copy" },
        ],
        defaults,
      }),
    ).toThrow("duplicate agent id");
  });

  it("fails closed when a snapshot source is missing service identity", () => {
    expect(() =>
      buildAgentControlRegistrySnapshot({
        sources: [{ agentId: "Brian Abbey", serviceName: "  " }],
        defaults,
      }),
    ).toThrow("missing service name");
  });
});

describe("managed agent Markdown files", () => {
  const agent = normalizeAgentControlRegistry(registry).agents[0]!;

  it("allows only explicit managed Markdown files and folders", () => {
    expect(isManagedAgentMarkdownFile({ agent, relativePath: "AGENTS.md" })).toBe(true);
    expect(isManagedAgentMarkdownFile({ agent, relativePath: "memory/2026-09-11.md" })).toBe(true);
    expect(isManagedAgentMarkdownFile({ agent, relativePath: "knowledge/team/Notes.md" })).toBe(
      true,
    );
  });

  it("rejects path escapes, absolute paths, and unmanaged files", () => {
    expect(isManagedAgentMarkdownFile({ agent, relativePath: "../AGENTS.md" })).toBe(false);
    expect(
      isManagedAgentMarkdownFile({ agent, relativePath: "/srv/openclaw/agents/reese/AGENTS.md" }),
    ).toBe(false);
    expect(isManagedAgentMarkdownFile({ agent, relativePath: "secrets.txt" })).toBe(false);
    expect(isManagedAgentMarkdownFile({ agent, relativePath: "config/token.md.bak" })).toBe(false);
  });

  it("builds a pending-review update plan instead of writing files directly", () => {
    const plan = buildManagedFileUpdatePlan({
      registry,
      principal: { agentId: "Artemis", teams: [], roles: ["manager"] },
      request: {
        targetAgentId: "reese",
        relativePath: "AGENTS.md",
        proposedContent: "# AGENTS.md\n",
        reason: "align team operating rules",
      },
      now: new Date("2026-09-11T00:00:00.000Z"),
    });

    expect(plan.status).toBe("pending_review");
    expect(plan.executionMode).toBe("dry_run");
    expect(plan.request.targetAgentId).toBe("reese");
    expect(plan.audit).toMatchObject({
      decision: "allow",
      action: "requestManagedFileUpdate",
      executionMode: "dry_run",
    });
  });

  it("plans managed file reads only for declared Markdown paths", () => {
    const plan = buildAgentControlOperationPlan({
      registry,
      principal: { agentId: "Artemis", teams: [], roles: ["manager"] },
      request: {
        action: "readManagedFile",
        targetAgentId: "reese",
        relativePath: "memory/today.md",
      },
      now: new Date("2026-09-11T00:00:00.000Z"),
    });

    expect(plan).toMatchObject({
      status: "planned",
      executionMode: "dry_run",
      action: "readManagedFile",
      workspace: { root: "/srv/openclaw/agents/reese" },
      relativePath: "memory/today.md",
      audit: { decision: "allow" },
    });
    expect(() =>
      buildAgentControlOperationPlan({
        registry,
        principal: { agentId: "Artemis", teams: [], roles: ["manager"] },
        request: { action: "readManagedFile", targetAgentId: "reese", relativePath: "secrets.md" },
      }),
    ).toThrow("unmanaged path");
  });

  it("runs shadow operations only after durable audit append succeeds", async () => {
    const auditEvents: unknown[] = [];
    const result = await runAgentControlShadowOperation({
      registry,
      principal: { agentId: "Artemis", teams: [], roles: ["manager"] },
      request: { action: "sendMessage", targetAgentId: "reese", message: "status?" },
      now: new Date("2026-09-12T00:00:00.000Z"),
      auditContext: {
        requestId: "shadow-001",
        sourceService: "agent-control-shadow-wrapper",
      },
      auditAppender: ({ audit }) => {
        auditEvents.push(audit);
      },
    });

    expect(result).toMatchObject({
      status: "shadow_allowed",
      executionMode: "dry_run",
      operation: {
        status: "planned",
        executionMode: "dry_run",
        action: "sendMessage",
        message: "status?",
      },
      audit: {
        decision: "allow",
        requestId: "shadow-001",
        sourceService: "agent-control-shadow-wrapper",
      },
      sideEffectCounters: {
        deliveryAttempts: 0,
        workspaceWrites: 0,
        serviceMutations: 0,
        secretReads: 0,
        cronMutations: 0,
        liveHandlerCalls: 0,
      },
    });
    expect(auditEvents).toHaveLength(1);
  });

  it("fails closed when shadow audit append fails", async () => {
    await expect(
      runAgentControlShadowOperation({
        registry,
        principal: { agentId: "Artemis", teams: [], roles: ["manager"] },
        request: { action: "readStatus", targetAgentId: "reese" },
        auditAppender: () => {
          throw new Error("audit sink unavailable");
        },
      }),
    ).rejects.toThrow("audit sink unavailable");
  });

  it("shadows managed-file updates as pending review only", async () => {
    const result = await runAgentControlShadowOperation({
      registry,
      principal: { agentId: "Artemis", teams: [], roles: ["manager"] },
      request: {
        action: "requestManagedFileUpdate",
        targetAgentId: "reese",
        relativePath: "AGENTS.md",
        proposedContent: "# AGENTS.md\n",
        reason: "align operating rules",
      },
      now: new Date("2026-09-12T00:00:00.000Z"),
      auditAppender: () => undefined,
    });

    expect(result).toMatchObject({
      status: "shadow_allowed",
      executionMode: "dry_run",
      managedFileUpdate: {
        status: "pending_review",
        executionMode: "dry_run",
        request: {
          targetAgentId: "reese",
          relativePath: "AGENTS.md",
        },
      },
      sideEffectCounters: {
        workspaceWrites: 0,
        liveHandlerCalls: 0,
      },
    });
  });

  it("records shadow denials without attempting side effects", async () => {
    const auditEvents: unknown[] = [];
    const result = await runAgentControlShadowOperation({
      registry,
      principal: { agentId: "Richard", teams: ["platform"], roles: ["manager"] },
      request: { action: "readManagedFile", targetAgentId: "reese", relativePath: "secrets.md" },
      now: new Date("2026-09-12T00:00:00.000Z"),
      auditAppender: ({ audit }) => {
        auditEvents.push(audit);
      },
    });

    expect(result).toMatchObject({
      status: "shadow_denied",
      executionMode: "dry_run",
      deniedReason: "principal_not_in_management_scope",
      audit: {
        decision: "deny",
        action: "readManagedFile",
      },
      sideEffectCounters: {
        deliveryAttempts: 0,
        workspaceWrites: 0,
        serviceMutations: 0,
        secretReads: 0,
        cronMutations: 0,
        liveHandlerCalls: 0,
      },
    });
    expect(auditEvents).toHaveLength(1);
  });

  it("keeps the shadow wrapper isolated from live mutation adapters", () => {
    const source = fs.readFileSync(moduleSourcePath, "utf8");
    const forbiddenLiveAdapters = [
      "node:child_process",
      "server-methods/agents",
      "server-methods",
      "agents.files.set",
      "dockerode",
      "Dockerode",
      "service update",
      "service restart",
      "delivery_queue",
      ["BWS", "ACCESS", "TOKEN"].join("_"),
      "secret create",
    ];

    for (const forbidden of forbiddenLiveAdapters) {
      expect(source).not.toContain(forbidden);
    }
  });

  it("records a shadow matrix summary without live side effects", async () => {
    const auditEvents: unknown[] = [];
    const result = await runAgentControlShadowMatrix({
      registry: fleetRegistry,
      now: new Date("2026-09-12T00:00:00.000Z"),
      auditAppender: ({ audit }) => {
        auditEvents.push(audit);
      },
      attempts: [
        {
          principal: { agentId: "Artemis", teams: [], roles: ["manager"] },
          request: { action: "readStatus", targetAgentId: "babbey" },
          auditContext: { requestId: "shadow-matrix-001" },
        },
        {
          principal: { agentId: "babbey", teams: [], roles: ["employee"] },
          request: { action: "sendMessage", targetAgentId: "Fiona", message: "need help" },
          auditContext: { requestId: "shadow-matrix-002" },
        },
        {
          principal: { agentId: "unknown-employee", teams: [], roles: ["employee"] },
          request: { action: "sendMessage", targetAgentId: "Fiona", message: "need help" },
          auditContext: { requestId: "shadow-matrix-003" },
        },
      ],
    });
    const evidence = buildAgentControlShadowEvidencePackage({
      matrix: result,
      generatedAt: new Date("2026-09-12T00:05:00.000Z"),
      evidenceId: " shadow-evidence-001 ",
      source: " unit test fixture ",
      approvalDocument: "docs/agents/agent-control-plane-shadow-mode-prod-test-approval.md",
      riskRegisterDocument: "docs/agents/agent-control-plane-prod-risk-register.md",
    });

    expect(result).toMatchObject({
      status: "shadow_matrix_recorded",
      executionMode: "dry_run",
      summary: {
        totalAttempts: 3,
        allowed: 2,
        denied: 1,
        byAction: {
          readStatus: { allowed: 1, denied: 0 },
          sendMessage: { allowed: 1, denied: 1 },
        },
        byReason: {
          principal_not_in_management_scope: 1,
        },
        sideEffectCounters: {
          deliveryAttempts: 0,
          workspaceWrites: 0,
          serviceMutations: 0,
          secretReads: 0,
          cronMutations: 0,
          liveHandlerCalls: 0,
        },
      },
    });
    expect(auditEvents).toHaveLength(3);
    expect(evidence).toMatchObject({
      version: 1,
      status: "shadow_evidence_ready",
      executionMode: "dry_run",
      generatedAt: "2026-09-12T00:05:00.000Z",
      evidenceId: "shadow-evidence-001",
      source: "unit test fixture",
      summary: {
        totalAttempts: 3,
        auditEvents: 3,
        requestIds: 3,
        missingRequestIds: 0,
      },
      nonInterruption: {
        liveSideEffectFree: true,
        sideEffectCounters: {
          deliveryAttempts: 0,
          workspaceWrites: 0,
          serviceMutations: 0,
          secretReads: 0,
          cronMutations: 0,
          liveHandlerCalls: 0,
        },
      },
      blockers: [],
    });
  });

  it("blocks shadow evidence when request ids are missing", async () => {
    const result = await runAgentControlShadowMatrix({
      registry: fleetRegistry,
      now: new Date("2026-09-12T00:00:00.000Z"),
      auditAppender: () => undefined,
      attempts: [
        {
          principal: { agentId: "Artemis", teams: [], roles: ["manager"] },
          request: { action: "readStatus", targetAgentId: "babbey" },
        },
      ],
    });
    const evidence = buildAgentControlShadowEvidencePackage({
      matrix: result,
      generatedAt: new Date("2026-09-12T00:05:00.000Z"),
    });

    expect(evidence).toMatchObject({
      status: "shadow_evidence_blocked",
      summary: {
        auditEvents: 1,
        requestIds: 0,
        missingRequestIds: 1,
      },
      blockers: ["one or more shadow attempts are missing request ids"],
    });
  });
});
