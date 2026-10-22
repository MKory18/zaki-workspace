import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertPublicHttpsUrl, isPrivateAddress, UnsafeUrlError, type UnsafeUrlCode } from "../src/server/net-guard";

/**
 * SSRF guard for outbound webhook URLs. Pure tests: no DNS, no network — the
 * resolver is injected.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isPrivateAddress - IPv4", () => {
  const BLOCKED = [
    // "this network"
    "0.0.0.0",
    "0.1.2.3",
    // RFC 1918
    "10.0.0.1",
    "10.255.255.255",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.0.1",
    "192.168.255.255",
    // CGNAT 100.64.0.0/10 (also Alibaba's metadata address 100.100.100.200)
    "100.64.0.1",
    "100.100.100.200",
    "100.127.255.255",
    // loopback
    "127.0.0.1",
    "127.255.255.254",
    // link-local, incl. the cloud metadata endpoint
    "169.254.0.1",
    "169.254.169.254",
    // IETF protocol assignments (Oracle metadata 192.0.0.192) + documentation + 6to4 relay + benchmarking
    "192.0.0.1",
    "192.0.0.192",
    "192.0.2.1",
    "192.88.99.1",
    "198.18.0.1",
    "198.19.255.255",
    "198.51.100.7",
    "203.0.113.9",
    // multicast, reserved, broadcast
    "224.0.0.1",
    "239.255.255.255",
    "240.0.0.1",
    "255.255.255.255",
  ];
  const PUBLIC = [
    "8.8.8.8",
    "1.1.1.1",
    "93.184.216.34",
    // the addresses right next to each blocked range must stay reachable (prefix-mask off-by-one guard)
    "9.255.255.255",
    "11.0.0.1",
    "100.63.255.255",
    "100.128.0.1",
    "126.255.255.255",
    "128.0.0.1",
    "169.253.255.255",
    "169.255.0.0",
    "172.15.255.255",
    "172.32.0.1",
    "192.167.255.255",
    "192.169.0.1",
    "198.17.255.255",
    "198.20.0.0",
    "223.255.255.255",
  ];

  it.each(BLOCKED)("blocks %s", (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each(PUBLIC)("allows %s", (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });
});

describe("isPrivateAddress - IPv6", () => {
  const BLOCKED = [
    "::", // unspecified
    "::1", // loopback
    "0:0:0:0:0:0:0:1",
    // IPv4-mapped: judged by the IPv4 they carry (dotted and hex spellings)
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "0:0:0:0:0:ffff:7f00:1",
    "::ffff:10.0.0.1",
    "::ffff:a00:1",
    "::ffff:169.254.169.254",
    "::ffff:c0a8:101", // 192.168.1.1
    // deprecated IPv4-compatible
    "::127.0.0.1",
    "::7f00:1",
    // NAT64: judged by the embedded IPv4; the local-use prefix is blocked as a whole
    "64:ff9b::7f00:1",
    "64:ff9b::a9fe:a9fe", // 169.254.169.254
    "64:ff9b:1::1",
    // 6to4: judged by the embedded IPv4
    "2002:7f00:1::",
    "2002:a9fe:a9fe::1",
    "2002:c0a8:101::1",
    // unique-local (incl. AWS IPv6 metadata fd00:ec2::254), link-local, site-local, multicast
    "fc00::1",
    "fd00:ec2::254",
    "fdff:ffff:ffff::1",
    "fe80::1",
    "febf::1",
    "fec0::1",
    "ff00::",
    "ff02::1",
    // documentation, Teredo, benchmarking, discard-only, IETF protocol block
    "2001:db8::1",
    "2001::1",
    "2001:2::1",
    "100::1",
    "3fff::1",
    // anything outside 2000::/3 is not global unicast: fail closed
    "4000::1",
    "8000::1",
    // tolerated spellings
    "[::1]",
    "FE80::1%eth0",
    "::FFFF:7F00:1",
  ];
  const PUBLIC = [
    "2606:4700:4700::1111",
    "2001:4860:4860::8888",
    "2a00:1450:4001:81b::200e",
    "2400:cb00::1",
    "2620:0:ccc::2",
    // tunnelling forms that carry a PUBLIC IPv4 are public
    "::ffff:8.8.8.8",
    "::ffff:808:808",
    "64:ff9b::808:808",
    "2002:808:808::1",
  ];

  it.each(BLOCKED)("blocks %s", (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each(PUBLIC)("allows %s", (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });
});

describe("isPrivateAddress - fail closed", () => {
  it.each([
    "",
    "abc",
    "not-an-ip",
    "example.com",
    "1.2.3",
    "1.2.3.4.5",
    "256.1.1.1",
    "1.2.3.256",
    "01.2.3.4",
    "1.2.3.4/24",
    "::g",
    ":::",
    "1::2::3",
    "12345::1",
  ])("treats %j (not a valid IP literal) as private", (value) => {
    expect(isPrivateAddress(value)).toBe(true);
  });
});

describe("assertPublicHttpsUrl", () => {
  // The strict rules are the production rules; the development exemption has its own block below.
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
  });

  const PUBLIC_IP = "93.184.216.34";
  const publicResolver = () => vi.fn(async () => [PUBLIC_IP]);

  async function refusal(url: string, resolve: (h: string) => Promise<string[]> = publicResolver()): Promise<UnsafeUrlCode> {
    try {
      await assertPublicHttpsUrl(url, { resolve });
    } catch (err) {
      expect(err).toBeInstanceOf(UnsafeUrlError);
      return (err as UnsafeUrlError).code;
    }
    throw new Error(`expected ${url} to be refused`);
  }

  it("accepts a public https URL and returns it parsed", async () => {
    const resolve = publicResolver();
    const url = await assertPublicHttpsUrl("https://hooks.example.com/webhook/zaki?x=1", { resolve });
    expect(url).toBeInstanceOf(URL);
    expect(url.href).toBe("https://hooks.example.com/webhook/zaki?x=1");
    expect(resolve).toHaveBeenCalledWith("hooks.example.com");
  });

  it("accepts a name that resolves to public IPv4 and IPv6 addresses only", async () => {
    await expect(
      assertPublicHttpsUrl("https://n8n.example.com/hook", { resolve: async () => [PUBLIC_IP, "2606:4700:4700::1111"] }),
    ).resolves.toBeInstanceOf(URL);
  });

  it("does not resolve IP literals (there is nothing to look up)", async () => {
    const resolve = publicResolver();
    await assertPublicHttpsUrl("https://93.184.216.34/hook", { resolve });
    await assertPublicHttpsUrl("https://[2606:4700:4700::1111]/hook", { resolve });
    expect(resolve).not.toHaveBeenCalled();
  });

  it("refuses plain http for public hosts", async () => {
    expect(await refusal("http://hooks.example.com/hook")).toBe("https_only");
    expect(await refusal("http://93.184.216.34/hook")).toBe("https_only");
  });

  it.each(["ftp://example.com/x", "file:///etc/passwd", "javascript:alert(1)", "gopher://example.com/", "ws://example.com/"])(
    "refuses the non-http(s) scheme in %s",
    async (url) => {
      expect(await refusal(url)).toBe("invalid");
    },
  );

  it.each(["", "   ", "not a url", "https://", "//example.com/x", "example.com/hook"])("refuses unparsable input %j", async (url) => {
    expect(await refusal(url)).toBe("invalid");
  });

  it.each(["https://user:pass@hooks.example.com/x", "https://user@hooks.example.com/x", "https://:pass@hooks.example.com/x"])(
    "refuses credentials embedded in the URL: %s",
    async (url) => {
      expect(await refusal(url)).toBe("credentials");
    },
  );

  it("refuses the 'userinfo@internal' trick (credentials are reported before the host)", async () => {
    expect(await refusal("https://hooks.example.com@127.0.0.1/x")).toBe("credentials");
  });

  it.each([
    "https://127.0.0.1/hook",
    "https://127.0.0.1:8443/hook",
    "https://10.0.0.5/hook",
    "https://192.168.1.10:8443/x",
    "https://172.16.0.9/x",
    "https://169.254.169.254/latest/meta-data/",
    "https://100.64.0.1/x",
    "https://0.0.0.0/x",
    "https://224.0.0.1/x",
    "https://[::1]/hook",
    "https://[fd00:ec2::254]/x",
    "https://[fe80::1]/x",
    "https://[::ffff:7f00:1]/x",
    "https://[::ffff:127.0.0.1]/x",
  ])("refuses the literal non-public address in %s", async (url) => {
    expect(await refusal(url)).toBe("private");
  });

  it.each([
    "https://2130706433/", // decimal
    "https://0x7f000001/", // hex
    "https://0177.0.0.1/", // octal
    "https://127.1/", // short form
    "https://0x7f.0.0.1/", // mixed
    "https://0/", // 0.0.0.0
    "https://2852039166/", // 169.254.169.254 as a decimal integer
  ])("refuses alternative spellings of internal addresses: %s", async (url) => {
    expect(await refusal(url)).toBe("private");
  });

  it("never asks DNS about an IP literal it already knows to be private", async () => {
    const resolve = publicResolver();
    expect(await refusal("https://10.1.2.3/x", resolve)).toBe("private");
    expect(resolve).not.toHaveBeenCalled();
  });

  it("refuses single-label names (container / service names such as db or redis) without asking DNS", async () => {
    const resolve = publicResolver();
    expect(await refusal("https://db/x", resolve)).toBe("private");
    expect(await refusal("https://redis:6379/", resolve)).toBe("private");
    expect(await refusal("https://localhost/x", resolve)).toBe("private");
    expect(resolve).not.toHaveBeenCalled();
  });

  it("refuses a name that resolves to a private IPv4 address", async () => {
    expect(await refusal("https://internal.example.com/x", async () => ["10.0.0.7"])).toBe("private");
    expect(await refusal("https://rebind.example.com/x", async () => ["127.0.0.1"])).toBe("private");
    expect(await refusal("https://meta.example.com/x", async () => ["169.254.169.254"])).toBe("private");
  });

  it("refuses a name that resolves to a private IPv6 address", async () => {
    expect(await refusal("https://v6.example.com/x", async () => ["::1"])).toBe("private");
    expect(await refusal("https://v6.example.com/x", async () => ["fd00::5"])).toBe("private");
    expect(await refusal("https://v6.example.com/x", async () => ["::ffff:10.0.0.1"])).toBe("private");
  });

  it("refuses when ANY resolved address is private (public + private mix)", async () => {
    expect(await refusal("https://mix.example.com/x", async () => [PUBLIC_IP, "10.0.0.7"])).toBe("private");
    expect(await refusal("https://mix.example.com/x", async () => ["10.0.0.7", PUBLIC_IP])).toBe("private");
    expect(await refusal("https://mix.example.com/x", async () => [PUBLIC_IP, "::1"])).toBe("private");
    expect(await refusal("https://mix.example.com/x", async () => ["2606:4700:4700::1111", "fe80::1"])).toBe("private");
  });

  it("refuses names that cannot be resolved", async () => {
    expect(
      await refusal("https://nope.example.com/x", async () => {
        throw Object.assign(new Error("getaddrinfo ENOTFOUND nope.example.com"), { code: "ENOTFOUND" });
      }),
    ).toBe("unresolvable");
    expect(await refusal("https://empty.example.com/x", async () => [])).toBe("unresolvable");
  });

  it("gives up on a DNS server that never answers instead of hanging the caller", async () => {
    const never = () => new Promise<string[]>(() => undefined);
    const started = Date.now();
    await expect(assertPublicHttpsUrl("https://slow.example.com/x", { resolve: never, timeoutMs: 40 })).rejects.toMatchObject({
      code: "unresolvable",
    });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("ignores a trailing dot and letter case when judging the host", async () => {
    const resolve = publicResolver();
    await assertPublicHttpsUrl("https://Hooks.Example.COM./x", { resolve });
    expect(resolve).toHaveBeenCalledWith("hooks.example.com");
    vi.stubEnv("NODE_ENV", "production");
    expect(await refusal("https://localhost./x", async () => ["127.0.0.1"])).toBe("private");
  });

  describe("production", () => {
    it("refuses loopback names and addresses over http AND https, without trusting DNS", async () => {
      vi.stubEnv("NODE_ENV", "production");
      const resolve = publicResolver(); // a malicious resolver claiming localhost is public
      for (const url of [
        "http://localhost:5678/hook",
        "https://localhost/hook",
        "https://sub.localhost/hook",
        "http://127.0.0.1:5678/hook",
        "https://127.0.0.1/hook",
        "https://[::1]/hook",
      ]) {
        await expect(assertPublicHttpsUrl(url, { resolve }), url).rejects.toBeInstanceOf(UnsafeUrlError);
      }
    });
  });

  describe("development (NODE_ENV is not production)", () => {
    it("allows http://localhost, http://127.0.0.1 and http://[::1] so a local n8n can be tried out", async () => {
      vi.stubEnv("NODE_ENV", "development");
      const resolve = publicResolver();
      for (const url of ["http://localhost:5678/webhook/zaki", "http://127.0.0.1:5678/webhook/zaki", "http://[::1]:5678/webhook/zaki", "https://localhost:5678/x"]) {
        await expect(assertPublicHttpsUrl(url, { resolve }), url).resolves.toBeInstanceOf(URL);
      }
      expect(resolve).not.toHaveBeenCalled();
    });

    it("the exception is for loopback only: every other private host stays blocked", async () => {
      vi.stubEnv("NODE_ENV", "development");
      expect(await refusal("http://192.168.1.5:5678/x")).toBe("https_only");
      expect(await refusal("https://192.168.1.5:5678/x")).toBe("private");
      expect(await refusal("https://10.0.0.1:5678/x")).toBe("private");
      expect(await refusal("https://169.254.169.254/x")).toBe("private");
      expect(await refusal("http://intranet.example.com/x", async () => ["10.0.0.9"])).toBe("https_only");
    });

    it("loopback with credentials is still refused", async () => {
      vi.stubEnv("NODE_ENV", "development");
      expect(await refusal("http://user:pw@localhost:5678/x")).toBe("credentials");
    });

    it("the exception can be switched off explicitly (the option wins over NODE_ENV)", async () => {
      vi.stubEnv("NODE_ENV", "development");
      await expect(assertPublicHttpsUrl("http://localhost:5678/x", { allowLoopbackHttp: false })).rejects.toBeInstanceOf(UnsafeUrlError);
    });
  });
});
