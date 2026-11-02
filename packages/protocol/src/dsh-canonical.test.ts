import { describe, expect, it } from "vitest";
import { canonicalPathAllowed, canonicalRequestSchema } from "./dsh-canonical";
const paths = new Set([
  "/api/session/prompt",
  "/api/session/uploadFileBinary",
  "/api/$events/result",
]);
describe("canonical native request admission", () => {
  it("admits canonical Gateway routes, upload and assets", () => {
    for (const path of paths)
      if (!path.endsWith("uploadFileBinary")) expect(canonicalPathAllowed(path, "POST")).toBe(true);
    for (const path of [
      "/",
      "/index.html",
      "/assets/web.js",
      "/plugins/revision/chat.js",
      "/favicon.ico",
    ]) {
      expect(canonicalPathAllowed(path, "GET")).toBe(true);
      expect(canonicalPathAllowed(path, "HEAD")).toBe(true);
    }
  });
  it.each([
    "https://foreign.test/api/session/prompt",
    "/\n/evil.example/assets/x.js",
    "/\t/evil.example/assets/x.js",
    "/\r/evil.example/assets/x.js",
    "//foreign.test/assets/a.js",

    "/api/session/prompt?extra=1",
    "/api/session/prompt#fragment",
    "/assets/../secret",
    "/assets/%2e%2e/secret",
    "/assets/%5csecret",
    "/assets/%00secret",
    "/api/unknown",
    "/api/session/%2570rompt",
    "/api/session/%2e%2e/prompt",
    "/api/connection/devices/claim",
    "/private/file",
  ])("refuses credentials for %s", (path) => {
    expect(canonicalPathAllowed(path, "POST")).toBe(false);
    expect(canonicalPathAllowed(path, "GET")).toBe(false);
  });
  it("admits raw file upload identity and optional encoded filename only", () => {
    expect(
      canonicalPathAllowed(
        "/api/session/uploadFileBinary?sessionId=one&name=a%20b.txt",
        "POST",
        paths,
      ),
    ).toBe(true);
    expect(canonicalPathAllowed("/api/session/uploadFileBinary?sessionId=one", "POST")).toBe(true);
    for (const suffix of [
      "",
      "?sessionId=",
      "?sessionId=one&sessionId=two",
      "?sessionId=one&destination=other",
      "?sessionId=one&name=a&name=b",
    ])
      expect(canonicalPathAllowed("/api/session/uploadFileBinary" + suffix, "POST")).toBe(false);
  });
  it("admits only explicit ZIP export queries and read methods", () => {
    expect(
      canonicalPathAllowed(
        "/api/session.export?sessionId=one&includeDescendants=true",
        "GET",
        paths,
      ),
    ).toBe(true);
    expect(canonicalPathAllowed("/api/session.export?sessionId=one", "HEAD")).toBe(true);
    for (const path of [
      "/api/session.export",
      "/api/session.export?sessionId=",
      "/api/session.export?sessionId=one&sessionId=two",
      "/api/session.export?sessionId=one&destination=foreign",
    ])
      expect(canonicalPathAllowed(path, "GET")).toBe(false);
    expect(canonicalPathAllowed("/api/session.export?sessionId=one", "POST")).toBe(false);
  });
  it("accepts bridge data and rejects injected credential or destination fields", () => {
    const request = { kind: "socket-open", id: "0e96f635-d3ee-4b70-ac76-7bf062733845" };
    expect(canonicalRequestSchema.safeParse(request).success).toBe(true);
    expect(canonicalRequestSchema.safeParse({ ...request, credential: "secret" }).success).toBe(
      false,
    );
    expect(
      canonicalRequestSchema.safeParse({ ...request, url: "wss://foreign.test" }).success,
    ).toBe(false);
    expect(canonicalRequestSchema.safeParse({ kind: "enroll", id: request.id }).success).toBe(
      false,
    );
  });
});

it("preserves live plugin namespaces and leaves unknown RPC refusal to the Host", () => {
  for (const path of [
    "/api/agentTeams/view",
    "/api/agentTeams/createTask",
    "/api/agentTeams/updateTask",
    "/api/operatorPlugin/newMethod",
  ])
    expect(canonicalPathAllowed(path, "POST")).toBe(true);
  expect(canonicalPathAllowed("/api/connection/devices", "GET")).toBe(false);
});

it("scopes durable receipt operations to the native Host and bounds UTF-8 bytes", () => {
  const request = {
    kind: "creation-cas",
    id: "0e96f635-d3ee-4b70-ac76-7bf062733845",
    before: null,
    after: "receipt",
  };
  expect(canonicalRequestSchema.safeParse(request).success).toBe(true);
  expect(canonicalRequestSchema.safeParse({ ...request, hostId: "foreign" }).success).toBe(false);
  expect(canonicalRequestSchema.safeParse({ ...request, after: "🙂".repeat(262145) }).success).toBe(
    false,
  );
});
