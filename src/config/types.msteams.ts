// Defines Microsoft Teams channel configuration types.
import type { ChannelPreviewStreamingConfig } from "./types.base.js";
import type {
  ChannelBotInteractionConfig,
  CommonChannelMessagingConfig,
} from "./types.channel-messaging-common.js";
import type { SecretInput } from "./types.secrets.js";
import type { GroupToolPolicyBySenderConfig, GroupToolPolicyConfig } from "./types.tools.js";

export type MSTeamsWebhookConfig = {
  /** Port for the webhook server. Default: 3978. */
  port?: number;
  /** Path for the messages endpoint. Default: /api/messages. */
  path?: string;
};

/** Teams SDK cloud environment. Public cloud is the default. */
export type MSTeamsCloudName = "Public" | "USGov" | "USGovDoD" | "China";

/**
 * Bot Framework OAuth SSO configuration for Microsoft Teams.
 *
 * When enabled, the plugin handles the `signin/tokenExchange` and
 * `signin/verifyState` invoke activities that Teams sends after an
 * `oauthCard` is presented to the user. The exchanged user token is
 * persisted via the Bot Framework User Token service so downstream
 * tools can call Microsoft Graph with delegated permissions.
 *
 * Prerequisites (Azure portal):
 * - The bot's Azure AD (Entra) app is configured with an exposed API
 *   scope (for example `access_as_user`) and lists the Teams client
 *   IDs in `knownClientApplications`.
 * - The Bot Framework channel registration has an OAuth Connection
 *   Setting whose name matches `connectionName` below, pointing at
 *   the same Azure AD app.
 */
export type MSTeamsSsoConfig = {
  /** If true, handle signin/tokenExchange + signin/verifyState invokes. Default: false. */
  enabled?: boolean;
  /**
   * Name of the OAuth connection configured on the Bot Framework channel
   * registration (Azure Bot resource). Required when `enabled` is true.
   */
  connectionName?: string;
};

export type MSTeamsEmployeeSelfServiceOnboardingConfig = {
  /** Enable capture of unassigned Teams DMs as pending employee onboarding requests. Default: false. */
  enabled?: boolean;
  /** Message sent after a pending onboarding request is recorded. */
  acknowledgementText?: string;
  /** Message sent when a pending onboarding request cannot be recorded. */
  failureAcknowledgementText?: string;
  /** Optional first-turn wait for provisioned employee route before sending Codex auth prompt. */
  postProvisionAuthPromptWaitMs?: number;
};

export type MSTeamsEmployeeContainerDispatchConfig = {
  /** Dispatch bound employee Teams turns to the employee container gateway. Default: false. */
  enabled?: boolean;
  /** Gateway URL template; use `{agentId}` for the route agent id. */
  gatewayUrlTemplate?: string;
  /** Employee config path template; use `{agentId}` for the route agent id. */
  tokenConfigPathTemplate?: string;
  /** Agent id inside the employee container. Default: main. */
  agentId?: string;
  /** Milliseconds to wait for employee container replies. */
  waitTimeoutMs?: number;
};

/** Reply style for MS Teams messages. */
export type MSTeamsReplyStyle = "thread" | "top-level";

/** Channel-level config for MS Teams. */
export type MSTeamsChannelConfig = {
  /** Require @mention to respond. Default: true. */
  requireMention?: boolean;
  /** Optional tool policy overrides for this channel. */
  tools?: GroupToolPolicyConfig;
  toolsBySender?: GroupToolPolicyBySenderConfig;
  /** Reply style: "thread" replies to the message, "top-level" posts a new message. */
  replyStyle?: MSTeamsReplyStyle;
};

/** Team-level config for MS Teams. */
export type MSTeamsTeamConfig = {
  /** Default requireMention for channels in this team. */
  requireMention?: boolean;
  /** Default tool policy for channels in this team. */
  tools?: GroupToolPolicyConfig;
  toolsBySender?: GroupToolPolicyBySenderConfig;
  /** Default reply style for channels in this team. */
  replyStyle?: MSTeamsReplyStyle;
  /** Per-channel overrides. Key is conversation ID (e.g., "19:...@thread.tacv2"). */
  channels?: Record<string, MSTeamsChannelConfig>;
};

export type MSTeamsConfig = Omit<
  CommonChannelMessagingConfig<string[], string, string, ChannelPreviewStreamingConfig>,
  "mentionPatterns" | "name" | "replyToMode"
> &
  Pick<ChannelBotInteractionConfig<boolean>, "dangerouslyAllowNameMatching"> & {
    /** Azure Bot App ID (from Azure Bot registration). */
    appId?: string;
    /** Azure Bot App Password / Client Secret. */
    appPassword?: SecretInput;
    /** Azure AD Tenant ID (for single-tenant bots). */
    tenantId?: string;
    /** Teams SDK cloud environment. Default: Public. */
    cloud?: MSTeamsCloudName;
    /**
     * Bot Connector service URL used by SDK proactive sends/edits/deletes.
     * Set with `cloud` for USGov/DoD SDK clouds; set alone for GCC.
     */
    serviceUrl?: string;
    /**
     * Authentication type.
     * - `"secret"` (default): uses `appPassword` (client secret).
     * - `"federated"`: uses workload identity / managed identity / certificate.
     */
    authType?: "secret" | "federated";
    /** Path to a PEM certificate file for certificate-based auth. Used when `authType` is `"federated"`. */
    certificatePath?: string;
    /** Certificate thumbprint (hex SHA-1) for certificate-based auth. */
    certificateThumbprint?: string;
    /** If `true`, use Azure Managed Identity (system- or user-assigned) instead of a certificate. */
    useManagedIdentity?: boolean;
    /** User-assigned managed-identity client ID. When omitted with `useManagedIdentity: true`, system-assigned identity is used. */
    managedIdentityClientId?: string;
    /** Webhook server configuration. */
    webhook?: MSTeamsWebhookConfig;
    /** Send native Teams typing indicator before replies. Default: true for groups/channels; DMs use informative stream status. */
    typingIndicator?: boolean;
    /**
     * Allowed host suffixes for inbound attachment downloads.
     * Use ["*"] to allow any host (not recommended).
     */
    mediaAllowHosts?: Array<string>;
    /**
     * Allowed host suffixes for attaching Authorization headers to inbound media retries.
     * Use specific hosts only; avoid multi-tenant suffixes.
     */
    mediaAuthAllowHosts?: Array<string>;
    /**
     * Query Graph for channel/group media when Bot Framework HTML omits file markers.
     * Requires the documented Graph permissions and adds one message lookup per
     * otherwise unresolved HTML activity. Default: false.
     */
    graphMediaFallback?: boolean;
    /** Default: require @mention to respond in channels/groups. */
    requireMention?: boolean;
    /** Default reply style: "thread" replies to the message, "top-level" posts a new message. */
    replyStyle?: MSTeamsReplyStyle;
    /** Per-team config. Key is team ID (from the /team/ URL path segment). */
    teams?: Record<string, MSTeamsTeamConfig>;
    /** SharePoint site ID for file uploads in group chats/channels (e.g., "contoso.sharepoint.com,guid1,guid2"). */
    sharePointSiteId?: string;
    /** Show a welcome Adaptive Card when the bot is added to a 1:1 chat. Default: true. */
    welcomeCard?: boolean;
    /** Custom prompt starter labels shown on the welcome card. */
    promptStarters?: string[];
    /** Show a welcome message when the bot is added to a group chat. Default: false. */
    groupWelcomeCard?: boolean;
    /** Enable the Teams feedback loop (thumbs up/down) on AI-generated messages. Default: true. */
    feedbackEnabled?: boolean;
    /** Enable background reflection when a user gives negative feedback. Default: true. */
    feedbackReflection?: boolean;
    /** Minimum interval (ms) between reflections per session. Default: 300000 (5 min). */
    feedbackReflectionCooldownMs?: number;
    /** Self-service capture of unassigned Teams DMs as employee onboarding requests. */
    employeeSelfServiceOnboarding?: MSTeamsEmployeeSelfServiceOnboardingConfig;
    /** Optional dispatch of bound employee Teams turns through employee container gateways. */
    employeeContainerDispatch?: MSTeamsEmployeeContainerDispatchConfig;
    /** Delegated auth settings for user-scoped Graph API actions (e.g., reactions). */
    delegatedAuth?: {
      /** Enable delegated auth (user sign-in for Graph actions that need user scope). */
      enabled?: boolean;
      /** Additional scopes to request during OAuth consent. */
      scopes?: string[];
    };
    /** Bot Framework OAuth SSO (signin/tokenExchange + signin/verifyState) settings. */
    sso?: MSTeamsSsoConfig;
  };
