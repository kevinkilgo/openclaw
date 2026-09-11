// Msteams tests cover welcome card plugin behavior.
import { describe, expect, it } from "vitest";
import { buildMSTeamsPresentationCard } from "./presentation.js";
import { buildGroupWelcomeText, buildWelcomeCard } from "./welcome-card.js";

describe("buildMSTeamsPresentationCard", () => {
  it("preserves message text when rendering presentation controls", () => {
    expect(
      buildMSTeamsPresentationCard({
        text: "Deploy finished",
        presentation: {
          blocks: [
            {
              type: "buttons",
              buttons: [{ label: "Open", value: "open" }],
            },
          ],
        },
      }),
    ).toEqual({
      type: "AdaptiveCard",
      version: "1.4",
      body: [{ type: "TextBlock", text: "Deploy finished", wrap: true }],
      actions: [{ type: "Action.Submit", title: "Open", data: { value: "open", label: "Open" } }],
    });
  });

  it("submits command actions as command text", () => {
    expect(
      buildMSTeamsPresentationCard({
        presentation: {
          blocks: [
            {
              type: "buttons",
              buttons: [
                {
                  label: "Plugins",
                  action: { type: "command", command: "/codex plugins menu" },
                },
              ],
            },
          ],
        },
      }),
    ).toMatchObject({
      actions: [{ type: "Action.Submit", title: "Plugins", data: "/codex plugins menu" }],
    });
  });

  it("keeps unavailable select commands visible in the Adaptive Card", () => {
    expect(
      buildMSTeamsPresentationCard({
        presentation: {
          blocks: [
            {
              type: "select",
              placeholder: "Environment",
              options: [
                { label: "Production", action: { type: "command", command: "/deploy production" } },
                { label: "Opaque", action: { type: "callback", value: "private-callback-token" } },
              ],
            },
          ],
        },
      }),
    ).toMatchObject({
      body: [
        {
          type: "TextBlock",
          text: "Environment:\n- Production: `/deploy production`\n- Opaque",
        },
      ],
    });
  });

  it("renders web app button links as open-url actions", () => {
    expect(
      buildMSTeamsPresentationCard({
        presentation: {
          blocks: [
            {
              type: "buttons",
              buttons: [
                { label: "Open app", webApp: { url: "https://example.com/app" } },
                { label: "Legacy app", web_app: { url: "https://example.com/legacy" } },
              ],
            },
          ],
        },
      }),
    ).toMatchObject({
      actions: [
        { type: "Action.OpenUrl", title: "Open app", url: "https://example.com/app" },
        { type: "Action.OpenUrl", title: "Legacy app", url: "https://example.com/legacy" },
      ],
    });
  });
});

describe("buildWelcomeCard", () => {
  it("builds the Fulcrum onboarding welcome card", () => {
    const card = buildWelcomeCard();
    expect(card.type).toBe("AdaptiveCard");
    expect(card.version).toBe("1.5");

    const body = card.body as Array<{ text: string }>;
    expect(body).toHaveLength(1);
    expect(body[0]?.text).toBe(
      "Hi! Im Your Fulcrum Agentic Assistant. Say Hi to get your personalized, private autonomous agent configured.",
    );

    const actions = card.actions as Array<{ title: string; data: unknown }>;
    expect(actions).toEqual([]);
  });

  it("styles the heading with valid PascalCase Adaptive Card enum values", () => {
    // Lowercase weight/size fall back to Default in the Teams renderer, so the heading must use the
    // schema's PascalCase enums to render bold/medium.
    const card = buildWelcomeCard();
    const heading = (card.body as Array<{ weight?: string; size?: string }>)[0];
    expect(heading?.weight).toBe("Bolder");
    expect(heading?.size).toBe("Medium");
  });

  it("ignores custom bot name", () => {
    const card = buildWelcomeCard({ botName: "TestBot" });
    const body = card.body as Array<{ text: string }>;
    expect(body[0]?.text).not.toContain("TestBot");
  });

  it("ignores custom prompt starters", () => {
    const card = buildWelcomeCard({
      promptStarters: ["Do X", "Do Y"],
    });
    const actions = card.actions as Array<{ title: string; data: unknown }>;
    expect(actions).toEqual([]);
  });

  it("keeps actions empty when promptStarters is empty", () => {
    const card = buildWelcomeCard({ promptStarters: [] });
    const actions = card.actions as Array<{ title: string }>;
    expect(actions).toEqual([]);
  });
});

describe("buildGroupWelcomeText", () => {
  it("includes bot name", () => {
    const text = buildGroupWelcomeText("MyBot");
    expect(text).toContain("MyBot");
    expect(text).toContain("@MyBot");
  });

  it("defaults to OpenClaw", () => {
    const text = buildGroupWelcomeText();
    expect(text).toContain("OpenClaw");
  });
});
