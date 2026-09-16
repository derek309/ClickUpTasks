// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../mcp/core.mjs";

/* eslint-disable @typescript-eslint/no-explicit-any */

// The review tools in mcp/core.mjs, called the way Claude calls them, against fake
// services: which tools exist, and that each passes its arguments through as the
// app's review code (mcpReviewServices.ts) expects. No database is touched.

const REVIEW_TOOLS = [
  "list_reviews", "get_review", "get_client_document", "create_review", "update_review", "write_document", "write_client_document",
  "start_image_upload", "add_review_version", "use_version", "remove_version", "send_for_review", "get_review_link",
  "revoke_review_link", "add_review_comment", "update_review_comment", "delete_review_comment", "delete_review", "restore_review",
];

async function connect(services?: Record<string, unknown>) {
  const server = createServer({ url: "https://db.invalid", key: "test", memberId: "u_claude", services });
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return client;
}
const call = async (client: Client, name: string, args: Record<string, unknown>) =>
  ((await client.callTool({ name, arguments: args })) as any).content[0].text as string;

describe("review tools over MCP", () => {
  it("are only offered when the app passes its review code in", async () => {
    const bare = (await (await connect()).listTools()).tools.map((t) => t.name);
    expect(bare).toContain("list_my_tasks");
    expect(bare).not.toContain("list_reviews");
    expect(bare).not.toContain("get_client_document");

    const full = (await (await connect({})).listTools()).tools.map((t) => t.name);
    for (const name of REVIEW_TOOLS) expect(full).toContain(name);
  });

  it("sends a review with the email as a draft written from plain text", async () => {
    const sendForReview = vi.fn(async () => "Sent version 2.");
    const client = await connect({ sendForReview });
    expect(await call(client, "send_for_review", { task_id: "t_1", kind: "page", email_subject: "Your page", email_body: "Hi Sam,\n\nHave a look: [[LINK]]" }))
      .toBe("Sent version 2.");
    expect(sendForReview).toHaveBeenCalledWith("t_1", "page", { draftEmail: true, subject: "Your page", bodyHtml: "<p>Hi Sam,</p><p>Have a look: [[LINK]]</p>" });

    await call(client, "send_for_review", { task_id: "t_1", kind: "doc", draft_email: false });
    expect(sendForReview).toHaveBeenLastCalledWith("t_1", "doc", { draftEmail: false, subject: undefined, bodyHtml: undefined });
  });

  it("writes a document from markdown under both names, and refuses an empty one", async () => {
    const writeDocument = vi.fn(async () => "Updated.");
    const client = await connect({ writeDocument });
    await call(client, "write_document", { task_id: "t_1", body: "## Fall sale\n\nHello **there**" });
    expect(writeDocument).toHaveBeenCalledWith("t_1", "<h2>Fall sale</h2><p>Hello <strong>there</strong></p>", undefined);
    await call(client, "write_client_document", { task_id: "t_1", body: "Hi", title: "Flyer" });
    expect(writeDocument).toHaveBeenLastCalledWith("t_1", "<p>Hi</p>", "Flyer");
    expect(await call(client, "write_document", { task_id: "t_1", body: "   " })).toBe("The document is empty.");
    expect(writeDocument).toHaveBeenCalledTimes(2);
  });

  it("passes versions, pins and new files through", async () => {
    const services = { addComment: vi.fn(async () => "ok"), addVersion: vi.fn(async () => "ok"), removeVersion: vi.fn(async () => "ok"), getReview: vi.fn(async () => "ok") };
    const client = await connect(services);
    await call(client, "add_review_comment", { task_id: "t_1", kind: "image", text: "Bigger logo", pin: { version: 2, x: 0.5, y: 0.25 } });
    expect(services.addComment).toHaveBeenCalledWith("t_1", "image", "Bigger logo", { quote: undefined, pin: { version: 2, x: 0.5, y: 0.25 } });
    await call(client, "add_review_version", { task_id: "t_1", kind: "image", image_url: "https://example.com/logo.png" });
    expect(services.addVersion).toHaveBeenCalledWith("t_1", "image", { imageUrl: "https://example.com/logo.png", uploadId: undefined, html: undefined, name: undefined });
    await call(client, "add_review_version", {
      task_id: "t_1", kind: "image", keep_others: true,
      images: [{ image_url: "https://example.com/back.png", label: "Back", position: 2 }],
    });
    expect(services.addVersion).toHaveBeenLastCalledWith("t_1", "image", {
      imageUrl: undefined, uploadId: undefined, html: undefined, name: undefined, keepOthers: true,
      images: [{ imageUrl: "https://example.com/back.png", uploadId: undefined, name: undefined, label: "Back", position: 2 }],
    });
    await call(client, "add_review_version", {
      task_id: "t_1", kind: "page",
      pages: [{ html: "<p>Welcome</p>", label: "Welcome email" }, { html: "<p>Reminder</p>" }],
    });
    expect(services.addVersion).toHaveBeenLastCalledWith("t_1", "page", {
      imageUrl: undefined, uploadId: undefined, html: undefined, name: undefined, keepOthers: false,
      pages: [{ html: "<p>Welcome</p>", name: undefined, label: "Welcome email", position: undefined }, { html: "<p>Reminder</p>", name: undefined, label: undefined, position: undefined }],
    });
    await call(client, "add_review_comment", { task_id: "t_1", kind: "image", text: "Darker", pin: { version: 1, x: 0.1, y: 0.2, image: "Back" } });
    expect(services.addComment).toHaveBeenLastCalledWith("t_1", "image", "Darker", { quote: undefined, pin: { version: 1, x: 0.1, y: 0.2, image: "Back" } });
    await call(client, "remove_version", { task_id: "t_1", kind: "page", version: "next" });
    expect(services.removeVersion).toHaveBeenCalledWith("t_1", "page", "next");
    await call(client, "get_client_document", { task_id: "t_1" });
    expect(services.getReview).toHaveBeenCalledWith("t_1", "doc", false);
  });

  it("refuses a pin off the image", async () => {
    const addComment = vi.fn();
    const client = await connect({ addComment });
    const result = await client.callTool({ name: "add_review_comment", arguments: { task_id: "t_1", kind: "image", text: "x", pin: { version: 1, x: 1.5, y: 0 } } }) as any;
    expect(result.isError).toBe(true);
    expect(addComment).not.toHaveBeenCalled();
  });
});
