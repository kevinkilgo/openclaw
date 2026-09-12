import { describe, expect, it } from "vitest";
import {
  authorizeAgentControlAction,
  buildManagedFileUpdatePlan,
  isManagedAgentMarkdownFile,
  listManageableAgents,
  loadAgentControlRegistryFile,
  normalizeAgentControlRegistry,
  parseAgentControlRegistryJson,
  resolveAgentControlTarget,
  type AgentControlRegistry,
} from "./agent-control.js";

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
    expect(plan.request.targetAgentId).toBe("reese");
    expect(plan.audit).toMatchObject({
      decision: "allow",
      action: "requestManagedFileUpdate",
    });
  });
});
