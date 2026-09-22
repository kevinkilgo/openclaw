// Msteams tests cover Graph native text send spike descriptors.
import { describe, expect, it, vi } from "vitest";
import {
  buildGraphNativeTextRequestDescriptors,
  buildGraphNativeTextDryRunManifest,
  graphNativeTextEndpoint,
  type GraphNativeTextRoute,
} from "./graph-message-send.js";

const CHAT_ROUTE: GraphNativeTextRoute = {
  type: "chat",
  chatId: "19:chat id@thread.v2",
};

const CHANNEL_ROOT_ROUTE: GraphNativeTextRoute = {
  type: "channel-root",
  teamId: "team/id",
  channelId: "channel id",
};

const CHANNEL_REPLY_ROUTE: GraphNativeTextRoute = {
  type: "channel-reply",
  teamId: "team/id",
  channelId: "channel id",
  messageId: "root message/id",
};

describe("graphNativeTextEndpoint", () => {
  it("builds Graph chat message endpoints", () => {
    expect(graphNativeTextEndpoint(CHAT_ROUTE)).toBe(
      `/chats/${encodeURIComponent(CHAT_ROUTE.chatId)}/messages`,
    );
  });

  it("builds Graph channel root message endpoints", () => {
    expect(graphNativeTextEndpoint(CHANNEL_ROOT_ROUTE)).toBe(
      `/teams/${encodeURIComponent(CHANNEL_ROOT_ROUTE.teamId)}/channels/${encodeURIComponent(
        CHANNEL_ROOT_ROUTE.channelId,
      )}/messages`,
    );
  });

  it("builds Graph channel reply endpoints", () => {
    expect(graphNativeTextEndpoint(CHANNEL_REPLY_ROUTE)).toBe(
      `/teams/${encodeURIComponent(CHANNEL_REPLY_ROUTE.teamId)}/channels/${encodeURIComponent(
        CHANNEL_REPLY_ROUTE.channelId,
      )}/messages/${encodeURIComponent(CHANNEL_REPLY_ROUTE.messageId)}/replies`,
    );
  });
});

describe("buildGraphNativeTextRequestDescriptors", () => {
  it("builds native text body descriptors only", () => {
    const [request] = buildGraphNativeTextRequestDescriptors({
      route: CHAT_ROUTE,
      text: "hello Graph",
    });

    expect(request).toMatchObject({
      method: "POST",
      endpoint: `/chats/${encodeURIComponent(CHAT_ROUTE.chatId)}/messages`,
      routeType: "chat",
      body: { body: { contentType: "text", content: "hello Graph" } },
      chunkIndex: 1,
      chunkCount: 1,
    });
    expect(request.payloadBytes).toBe(Buffer.byteLength(JSON.stringify(request.body), "utf8"));
  });

  it("requires justification before allowing html content", () => {
    expect(() =>
      buildGraphNativeTextRequestDescriptors({
        route: CHAT_ROUTE,
        text: "<b>hello</b>",
        contentType: "html",
        allowHtml: true,
      }),
    ).toThrow(/requires explicit justification/u);

    expect(() =>
      buildGraphNativeTextRequestDescriptors({
        route: CHAT_ROUTE,
        text: "<b>hello</b>",
        contentType: "html",
        htmlJustification: "Preserve Teams mentions in a later live proof.",
      }),
    ).toThrow(/requires explicit justification/u);

    expect(
      buildGraphNativeTextRequestDescriptors({
        route: CHAT_ROUTE,
        text: "<b>hello</b>",
        contentType: "html",
        allowHtml: true,
        htmlJustification: "Preserve Teams mentions in a later live proof.",
      })[0]?.body.body.contentType,
    ).toBe("html");
  });

  it("rejects artifact, card, file, and link fallbacks", () => {
    for (const fallbackParams of [
      { attachments: [{ path: "artifact.md" }] },
      { cards: [{ type: "AdaptiveCard" }] },
      { files: [{ name: "payload.txt" }] },
      { links: ["https://example.test/payload"] },
      { forbiddenFallbacks: { artifact: { path: "artifact.md" } } },
      { forbiddenFallbacks: { card: { type: "AdaptiveCard" } } },
      { forbiddenFallbacks: { file: { name: "payload.txt" } } },
      { forbiddenFallbacks: { link: "https://example.test/payload" } },
    ]) {
      expect(() =>
        buildGraphNativeTextRequestDescriptors({
          route: CHAT_ROUTE,
          text: "hello",
          ...fallbackParams,
        }),
      ).toThrow(/rejects .* fallback/u);
    }
  });
});

describe("buildGraphNativeTextDryRunManifest", () => {
  it("does not call network or sender hooks in dry-run mode", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const manifest = buildGraphNativeTextDryRunManifest({
      route: CHAT_ROUTE,
      text: "dry run only",
    });

    expect(manifest.mode).toBe("dry-run");
    expect(manifest.noNetwork).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it.each([
    { label: "80 KB", size: 80 * 1024, expectedChunks: 1 },
    { label: "near-100 KB", size: 99 * 1024, expectedChunks: 2 },
    { label: "200 KB multipart", size: 200 * 1024, expectedChunks: 3 },
  ])("plans a $label fixture manifest with hash evidence", ({ size, expectedChunks }) => {
    const source = makeFixtureText(size);
    const manifest = buildGraphNativeTextDryRunManifest({
      route: CHANNEL_REPLY_ROUTE,
      text: source,
      maxPayloadBytes: 90 * 1024,
    });

    expect(manifest.routeType).toBe("channel-reply");
    expect(manifest.method).toBe("POST");
    expect(manifest.endpoints).toEqual([graphNativeTextEndpoint(CHANNEL_REPLY_ROUTE)]);
    expect(manifest.chunkCount).toBe(expectedChunks);
    expect(manifest.requestCount).toBe(expectedChunks);
    expect(manifest.chunks).toHaveLength(expectedChunks);
    expect(manifest.sourceHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(manifest.reconstructedHash).toBe(manifest.sourceHash);
    expect(manifest.totalPayloadBytes).toBeGreaterThan(size);
    expect(manifest.sourceBytes).toBe(Buffer.byteLength(source));
    expect(manifest.rateLimitPlan.minIntervalMs).toBe(1000);
    expect(manifest.rateLimitPlan.note).toContain("1 request/sec");
    expect(manifest.identityWarning).toContain("signed-in user");
    expect(manifest.contentType).toBe("text");
    expect(manifest.fallbackPolicy).toBe("native-text-only-no-artifact-card-file-link-fallback");
    expect(manifest.chunks.every((chunk) => chunk.bytes <= 90 * 1024)).toBe(true);
  });

  it("captures route and payload byte evidence for all supported route types", () => {
    const manifests = [CHAT_ROUTE, CHANNEL_ROOT_ROUTE, CHANNEL_REPLY_ROUTE].map((route) =>
      buildGraphNativeTextDryRunManifest({ route, text: "hello" }),
    );

    expect(manifests.map((manifest) => manifest.routeType)).toEqual([
      "chat",
      "channel-root",
      "channel-reply",
    ]);
    expect(manifests.every((manifest) => manifest.totalPayloadBytes > 0)).toBe(true);
    expect(manifests.flatMap((manifest) => manifest.endpoints)).toEqual([
      graphNativeTextEndpoint(CHAT_ROUTE),
      graphNativeTextEndpoint(CHANNEL_ROOT_ROUTE),
      graphNativeTextEndpoint(CHANNEL_REPLY_ROUTE),
    ]);
  });
});

function makeFixtureText(sizeBytes: number): string {
  const block = "0123456789abcdefghijklmnopqrstuvwxyz\n";
  let out = "";
  while (Buffer.byteLength(out) < sizeBytes) {
    out += block;
  }
  return out.slice(0, sizeBytes);
}
