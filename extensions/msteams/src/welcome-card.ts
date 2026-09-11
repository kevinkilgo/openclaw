/**
 * Builds an Adaptive Card for welcoming users when the bot is added to a conversation.
 */

type WelcomeCardOptions = {
  /** Bot display name. Retained for API compatibility. */
  botName?: string;
  /** Custom prompt starters. Retained for API compatibility. */
  promptStarters?: string[];
};

/**
 * Build a welcome Adaptive Card for 1:1 personal chats.
 */
export function buildWelcomeCard(options?: WelcomeCardOptions): Record<string, unknown> {
  void options;

  return {
    type: "AdaptiveCard",
    version: "1.5",
    body: [
      {
        type: "TextBlock",
        text: "Hi! Im Your Fulcrum Agentic Assistant. Say Hi to get your personalized, private autonomous agent configured.",
        // Adaptive Card TextWeight/TextSize enums are PascalCase ("Bolder"/"Medium"); lowercase
        // values fall back to Default, so the greeting rendered unstyled (matches polls/presentation).
        weight: "Bolder",
        size: "Medium",
        wrap: true,
      },
    ],
    actions: [],
  };
}

/**
 * Build a brief welcome message for group chats (when the bot is @mentioned).
 */
export function buildGroupWelcomeText(botName?: string): string {
  const name = botName || "OpenClaw";
  return `Hi! I'm ${name}. Mention me with @${name} to get started.`;
}
