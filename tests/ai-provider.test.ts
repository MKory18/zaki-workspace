import { describe, expect, it, vi } from "vitest";
import {
  ANTHROPIC_URL,
  ANTHROPIC_VERSION,
  AiProviderError,
  DEFAULT_MODEL,
  KNOWN_MODELS,
  MAX_RETRY_WAIT_MS,
  buildAnthropicBody,
  createAnthropicProvider,
  errorKeyForStatus,
  isValidModelId,
  parseAnthropicAnswer,
  type AiRequest,
} from "@/server/ai/provider";
import { AR } from "@/lib/i18n/dict";

/**
 * «مساعد المالك» — the real provider, against a MOCKED `fetch`: the request it builds, the answers it understands, the refusals
 * it maps. No test here (or anywhere) touches the network, and the key is looked for in everything that comes out.
 */

const KEY = "sk-ant-TEST-KEY-do-not-leak-0123456789"; // scan-secrets:ignore
const request: AiRequest = {
  system: "نظام",
  messages: [{ role: "user", content: "سؤال" }],
  tools: [{ name: "propose_action", description: "d", inputSchema: { type: "object", properties: {} } }],
  maxTokens: 1500,
};

const ok = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });
const answer = { content: [{ type: "text", text: "الجواب" }, { type: "tool_use", id: "tu_1", name: "propose_action", input: { type: "pin_task", params: { task: "T1" }, reason: "r" } }], usage: { input_tokens: 120, output_tokens: 30 } };

function provider(fetchImpl: typeof fetch, extra: { timeoutMs?: number; sleep?: (ms: number) => Promise<void> } = {}) {
  return createAnthropicProvider({ apiKey: KEY, model: DEFAULT_MODEL, fetch: fetchImpl, sleep: extra.sleep ?? (async () => {}), ...(extra.timeoutMs ? { timeoutMs: extra.timeoutMs } : {}) });
}

describe("the request", () => {
  it("goes to the constant address, POST, with the key in x-api-key, the version and a JSON body — and nowhere else", async () => {
    const fetchMock = vi.fn(async () => ok(answer));
    await provider(fetchMock as unknown as typeof fetch).complete(request);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(url).toBe(ANTHROPIC_URL);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "x-api-key": KEY, "anthropic-version": ANTHROPIC_VERSION, "content-type": "application/json" });
    expect(ANTHROPIC_VERSION).toBe("2023-06-01");
    // a redirect is refused, so the key can only ever be sent to that one host
    expect(init.redirect).toBe("error");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    // the key is in the header and in no other place of the request
    expect(String(url)).not.toContain(KEY);
    expect(String(init.body)).not.toContain(KEY);
  });

  it("the body is the model, max_tokens, the system text, the messages and the tools with input_schema", () => {
    expect(buildAnthropicBody("claude-opus-5-5", request)).toEqual({
      model: "claude-opus-5-5",
      max_tokens: 1500,
      system: "نظام",
      messages: [{ role: "user", content: "سؤال" }],
      tools: [{ name: "propose_action", description: "d", input_schema: { type: "object", properties: {} } }],
    });
    expect(buildAnthropicBody("m", { ...request, tools: [] })).not.toHaveProperty("tools");
  });

  it("the address is a constant: the model id and the messages never become part of it", async () => {
    const fetchMock = vi.fn(async () => ok(answer));
    const p = createAnthropicProvider({ apiKey: KEY, model: "https://evil.example/x", fetch: fetchMock as unknown as typeof fetch });
    await p.complete({ ...request, messages: [{ role: "user", content: "http://169.254.169.254/latest" }] });
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(ANTHROPIC_URL);
  });

  it("the default model and the known ones", () => {
    expect(DEFAULT_MODEL).toBe("claude-sonnet-5-5");
    expect([...KNOWN_MODELS]).toEqual(["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"]);
    for (const id of KNOWN_MODELS) expect(isValidModelId(id)).toBe(true);
    for (const bad of ["", "a", "has space", "x/../y", "https://x.io", "م".repeat(5), "a".repeat(81), 5, null]) expect(isValidModelId(bad), String(bad)).toBe(false);
  });
});

describe("the answer", () => {
  it("is the text, the tool calls and the token counts", async () => {
    const out = await provider((async () => ok(answer)) as unknown as typeof fetch).complete(request);
    expect(out).toEqual({ text: "الجواب", toolCalls: [{ name: "propose_action", input: { type: "pin_task", params: { task: "T1" }, reason: "r" } }], usage: { inputTokens: 120, outputTokens: 30 } });
  });

  it("several text blocks are joined; missing usage is zero; unknown blocks are ignored; a body without content is a refusal", () => {
    expect(parseAnthropicAnswer({ content: [{ type: "text", text: "أ" }, { type: "thinking", text: "x" }, { type: "text", text: "ب" }] })).toEqual({ text: "أ\nب", toolCalls: [], usage: { inputTokens: 0, outputTokens: 0 } });
    expect(() => parseAnthropicAnswer({})).toThrowError(AiProviderError);
    expect(() => parseAnthropicAnswer(null)).toThrowError(AiProviderError);
    expect(parseAnthropicAnswer({ content: [], usage: { input_tokens: -4, output_tokens: "x" } }).usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });
});

describe("the refusals: a dictionary key, never the provider's words, never the key", () => {
  const cases: [number, string][] = [
    [400, "assistant.err_request"],
    [401, "assistant.err_key_rejected"],
    [403, "assistant.err_key_rejected"],
    [404, "assistant.err_request"],
    [413, "assistant.err_request"],
    [422, "assistant.err_request"],
    [500, "assistant.err_server"],
    [502, "assistant.err_server"],
    [503, "assistant.err_overloaded"],
    [504, "assistant.err_timeout"],
  ];

  it.each(cases)("HTTP %i is %s and the body is never echoed", async (status, key) => {
    const body = { error: { type: "x", message: `leaked ${KEY} and a customer name` } };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
    const err = await provider(fetchMock as unknown as typeof fetch)
      .complete(request)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiProviderError);
    expect((err as AiProviderError).key).toBe(key);
    expect(String((err as Error).message)).toBe(key);
    expect(JSON.stringify(err)).not.toContain(KEY);
    expect(String((err as Error).stack)).not.toContain(KEY);
    expect(fetchMock).toHaveBeenCalledTimes(1); // nothing but 429 / 529 is retried
    expect(AR[key], key).toMatch(/[؀-ۿ]/);
  });

  it("every key the provider can throw has an Arabic sentence", () => {
    for (const status of [400, 401, 429, 500, 503, 504, 529]) expect(AR[errorKeyForStatus(status)], String(status)).toMatch(/[؀-ۿ]/);
    for (const key of ["assistant.err_timeout", "assistant.err_network", "assistant.err_aborted", "assistant.err_bad_answer"]) expect(AR[key], key).toMatch(/[؀-ۿ]/);
  });

  it("429 and 529 are retried ONCE after a short wait (a retry-after is cut to the maximum); success on the retry returns the answer", async () => {
    for (const status of [429, 529]) {
      const fetchMock = vi.fn().mockResolvedValueOnce(new Response("{}", { status, headers: { "retry-after": "120" } })).mockResolvedValueOnce(ok(answer));
      const sleep = vi.fn(async () => {});
      const out = await provider(fetchMock as unknown as typeof fetch, { sleep }).complete(request);
      expect(out.text).toBe("الجواب");
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(sleep).toHaveBeenCalledWith(MAX_RETRY_WAIT_MS);
    }
  });

  it("a second 429 / 529 is the refusal (never a third call)", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 429 }));
    const err = await provider(fetchMock as unknown as typeof fetch).complete(request).catch((e: unknown) => e);
    expect((err as AiProviderError).key).toBe("assistant.err_rate_limited");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const overloaded = vi.fn(async () => new Response("{}", { status: 529 }));
    expect(((await provider(overloaded as unknown as typeof fetch).complete(request).catch((e: unknown) => e)) as AiProviderError).key).toBe("assistant.err_overloaded");
    expect(overloaded).toHaveBeenCalledTimes(2);
  });

  it("a network failure is err_network, and its own message (which may name the host or the proxy) is dropped", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError(`fetch failed for ${KEY}`);
    });
    const err = await provider(fetchMock as unknown as typeof fetch).complete(request).catch((e: unknown) => e);
    expect((err as AiProviderError).key).toBe("assistant.err_network");
    expect(JSON.stringify(err)).not.toContain(KEY);
    expect(String((err as Error).message)).not.toContain(KEY);
  });

  it("a call that takes longer than the timeout is aborted: err_timeout", async () => {
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    const err = await provider(fetchMock as unknown as typeof fetch, { timeoutMs: 20 }).complete(request).catch((e: unknown) => e);
    expect((err as AiProviderError).key).toBe("assistant.err_timeout");
  });

  it("the caller's signal aborts the call: err_aborted", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          setTimeout(() => controller.abort(), 5);
        }),
    );
    const err = await provider(fetchMock as unknown as typeof fetch).complete({ ...request, signal: controller.signal }).catch((e: unknown) => e);
    expect((err as AiProviderError).key).toBe("assistant.err_aborted");
  });

  it("a 200 whose body is not JSON, or has no content, is err_bad_answer", async () => {
    const notJson = vi.fn(async () => new Response("<html>", { status: 200 }));
    expect(((await provider(notJson as unknown as typeof fetch).complete(request).catch((e: unknown) => e)) as AiProviderError).key).toBe("assistant.err_bad_answer");
    const noContent = vi.fn(async () => ok({ nope: true }));
    expect(((await provider(noContent as unknown as typeof fetch).complete(request).catch((e: unknown) => e)) as AiProviderError).key).toBe("assistant.err_bad_answer");
  });
});
