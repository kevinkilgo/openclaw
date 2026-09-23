// Msteams tests cover employee-container dispatch behavior.
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { OpenClawConfig, RuntimeEnv } from "../runtime-api.js";
import {
  createMSTeamsMessageHandlerDeps,
  installMSTeamsTestRuntime,
} from "./monitor-handler.test-helpers.js";
import { startEmployeeCodexDeviceLogin } from "./monitor-handler/inbound-dispatch.js";
import { createMSTeamsMessageHandler } from "./monitor-handler/message-handler.js";
import type { MSTeamsTurnContext } from "./sdk-types.js";

const gatewayRuntimeMockState = vi.hoisted(() => ({
  callGatewayFromCli: vi.fn(),
}));

const loginRuntimeMockState = vi.hoisted(() => ({
  runDeviceLoginFlow: vi.fn(),
}));

const authProfilesMockState = vi.hoisted(() => ({
  setAuthProfileOrder: vi.fn(),
}));

const fsMockState = vi.hoisted(() => ({
  readFile: vi.fn(),
}));

const replyDispatcherMockState = vi.hoisted(() => ({
  deliver: vi.fn(),
  settle: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  readFile: fsMockState.readFile,
}));

vi.mock("openclaw/plugin-sdk/gateway-runtime", () => ({
  callGatewayFromCli: gatewayRuntimeMockState.callGatewayFromCli,
}));

vi.mock("openclaw/plugin-sdk/provider-auth-login-flow-runtime", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("openclaw/plugin-sdk/provider-auth-login-flow-runtime")
  >()),
  runProviderChannelLoginFlow: loginRuntimeMockState.runDeviceLoginFlow,
}));

vi.mock("openclaw/plugin-sdk/provider-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("openclaw/plugin-sdk/provider-auth")>()),
  setAuthProfileOrder: authProfilesMockState.setAuthProfileOrder,
}));

vi.mock("./reply-dispatcher.js", () => ({
  createMSTeamsReplyDispatcher: () => ({
    dispatcherOptions: {
      onSettled: replyDispatcherMockState.settle,
    },
    delivery: {
      deliver: replyDispatcherMockState.deliver,
    },
    replyOptions: {},
  }),
}));

function createContext(): MSTeamsTurnContext {
  return {
    activity: {
      id: "teams-message-1",
      type: "message",
      text: "Hello from Teams",
      channelId: "msteams",
      serviceUrl: "https://service.example.test",
      from: {
        id: "bf-user-id",
        aadObjectId: "user-aad",
        name: "Kevin User",
      },
      recipient: {
        id: "bot-id",
        name: "OpenClaw",
      },
      conversation: {
        id: "19:personal-chat",
        conversationType: "personal",
      },
      channelData: {},
      attachments: [],
    },
    sendActivity: vi.fn(async () => ({ id: "activity-id" })),
    sendActivities: async () => [],
  } as unknown as MSTeamsTurnContext;
}

function createConfig(): OpenClawConfig {
  return {
    channels: {
      msteams: {
        dmPolicy: "allowlist",
        allowFrom: ["user-aad"],
        employeeContainerDispatch: {
          enabled: true,
          gatewayUrlTemplate: "ws://employee-agent-{agentId}:18789",
          tokenConfigPathTemplate:
            "/srv/openclaw/data/employee-agents/{agentId}/config/openclaw.json",
          waitTimeoutMs: 5000,
        },
      },
    },
  } as OpenClawConfig;
}

function createDefaultWaitConfig(): OpenClawConfig {
  const cfg = createConfig();
  delete cfg.channels?.msteams?.employeeContainerDispatch?.waitTimeoutMs;
  return cfg;
}

function createLongWaitConfig(): OpenClawConfig {
  const cfg = createConfig();
  cfg.channels!.msteams!.employeeContainerDispatch!.waitTimeoutMs = 600_000;
  return cfg;
}

describe("msteams employee container dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsMockState.readFile.mockResolvedValue(
      JSON.stringify({
        gateway: { auth: { token: "test-token" } },
        agents: { entries: { main: { name: "Kevin User" } } },
        plugins: {
          entries: { openai: { enabled: true }, codex: { enabled: true } },
        },
      }),
    );
    loginRuntimeMockState.runDeviceLoginFlow.mockImplementation(async (opts) => {
      await opts.sendMessage("Open https://auth.openai.com/device and enter code ABCD-EFGH.");
      return {
        providerId: "openai",
        methodId: "device-code",
        profiles: [{ profileId: "openai:test", provider: "openai", mode: "oauth" }],
      };
    });
    authProfilesMockState.setAuthProfileOrder.mockResolvedValue({
      order: { openai: ["openai:test"] },
    });
    gatewayRuntimeMockState.callGatewayFromCli
      .mockResolvedValueOnce({ runId: "run-1" })
      .mockResolvedValueOnce({
        status: "ok",
        terminalReply: { text: "Reply from employee main" },
      });
    replyDispatcherMockState.deliver.mockResolvedValue({
      finalization: Promise.resolve(),
    });
    replyDispatcherMockState.settle.mockResolvedValue(undefined);
    installMSTeamsTestRuntime({
      resolveAgentRoute: () => ({
        agentId: "kkilgo",
        accountId: "default",
        sessionKey: "agent:kkilgo:msteams:direct:user-aad",
      }),
    });
  });

  it("runs a bound direct Teams turn in the employee container main agent", async () => {
    const cfg = createConfig();
    const runtime = { error: vi.fn() } as unknown as RuntimeEnv;
    const handler = createMSTeamsMessageHandler(createMSTeamsMessageHandlerDeps({ cfg, runtime }));

    await handler(createContext());
    expect(fsMockState.readFile).toHaveBeenCalledWith(
      "/srv/openclaw/data/employee-agents/kkilgo/config/openclaw.json",
      "utf8",
    );
    expect(gatewayRuntimeMockState.callGatewayFromCli).toHaveBeenNthCalledWith(
      1,
      "agent",
      {
        url: "ws://employee-agent-kkilgo:18789",
        token: "test-token",
        timeout: "5000",
      },
      expect.objectContaining({
        agentId: "main",
        sessionKey: "agent:main:msteams:direct:user-aad",
        message: expect.stringContaining("Hello from Teams"),
        idempotencyKey: "msteams-employee-container:kkilgo:teams-message-1",
        timeout: 5,
        deliver: false,
        sourceReplyDeliveryMode: "automatic",
      }),
      { clientName: "gateway-client", mode: "backend", scopes: ["operator.write"] },
    );
    expect(gatewayRuntimeMockState.callGatewayFromCli).toHaveBeenNthCalledWith(
      2,
      "agent.wait",
      {
        url: "ws://employee-agent-kkilgo:18789",
        token: "test-token",
        timeout: "15000",
      },
      { runId: "run-1", timeoutMs: 5000 },
      { clientName: "gateway-client", mode: "backend", scopes: ["operator.write"] },
    );
    expect(replyDispatcherMockState.deliver).toHaveBeenCalledWith(
      { text: "Reply from employee main" },
      expect.objectContaining({ kind: "final", stage: "final" }),
    );
    expect(replyDispatcherMockState.settle).toHaveBeenCalledTimes(1);
  });

  it("starts a Teams typing indicator while the employee container handles the turn", async () => {
    const cfg = createConfig();
    const runtime = { error: vi.fn() } as unknown as RuntimeEnv;
    const handler = createMSTeamsMessageHandler(createMSTeamsMessageHandlerDeps({ cfg, runtime }));
    const context = createContext();

    await handler(context);
    await Promise.resolve();

    expect(context.sendActivity).toHaveBeenCalledWith({ type: "typing" });
  });

  it("respects the Teams typingIndicator=false switch for employee container turns", async () => {
    const cfg = createConfig();
    cfg.channels!.msteams!.typingIndicator = false;
    const runtime = { error: vi.fn() } as unknown as RuntimeEnv;
    const handler = createMSTeamsMessageHandler(createMSTeamsMessageHandlerDeps({ cfg, runtime }));
    const context = createContext();

    await handler(context);
    await Promise.resolve();

    expect(context.sendActivity).not.toHaveBeenCalledWith({ type: "typing" });
  });

  it("delivers long-running employee turns without an accepted progress warning", async () => {
    const cfg = createLongWaitConfig();
    const runtime = { error: vi.fn() } as unknown as RuntimeEnv;
    const handler = createMSTeamsMessageHandler(createMSTeamsMessageHandlerDeps({ cfg, runtime }));

    await handler(createContext());

    expect(replyDispatcherMockState.deliver).toHaveBeenCalledWith(
      { text: "Reply from employee main" },
      expect.objectContaining({ kind: "final", stage: "final" }),
    );
    expect(replyDispatcherMockState.deliver).toHaveBeenCalledTimes(1);
    expect(replyDispatcherMockState.settle).toHaveBeenCalledTimes(1);
  });

  it("defaults Teams employee dispatch waits to the simple-turn SLA", async () => {
    const cfg = createDefaultWaitConfig();
    const runtime = { error: vi.fn() } as unknown as RuntimeEnv;
    const deps = createMSTeamsMessageHandlerDeps({ cfg, runtime });
    const handler = createMSTeamsMessageHandler(deps);

    await handler(createContext());

    expect(gatewayRuntimeMockState.callGatewayFromCli).toHaveBeenNthCalledWith(
      1,
      "agent",
      {
        url: "ws://employee-agent-kkilgo:18789",
        token: "test-token",
        timeout: "60000",
      },
      expect.objectContaining({
        timeout: 60,
      }),
      { clientName: "gateway-client", mode: "backend", scopes: ["operator.write"] },
    );
    expect(gatewayRuntimeMockState.callGatewayFromCli).toHaveBeenNthCalledWith(
      2,
      "agent.wait",
      {
        url: "ws://employee-agent-kkilgo:18789",
        token: "test-token",
        timeout: "70000",
      },
      { runId: "run-1", timeoutMs: 60000 },
      { clientName: "gateway-client", mode: "backend", scopes: ["operator.write"] },
    );
    expect(deps.log.info).toHaveBeenCalledWith(
      "msteams employee comms e2e trace",
      expect.objectContaining({
        routeAgentId: "kkilgo",
        employeeRunId: "run-1",
        finalStatus: "completed",
      }),
    );
  });

  it("classifies slow optional connector startup as a bounded employee comms timeout", async () => {
    gatewayRuntimeMockState.callGatewayFromCli.mockReset();
    gatewayRuntimeMockState.callGatewayFromCli
      .mockResolvedValueOnce({ runId: "run-slow-connectors" })
      .mockResolvedValueOnce({
        status: "timeout",
        error: "MCP connector server startup timed out",
      });
    const cfg = createDefaultWaitConfig();
    const runtime = { error: vi.fn() } as unknown as RuntimeEnv;
    const deps = createMSTeamsMessageHandlerDeps({ cfg, runtime });
    const handler = createMSTeamsMessageHandler(deps);

    await expect(handler(createContext())).rejects.toThrow(
      "employee comms connector/tool startup timeout after 60000ms",
    );

    expect(gatewayRuntimeMockState.callGatewayFromCli).toHaveBeenNthCalledWith(
      2,
      "agent.wait",
      expect.objectContaining({ timeout: "70000" }),
      { runId: "run-slow-connectors", timeoutMs: 60000 },
      { clientName: "gateway-client", mode: "backend", scopes: ["operator.write"] },
    );
    expect(deps.log.info).toHaveBeenCalledWith(
      "msteams employee comms e2e trace",
      expect.objectContaining({
        routeAgentId: "kkilgo",
        employeeRunId: "run-slow-connectors",
        finalStatus: "failed",
        failureClassification: "connector-tool-startup-timeout",
      }),
    );
    expect(runtime.error).toHaveBeenCalledWith(
      expect.stringContaining("connector/tool startup timeout after 60000ms"),
    );
    expect(replyDispatcherMockState.deliver).toHaveBeenCalledWith(
      {
        text: expect.stringContaining("I hit an issue before I could finish that request"),
      },
      expect.objectContaining({ kind: "progress", stage: "failed" }),
    );
    expect(replyDispatcherMockState.settle).toHaveBeenCalledTimes(1);
  });

  it("treats employee Salesforce disabled replies as connector readiness failures", async () => {
    gatewayRuntimeMockState.callGatewayFromCli.mockReset();
    gatewayRuntimeMockState.callGatewayFromCli
      .mockResolvedValueOnce({ runId: "run-salesforce-disabled" })
      .mockResolvedValueOnce({
        status: "ok",
        terminalReply: {
          text: "Salesforce is disabled by admin / not available. Ask an admin to enable it.",
        },
      });
    const cfg = createDefaultWaitConfig();
    const runtime = { error: vi.fn() } as unknown as RuntimeEnv;
    const deps = createMSTeamsMessageHandlerDeps({ cfg, runtime });
    const handler = createMSTeamsMessageHandler(deps);

    await expect(handler(createContext())).rejects.toThrow(
      "employee connector readiness failure routeAgentId=kkilgo",
    );

    expect(replyDispatcherMockState.deliver).not.toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("Salesforce is disabled by admin"),
      }),
      expect.anything(),
    );
    expect(deps.log.info).toHaveBeenCalledWith(
      "msteams employee comms e2e trace",
      expect.objectContaining({
        routeAgentId: "kkilgo",
        employeeRunId: "run-salesforce-disabled",
        finalStatus: "failed",
        failureClassification: "connector-readiness-failure",
      }),
    );
    expect(runtime.error).toHaveBeenCalledWith(
      expect.stringContaining("employee connector readiness failure"),
    );
  });

  it("starts Codex device-code login when the employee container lacks OpenAI auth", async () => {
    gatewayRuntimeMockState.callGatewayFromCli.mockReset();
    gatewayRuntimeMockState.callGatewayFromCli
      .mockResolvedValueOnce({ runId: "run-unauthenticated" })
      .mockRejectedValueOnce(
        new Error(
          "unexpected status 401 Unauthorized: Missing bearer or basic authentication in header",
        ),
      );
    const cfg = createConfig();
    const runtime = { error: vi.fn() } as unknown as RuntimeEnv;
    const handler = createMSTeamsMessageHandler(createMSTeamsMessageHandlerDeps({ cfg, runtime }));

    await handler(createContext());

    expect(loginRuntimeMockState.runDeviceLoginFlow).toHaveBeenCalledWith(
      expect.objectContaining({
        choice: expect.objectContaining({
          pluginId: "openai",
          providerId: "openai",
          methodId: "device-code",
        }),
        agentId: "main",
        config: expect.objectContaining({
          agents: expect.objectContaining({
            entries: expect.objectContaining({
              main: expect.objectContaining({
                agentDir:
                  "/srv/openclaw/data/employee-agents/kkilgo/state/.openclaw/agents/main/agent",
              }),
            }),
          }),
        }),
      }),
    );
    expect(authProfilesMockState.setAuthProfileOrder).toHaveBeenCalledWith({
      agentDir: "/srv/openclaw/data/employee-agents/kkilgo/state/.openclaw/agents/main/agent",
      provider: "openai",
      order: ["openai:test"],
    });
    expect(replyDispatcherMockState.deliver).toHaveBeenCalledWith(
      { text: "Open https://auth.openai.com/device and enter code ABCD-EFGH." },
      expect.objectContaining({ kind: "final", stage: "final" }),
    );
    expect(runtime.error).not.toHaveBeenCalled();
  });

  it("retries a Teams employee dispatch when session start admission races", async () => {
    gatewayRuntimeMockState.callGatewayFromCli.mockReset();
    gatewayRuntimeMockState.callGatewayFromCli
      .mockRejectedValueOnce(
        new Error(
          'Session "agent:main:msteams:direct:user-aad" changed while starting work. Retry.',
        ),
      )
      .mockResolvedValueOnce({ runId: "run-2" })
      .mockResolvedValueOnce({
        status: "ok",
        terminalReply: { text: "Recovered reply" },
      });
    const cfg = createConfig();
    const runtime = { error: vi.fn() } as unknown as RuntimeEnv;
    const handler = createMSTeamsMessageHandler(createMSTeamsMessageHandlerDeps({ cfg, runtime }));

    await handler(createContext());

    expect(gatewayRuntimeMockState.callGatewayFromCli).toHaveBeenCalledTimes(3);
    expect(gatewayRuntimeMockState.callGatewayFromCli).toHaveBeenNthCalledWith(
      2,
      "agent",
      expect.objectContaining({
        url: "ws://employee-agent-kkilgo:18789",
        token: "test-token",
      }),
      expect.objectContaining({
        agentId: "main",
        sessionKey: "agent:main:msteams:direct:user-aad",
      }),
      { clientName: "gateway-client", mode: "backend", scopes: ["operator.write"] },
    );
    expect(replyDispatcherMockState.deliver).toHaveBeenCalledWith(
      { text: "Recovered reply" },
      expect.objectContaining({ kind: "final", stage: "final" }),
    );
    expect(runtime.error).not.toHaveBeenCalled();
  });

  it("starts Codex device-code login when agent.wait returns an OpenAI auth error status", async () => {
    gatewayRuntimeMockState.callGatewayFromCli.mockReset();
    gatewayRuntimeMockState.callGatewayFromCli
      .mockResolvedValueOnce({ runId: "run-unauthenticated" })
      .mockResolvedValueOnce({
        status: "error",
        error:
          "unexpected status 401 Unauthorized: Missing bearer or basic authentication in header",
      });
    const cfg = createConfig();
    const runtime = { error: vi.fn() } as unknown as RuntimeEnv;
    const handler = createMSTeamsMessageHandler(createMSTeamsMessageHandlerDeps({ cfg, runtime }));

    await handler(createContext());

    expect(loginRuntimeMockState.runDeviceLoginFlow).toHaveBeenCalledWith(
      expect.objectContaining({
        choice: expect.objectContaining({
          pluginId: "openai",
          providerId: "openai",
          methodId: "device-code",
        }),
        agentId: "main",
      }),
    );
    expect(authProfilesMockState.setAuthProfileOrder).toHaveBeenCalledWith({
      agentDir: "/srv/openclaw/data/employee-agents/kkilgo/state/.openclaw/agents/main/agent",
      provider: "openai",
      order: ["openai:test"],
    });
    expect(replyDispatcherMockState.deliver).toHaveBeenCalledWith(
      { text: "Open https://auth.openai.com/device and enter code ABCD-EFGH." },
      expect.objectContaining({ kind: "final", stage: "final" }),
    );
    expect(runtime.error).not.toHaveBeenCalled();
  });

  it("settles OpenAI subscription cooldown without starting repeated Teams recovery chatter", async () => {
    gatewayRuntimeMockState.callGatewayFromCli.mockReset();
    gatewayRuntimeMockState.callGatewayFromCli
      .mockResolvedValueOnce({ runId: "run-cooldown" })
      .mockResolvedValueOnce({
        status: "error",
        error:
          "You've reached your Codex subscription usage limit. Next reset in 2 days, Sep 19 at 8:10 AM UTC. Wait until the reset time, use another Codex account if available, or switch to another configured model/provider.",
      })
      .mockResolvedValueOnce({ runId: "run-cooldown-redrive" })
      .mockResolvedValueOnce({
        status: "error",
        error:
          "You've reached your Codex subscription usage limit. Next reset in 2 days, Sep 19 at 8:10 AM UTC. Wait until the reset time, use another Codex account if available, or switch to another configured model/provider.",
      });
    const cfg = createLongWaitConfig();
    const runtime = { error: vi.fn() } as unknown as RuntimeEnv;
    const handler = createMSTeamsMessageHandler(createMSTeamsMessageHandlerDeps({ cfg, runtime }));

    await handler(createContext());
    await handler(createContext());

    expect(loginRuntimeMockState.runDeviceLoginFlow).not.toHaveBeenCalled();
    expect(replyDispatcherMockState.deliver).toHaveBeenNthCalledWith(
      1,
      {
        text: expect.stringContaining("kkilgo test lane is temporarily unavailable"),
      },
      expect.objectContaining({ kind: "progress", stage: "failed" }),
    );
    expect(replyDispatcherMockState.deliver).not.toHaveBeenCalledWith(
      {
        text: expect.stringContaining("I hit an issue before I could finish that request"),
      },
      expect.anything(),
    );
    expect(replyDispatcherMockState.deliver).toHaveBeenCalledTimes(1);
    expect(runtime.error).toHaveBeenCalledWith(expect.stringContaining("subscription usage limit"));
  });

  it("does not start Codex device-code login when the employee gateway rejects device pairing", async () => {
    gatewayRuntimeMockState.callGatewayFromCli.mockReset();
    gatewayRuntimeMockState.callGatewayFromCli.mockRejectedValueOnce(
      new Error("device pairing required (requestId: 608add51-977d-4413-9b73-d9a0a5ed0894)"),
    );
    const cfg = createConfig();
    const runtime = { error: vi.fn() } as unknown as RuntimeEnv;
    const handler = createMSTeamsMessageHandler(createMSTeamsMessageHandlerDeps({ cfg, runtime }));

    await expect(handler(createContext())).rejects.toThrow("device pairing required");

    expect(loginRuntimeMockState.runDeviceLoginFlow).not.toHaveBeenCalled();
    expect(replyDispatcherMockState.deliver).not.toHaveBeenCalledWith(
      { text: "Open https://auth.openai.com/device and enter code ABCD-EFGH." },
      expect.objectContaining({ kind: "final", stage: "final" }),
    );
    expect(runtime.error).toHaveBeenCalledWith(
      expect.stringContaining("msteams employee container dispatch failed"),
    );
    expect(runtime.error).toHaveBeenCalledWith(expect.stringContaining("routeAgentId=kkilgo"));
    expect(runtime.error).toHaveBeenCalledWith(
      expect.stringContaining("employeeSessionKey=agent:main:msteams:direct:user-aad"),
    );
  });

  it("expires an active employee OpenAI device-code login and allows a fresh retry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-14T00:00:00Z"));
    const sentMessages: string[] = [];
    const cfg = createConfig();
    const runtime = { error: vi.fn() } as unknown as RuntimeEnv;
    try {
      loginRuntimeMockState.runDeviceLoginFlow
        .mockImplementationOnce(async (opts) => {
          await opts.sendDeviceCode?.({
            title: "Sign in with OpenAI",
            code: "CODE-1",
            expiresInMinutes: 15,
          });
          await new Promise((_resolve, reject) => {
            opts.signal?.addEventListener(
              "abort",
              () => {
                reject(new Error("OpenAI device-code sign-in expired"));
              },
              { once: true },
            );
          });
          throw new Error("unreachable");
        })
        .mockImplementationOnce(async (opts) => {
          await opts.sendDeviceCode?.({
            title: "Sign in with OpenAI",
            code: "CODE-2",
            expiresInMinutes: 15,
          });
          return {
            providerId: "openai",
            methodId: "device-code",
            authRefresh: "refreshed",
            profiles: [{ profileId: "openai:test", provider: "openai", mode: "oauth" }],
          };
        });

      const first = startEmployeeCodexDeviceLogin({
        cfg,
        runtime,
        routeAgentId: "kkilgo",
        sendText: async (message) => {
          sentMessages.push(message);
        },
        log: createMSTeamsMessageHandlerDeps({ cfg, runtime }).log,
      });
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();

      await expect(
        startEmployeeCodexDeviceLogin({
          cfg,
          runtime,
          routeAgentId: "kkilgo",
          sendText: async (message) => {
            sentMessages.push(message);
          },
          log: createMSTeamsMessageHandlerDeps({ cfg, runtime }).log,
        }),
      ).resolves.toEqual({ kind: "completed", finalResponses: 1 });

      vi.setSystemTime(new Date("2026-09-14T00:15:01Z"));
      const third = startEmployeeCodexDeviceLogin({
        cfg,
        runtime,
        routeAgentId: "kkilgo",
        sendText: async (message) => {
          sentMessages.push(message);
        },
        log: createMSTeamsMessageHandlerDeps({ cfg, runtime }).log,
      });
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();

      expect(loginRuntimeMockState.runDeviceLoginFlow).toHaveBeenCalledTimes(2);
      await expect(first).resolves.toEqual({ kind: "completed", finalResponses: 2 });
      await expect(third).resolves.toEqual({ kind: "completed", finalResponses: 2 });

      expect(sentMessages).toEqual([
        expect.stringContaining("CODE-1"),
        expect.stringContaining("already active"),
        "OpenAI sign-in code expired. Send another message when you are ready and I will generate a fresh sign-in code.",
        expect.stringContaining("CODE-2"),
        expect.stringContaining("Codex login complete"),
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});
