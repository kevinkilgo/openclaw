// Msteams plugin module implements graph behavior.
import { readFile, writeFile } from "node:fs/promises";
import { responseWithRelease } from "openclaw/plugin-sdk/fetch-runtime";
import { isFutureDateTimestampMs } from "openclaw/plugin-sdk/number-runtime";
import { readProviderJsonResponse } from "openclaw/plugin-sdk/provider-http";
import { fetchWithSsrFGuard, type MSTeamsConfig } from "../runtime-api.js";
import { GRAPH_ROOT } from "./attachments/shared.js";
import { resolveMSTeamsSdkCloudOptions } from "./cloud.js";
import { createMSTeamsHttpError } from "./http-error.js";
import { refreshMSTeamsDelegatedTokens } from "./oauth.token.js";
import {
  MSTEAMS_REQUEST_TIMEOUT_MS,
  resolveMSTeamsRequestTimeoutMs,
  type MSTeamsRequestDeadline,
  withMSTeamsRequestDeadline,
} from "./request-timeout.js";
import { createMSTeamsTokenProvider, loadMSTeamsSdkWithAuth } from "./sdk.js";
import { readAccessToken } from "./token-response.js";
import { resolveDelegatedAccessToken, resolveMSTeamsCredentials } from "./token.js";
import { buildUserAgent } from "./user-agent.js";

const GRAPH_BETA = "https://graph.microsoft.com/beta";

export type GraphUser = {
  id?: string;
  displayName?: string;
  userPrincipalName?: string;
  mail?: string;
};

export type GraphGroup = {
  id?: string;
  displayName?: string;
};

export type GraphChannel = {
  id?: string;
  displayName?: string;
};

export type GraphResponse<T> = { value?: T[] };

export function normalizeQuery(value?: string | null): string {
  return value?.trim() ?? "";
}

export function escapeOData(value: string): string {
  return value.replace(/'/g, "''");
}

async function requestGraph(params: {
  token: string;
  path: string;
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  root?: string;
  headers?: Record<string, string>;
  body?: unknown;
  errorPrefix?: string;
  deadline?: MSTeamsRequestDeadline;
}): Promise<Response> {
  const hasBody = params.body !== undefined;
  const url = `${params.root ?? GRAPH_ROOT}${params.path}`;
  const { response, release } = await fetchWithSsrFGuard({
    url,
    init: {
      method: params.method,
      headers: {
        "User-Agent": buildUserAgent(),
        Authorization: `Bearer ${params.token}`,
        ...(hasBody ? { "Content-Type": "application/json" } : {}),
        ...params.headers,
      },
      body: hasBody ? JSON.stringify(params.body) : undefined,
    },
    auditContext: "msteams.graph",
    timeoutMs: resolveMSTeamsRequestTimeoutMs(params.deadline),
  });
  let releaseInFinally = true;
  try {
    if (!response.ok) {
      throw await createMSTeamsHttpError(
        response,
        `${params.errorPrefix ?? "Graph"} ${params.path} failed`,
      );
    }
    releaseInFinally = false;
    return responseWithRelease(response, release);
  } finally {
    if (releaseInFinally) {
      await release();
    }
  }
}

async function readOptionalGraphJson<T>(res: Response, label: string): Promise<T> {
  if (res.status === 204 || res.headers.get("content-length") === "0") {
    return undefined as T;
  }
  return await readProviderJsonResponse<T>(res, label);
}

export async function mutateGraphJson<T>(params: {
  token: string;
  path: string;
  method: "POST" | "PATCH";
  body?: unknown;
  beta?: boolean;
}): Promise<T> {
  const errorPrefix = `Graph${params.beta ? " beta" : ""} ${params.method}`;
  const response = await requestGraph({
    token: params.token,
    path: params.path,
    method: params.method,
    body: params.body,
    root: params.beta ? GRAPH_BETA : undefined,
    errorPrefix,
  });
  return readOptionalGraphJson<T>(response, `${errorPrefix} ${params.path} failed`);
}

export async function fetchGraphJson<T>(params: {
  token: string;
  path: string;
  headers?: Record<string, string>;
  /** Optional shared operation deadline; actively aborts the guarded fetch when spent. */
  deadline?: MSTeamsRequestDeadline;
}): Promise<T> {
  const res = await requestGraph({
    token: params.token,
    path: params.path,
    headers: params.headers,
    deadline: params.deadline,
  });
  return await readOptionalGraphJson<T>(res, `Graph ${params.path} failed`);
}

/**
 * Fetch JSON from an absolute Graph API URL (for example @odata.nextLink
 * pagination URLs) without prepending GRAPH_ROOT.
 */
export async function fetchGraphAbsoluteUrl<T>(params: {
  token: string;
  url: string;
  headers?: Record<string, string>;
}): Promise<T> {
  const { response, release } = await fetchWithSsrFGuard({
    url: params.url,
    init: {
      headers: {
        "User-Agent": buildUserAgent(),
        Authorization: `Bearer ${params.token}`,
        ...params.headers,
      },
    },
    auditContext: "msteams.graph.absolute",
    timeoutMs: MSTEAMS_REQUEST_TIMEOUT_MS,
  });
  try {
    if (!response.ok) {
      throw await createMSTeamsHttpError(response, `Graph ${params.url} failed`);
    }
    return await readProviderJsonResponse<T>(response, `Graph ${params.url} failed`);
  } finally {
    await release();
  }
}

/** Graph collection response with optional pagination link. */
type GraphPagedResponse<T> = {
  value?: T[];
  "@odata.nextLink"?: string;
};

type GraphNativeTokenFile = {
  accessToken?: string;
  access_token?: string;
  expiresAt?: number;
  expires_at?: number;
  refreshToken?: string;
  refresh_token?: string;
  scope?: string;
  scopes?: string[];
};

function resolveGraphNativeTokenFileExpiresAtMs(parsed: GraphNativeTokenFile): number | undefined {
  if (Number.isFinite(parsed.expiresAt)) {
    return parsed.expiresAt;
  }
  if (Number.isFinite(parsed.expires_at)) {
    return parsed.expires_at * 1000;
  }
  return undefined;
}

function resolveGraphNativeTokenFileScopes(parsed: GraphNativeTokenFile): string[] | undefined {
  if (Array.isArray(parsed.scopes) && parsed.scopes.every((scope) => typeof scope === "string")) {
    return parsed.scopes;
  }
  if (typeof parsed.scope === "string" && parsed.scope.trim()) {
    return parsed.scope.split(/\s+/u).filter(Boolean);
  }
  return undefined;
}

async function readGraphNativeTokenFile(params: {
  path: string | undefined;
  credentials?: Extract<ReturnType<typeof resolveMSTeamsCredentials>, { type: "secret" }>;
}): Promise<string | undefined> {
  const path = params.path;
  if (!path) {
    return undefined;
  }

  // SAFETY: Token-file fields are read as optional strings and validated before return.
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw) as GraphNativeTokenFile;
  const token = parsed.accessToken ?? parsed.access_token;
  const expiresAtMs = resolveGraphNativeTokenFileExpiresAtMs(parsed);
  if (typeof token === "string" && token.trim() && isFutureDateTimestampMs(expiresAtMs)) {
    return token.trim();
  }

  const refreshToken = parsed.refreshToken ?? parsed.refresh_token;
  if (!params.credentials || typeof refreshToken !== "string" || !refreshToken.trim()) {
    return typeof token === "string" && token.trim() ? token.trim() : undefined;
  }

  const refreshed = await refreshMSTeamsDelegatedTokens({
    tenantId: params.credentials.tenantId,
    clientId: params.credentials.appId,
    clientSecret: params.credentials.appPassword,
    refreshToken: refreshToken.trim(),
    scopes: resolveGraphNativeTokenFileScopes(parsed),
  });
  const nextPayload = {
    ...parsed,
    accessToken: refreshed.accessToken,
    access_token: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
    refresh_token: refreshed.refreshToken,
    expiresAt: refreshed.expiresAt,
    expires_at: Math.floor(refreshed.expiresAt / 1000),
    scope: refreshed.scopes.join(" "),
    scopes: refreshed.scopes,
  };
  await writeFile(path, `${JSON.stringify(nextPayload, null, 2)}\n`, "utf8");
  return refreshed.accessToken;
}

function resolveGraphNativeTokenFilePath(): string | undefined {
  return process.env.OPENCLAW_MSTEAMS_GRAPH_NATIVE_TOKEN_FILE?.trim() || undefined;
}

/** Result of a paginated Graph API fetch. */
export type PaginatedResult<T> = {
  items: T[];
  truncated: boolean;
  found?: T;
};

/**
 * Fetch all pages of a Graph API collection, following @odata.nextLink.
 * Optionally stop early when `findOne` matches an item.
 */
export async function fetchAllGraphPages<T>(params: {
  token: string;
  path: string;
  headers?: Record<string, string>;
  /** Max pages to fetch before stopping. Default: 50. */
  maxPages?: number;
  /** Stop pagination early when this predicate returns true. */
  findOne?: (item: T) => boolean;
  /** Find-only callers can skip retaining every traversed page. */
  collectItems?: boolean;
}): Promise<PaginatedResult<T>> {
  const maxPages = params.maxPages ?? 50;
  const items: T[] = [];
  let nextPath: string | undefined = params.path;

  for (let page = 0; page < maxPages && nextPath; page++) {
    const res: GraphPagedResponse<T> = await fetchGraphJson<GraphPagedResponse<T>>({
      token: params.token,
      path: nextPath,
      headers: params.headers,
    });

    const pageItems = res.value ?? [];

    const match = params.findOne ? pageItems.find(params.findOne) : undefined;
    if (params.collectItems !== false) {
      items.push(...pageItems);
    }
    if (match) {
      return { items, truncated: false, found: match };
    }

    // @odata.nextLink is an absolute URL; strip the Graph root to get a relative path
    const rawNext: string | undefined = res["@odata.nextLink"];
    if (rawNext) {
      nextPath = rawNext
        .replace("https://graph.microsoft.com/v1.0", "")
        .replace("https://graph.microsoft.com/beta", "");
    } else {
      nextPath = undefined;
    }
  }

  return { items, truncated: Boolean(nextPath) };
}

export async function resolveGraphToken(
  cfg: unknown,
  options?: { preferDelegated?: boolean },
): Promise<string> {
  const msteamsCfg = (cfg as { channels?: { msteams?: MSTeamsConfig } })?.channels?.msteams;
  const creds = resolveMSTeamsCredentials(msteamsCfg);
  if (!creds) {
    throw new Error("MS Teams credentials missing");
  }
  if (msteamsCfg?.cloud === "China") {
    throw new Error(
      "Microsoft Teams Graph operations are not supported for channels.msteams.cloud=China until Graph requests are routed through the Azure China Graph endpoint.",
    );
  }

  // Try delegated token if requested and configured
  if (options?.preferDelegated && msteamsCfg?.delegatedAuth?.enabled && creds.type === "secret") {
    const graphNativeToken = await readGraphNativeTokenFile({
      path: resolveGraphNativeTokenFilePath(),
      credentials: creds,
    });
    if (graphNativeToken) {
      return graphNativeToken;
    }

    const delegated = await resolveDelegatedAccessToken({
      tenantId: creds.tenantId,
      clientId: creds.appId,
      clientSecret: creds.appPassword,
    });
    if (delegated) {
      return delegated;
    }
    // Fall through to app-only token
  }

  const { app } = await loadMSTeamsSdkWithAuth(creds, resolveMSTeamsSdkCloudOptions(msteamsCfg));
  const tokenProvider = createMSTeamsTokenProvider(app);
  const graphTokenValue = await withMSTeamsRequestDeadline({
    label: "MS Teams Graph token",
    work: () => tokenProvider.getAccessToken("https://graph.microsoft.com"),
  });
  const accessToken = readAccessToken(graphTokenValue);
  if (!accessToken) {
    throw new Error("MS Teams graph token unavailable");
  }
  return accessToken;
}

export async function listTeamsByName(token: string, query: string): Promise<GraphGroup[]> {
  return (await listTeamsByNameWithPageInfo(token, query)).items;
}

export async function listTeamsByNameWithPageInfo(
  token: string,
  query: string,
): Promise<PaginatedResult<GraphGroup>> {
  const escaped = escapeOData(query);
  const filter = `resourceProvisioningOptions/Any(x:x eq 'Team') and startsWith(displayName,'${escaped}')`;
  const path = `/groups?$filter=${encodeURIComponent(filter)}&$select=id,displayName`;
  return await fetchAllGraphPages<GraphGroup>({ token, path });
}

export async function deleteGraphRequest(params: { token: string; path: string }): Promise<void> {
  const response = await requestGraph({
    token: params.token,
    path: params.path,
    method: "DELETE",
    errorPrefix: "Graph DELETE",
  });
  await response.body?.cancel().catch(() => undefined);
}

export async function listChannelsForTeam(token: string, teamId: string): Promise<GraphChannel[]> {
  return (await listChannelsForTeamWithPageInfo(token, teamId)).items;
}

export async function listChannelsForTeamWithPageInfo(
  token: string,
  teamId: string,
): Promise<PaginatedResult<GraphChannel>> {
  const path = `/teams/${encodeURIComponent(teamId)}/channels?$select=id,displayName`;
  return await fetchAllGraphPages<GraphChannel>({ token, path });
}
