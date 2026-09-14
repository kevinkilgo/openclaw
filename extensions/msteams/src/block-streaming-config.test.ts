// Msteams tests cover block streaming config plugin behavior.
import { describe, expect, it } from "vitest";
import { MSTeamsConfigSchema } from "../config-api.js";

describe("MSTeamsConfigSchema block streaming", () => {
  const baseConfig = {
    enabled: true,
    dmPolicy: "open" as const,
    allowFrom: ["*"],
  };

  it("accepts nested streaming block config", () => {
    const result = MSTeamsConfigSchema.safeParse({
      ...baseConfig,
      streaming: {
        block: {
          enabled: true,
          coalesce: { minChars: 100, idleMs: 500 },
        },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.streaming?.block?.enabled).toBe(true);
      expect(result.data.streaming?.block?.coalesce).toEqual({ minChars: 100, idleMs: 500 });
    }
  });

  it("accepts config without streaming (optional)", () => {
    const result = MSTeamsConfigSchema.safeParse(baseConfig);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.streaming).toBeUndefined();
    }
  });

  it("rejects non-boolean streaming.block.enabled", () => {
    const result = MSTeamsConfigSchema.safeParse({
      ...baseConfig,
      streaming: { block: { enabled: "yes" } },
    });
    expect(result.success).toBe(false);
  });

  // Legacy flat keys are doctor-migrated (`openclaw doctor --fix`), not
  // schema-accepted; runtime consumes only the nested streaming shape.
  it.each(["blockStreaming", "chunkMode", "blockStreamingCoalesce"])(
    "rejects legacy flat %s",
    (key) => {
      const value =
        key === "blockStreaming" ? true : key === "chunkMode" ? "newline" : { minChars: 100 };
      const result = MSTeamsConfigSchema.safeParse({
        ...baseConfig,
        [key]: value,
      });
      expect(result.success).toBe(false);
    },
  );
});

describe("MSTeamsConfigSchema employee onboarding runtime config", () => {
  const baseConfig = {
    enabled: true,
    dmPolicy: "open" as const,
    allowFrom: ["*"],
  };

  it("accepts employee self-service onboarding config", () => {
    const result = MSTeamsConfigSchema.safeParse({
      ...baseConfig,
      employeeSelfServiceOnboarding: {
        enabled: true,
        acknowledgementText: "Onboarding request recorded.",
        failureAcknowledgementText: "Onboarding request could not be recorded.",
        postProvisionAuthPromptWaitMs: 0,
      },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.employeeSelfServiceOnboarding?.enabled).toBe(true);
      expect(result.data.employeeSelfServiceOnboarding?.postProvisionAuthPromptWaitMs).toBe(0);
    }
  });

  it("accepts employee container dispatch config", () => {
    const result = MSTeamsConfigSchema.safeParse({
      ...baseConfig,
      employeeContainerDispatch: {
        enabled: true,
        gatewayUrlTemplate: "ws://employee-agent-{agentId}:18789",
        tokenConfigPathTemplate: "/srv/openclaw/data/employee-agents/{agentId}/config.json",
        agentId: "main",
        waitTimeoutMs: 180_000,
      },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.employeeContainerDispatch?.enabled).toBe(true);
      expect(result.data.employeeContainerDispatch?.agentId).toBe("main");
    }
  });

  it("rejects unknown employee onboarding keys", () => {
    const result = MSTeamsConfigSchema.safeParse({
      ...baseConfig,
      employeeSelfServiceOnboarding: {
        enabled: true,
        unexpected: true,
      },
    });

    expect(result.success).toBe(false);
  });
});
