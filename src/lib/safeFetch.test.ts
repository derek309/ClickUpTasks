// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const lookup = vi.fn();
vi.mock("node:dns/promises", () => ({ lookup: (...args: unknown[]) => lookup(...args) }));
const { fetchImage, fetchPublic, imageTypeOf, isBlockedIp } = await import("./safeFetch");

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const fetchMock = vi.fn();

beforeEach(() => {
  lookup.mockReset().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("isBlockedIp", () => {
  it.each(["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "not an ip"])("blocks %s", (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });
  it.each(["93.184.216.34", "8.8.8.8", "2606:4700::1111"])("lets %s through", (ip) => {
    expect(isBlockedIp(ip)).toBe(false);
  });
});

describe("imageTypeOf", () => {
  it("reads the type from the first bytes", () => {
    expect(imageTypeOf(PNG)).toBe("image/png");
    expect(imageTypeOf(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(imageTypeOf(new TextEncoder().encode("GIF89a...."))).toBe("image/gif");
    expect(imageTypeOf(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
    expect(imageTypeOf(new TextEncoder().encode("<svg xmlns="))).toBeNull();
  });
});

describe("fetchPublic", () => {
  it("checks the host again on every redirect", async () => {
    lookup
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
      .mockResolvedValueOnce([{ address: "169.254.169.254", family: 4 }]);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://metadata.example/latest" } }));
    await expect(fetchPublic(new URL("https://example.com/a"), { accept: "*/*", userAgent: "t", timeoutMs: 1000 })).rejects.toThrow("isn't reachable");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("fetchImage", () => {
  it("takes a real image from a public https link", async () => {
    fetchMock.mockResolvedValueOnce(new Response(PNG, { status: 200, headers: { "content-type": "image/png" } }));
    const r = await fetchImage("https://example.com/logo.png", 1024);
    expect(r).toMatchObject({ ok: true, contentType: "image/png", extension: "png" });
  });

  it("refuses plain http, private hosts, lies about the type, and anything too big", async () => {
    expect(await fetchImage("http://example.com/logo.png", 1024)).toEqual({ ok: false, error: "Only https links." });

    lookup.mockResolvedValueOnce([{ address: "10.0.0.5", family: 4 }]);
    expect(await fetchImage("https://intranet.example/logo.png", 1024)).toEqual({ ok: false, error: "That host isn't reachable from here." });

    fetchMock.mockResolvedValueOnce(new Response("<svg xmlns='http://www.w3.org/2000/svg'/>", { status: 200, headers: { "content-type": "image/png" } }));
    expect(await fetchImage("https://example.com/fake.png", 1024)).toEqual({ ok: false, error: "That link isn't a PNG, JPEG, GIF or WebP image." });

    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array(4096), { status: 200 }));
    expect(await fetchImage("https://example.com/huge.png", 1024 * 1024 / 1024)).toMatchObject({ ok: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
