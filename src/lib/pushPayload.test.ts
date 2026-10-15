import { describe, it, expect } from "vitest";
import { buildPushPayload, claudeFinishedPush, clientWrotePush, parsePushSubscription, pushLink, teammatePush, teammatePushReason, type NotificationRowLike } from "./pushPayload";

const P256 = "B" + "A".repeat(86); // 87 characters, an uncompressed P-256 key's length
const AUTH = "a".repeat(22);

describe("buildPushPayload", () => {
  it("keeps it to one short line each", () => {
    const p = buildPushPayload({ title: "  Pam\nMacias ", body: "x ".repeat(200), url: "/?task=t_1" });
    expect(p.title).toBe("Pam Macias");
    expect(p.body.length).toBeLessThanOrEqual(180);
    expect(p.body.endsWith("…")).toBe(true);
    expect(p.url).toBe("/?task=t_1");
  });

  it("only ever links inside the app", () => {
    expect(buildPushPayload({ url: "https://evil.example/" }).url).toBe("/");
    expect(buildPushPayload({ url: "//evil.example/" }).url).toBe("/");
    expect(buildPushPayload({ url: null }).url).toBe("/");
  });

  it("falls back to the app's name and drops an empty tag", () => {
    const p = buildPushPayload({ body: "Hi" });
    expect(p).toEqual({ title: "ClickUpTasks", body: "Hi", url: "/" });
  });

  it("keeps a sensible badge count only", () => {
    expect(buildPushPayload({ badgeCount: 3.7 }).badgeCount).toBe(3);
    expect(buildPushPayload({ badgeCount: -1 }).badgeCount).toBeUndefined();
    expect(buildPushPayload({ badgeCount: Number.NaN }).badgeCount).toBeUndefined();
  });
});

describe("pushLink", () => {
  it("opens the task over its client", () => {
    expect(pushLink({ taskId: "t_1", clientId: "cl_pam" })).toBe("/?client=cl_pam&task=t_1");
  });
  it("opens a direct message thread", () => {
    expect(pushLink({ dmFrom: "u_justin" })).toBe("/?view=inbox&dm=u_justin");
  });
  it("opens a client's chat for a chat mention, else the client", () => {
    expect(pushLink({ clientId: "cl_pam", chat: true })).toBe("/?client=cl_pam&tab=chat");
    expect(pushLink({ clientId: "cl_pam" })).toBe("/?client=cl_pam");
    expect(pushLink({})).toBe("/");
  });
});

describe("teammatePushReason", () => {
  it("pushes messages, mentions and direct messages", () => {
    expect(teammatePushReason({ kind: "dm", text: "Justin sent you a message" })).toBe("dm");
    expect(teammatePushReason({ kind: "message", text: "Justin mentioned you in “Blog post”" })).toBe("message");
  });

  it("pushes a step or task handed to you", () => {
    expect(teammatePushReason({ kind: "activity", text: "Justin assigned you “Blog post”" })).toBe("handoff");
    expect(teammatePushReason({ kind: "activity", text: "Justin gave you a step on “Blog post”" })).toBe("handoff");
    expect(teammatePushReason({ kind: "activity", text: "Justin delegated \"Write it\" on Blog post to you" })).toBe("handoff");
    expect(teammatePushReason({ kind: null, text: "Justin delegated \"Write it\" to you on Blog post" })).toBe("handoff");
  });

  it("leaves the rest in the Inbox", () => {
    expect(teammatePushReason({ kind: "activity", text: "Justin moved “Blog post” to Review" })).toBeNull();
    expect(teammatePushReason({ kind: "activity", text: "Justin changed the due date on “Blog post”" })).toBeNull();
    expect(teammatePushReason({ kind: "activity", text: "Justin completed \"Write it\" on Blog post" })).toBeNull();
    expect(teammatePushReason({ kind: "activity", text: "Justin moved Blog post up: client asked" })).toBeNull();
  });
});

describe("teammatePush", () => {
  const row = (over: Partial<NotificationRowLike>): NotificationRowLike => ({
    id: "n_1", recipient_id: "u_derek", text: "", task_id: null, actor_id: "u_justin", client_id: null, kind: "activity", ...over,
  });

  it("a direct message: the sender's name, opening the thread, one notification per sender", () => {
    expect(teammatePush(row({ kind: "dm", text: "Justin Fox sent you a message" }), { actorName: "Justin Fox" })).toEqual({
      title: "Justin Fox", body: "Justin Fox sent you a message", url: "/?view=inbox&dm=u_justin", tag: "dm:u_justin",
    });
  });

  it("a mention on a task: the client's name and the task link", () => {
    expect(teammatePush(row({ kind: "message", text: "Justin mentioned you in “Blog post”", task_id: "t_1", client_id: "cl_pam" }), { clientName: "Pam Macias" })).toEqual({
      title: "Pam Macias", body: "Justin mentioned you in “Blog post”", url: "/?client=cl_pam&task=t_1", tag: "task:t_1",
    });
  });

  it("a team chat mention opens that client's chat", () => {
    expect(teammatePush(row({ kind: "message", text: "Justin mentioned you in the team chat", client_id: "cl_pam" }))?.url).toBe("/?client=cl_pam&tab=chat");
  });

  it("nothing for a notification that is not pushed", () => {
    expect(teammatePush(row({ text: "Justin moved “Blog post” to Review", task_id: "t_1" }))).toBeNull();
  });
});

describe("clientWrotePush and claudeFinishedPush", () => {
  it("the client wrote: the bell's line under the client's name", () => {
    expect(clientWrotePush({ text: "Pam Macias sent a text: Can we move it?", taskId: "t_9", clientId: "cl_pam", clientName: "Pam Macias" })).toEqual({
      title: "Pam Macias", body: "Pam Macias sent a text: Can we move it?", url: "/?client=cl_pam&task=t_9", tag: "task:t_9",
    });
  });

  it("the client wrote with no task: the client, one notification per client", () => {
    const p = clientWrotePush({ text: "Pam Macias sent an email: Hello", clientId: "cl_pam" });
    expect(p.url).toBe("/?client=cl_pam");
    expect(p.tag).toBe("client:cl_pam");
    expect(p.title).toBe("ClickUpTasks");
  });

  it("Claude finished: the step on the task, or just the task when they are the same", () => {
    expect(claudeFinishedPush({ stepTitle: "Draft the post", taskTitle: "Facebook ads", taskId: "t_2", clientId: "cl_pam", clientName: "Pam Macias" })).toEqual({
      title: "Pam Macias", body: "Claude finished Draft the post on Facebook ads", url: "/?client=cl_pam&task=t_2", tag: "task:t_2",
    });
    expect(claudeFinishedPush({ stepTitle: "Create blog post", taskTitle: "Create blog post", taskId: "t_3" }).body).toBe("Claude finished Create blog post");
  });
});

describe("parsePushSubscription", () => {
  const sub = (endpoint: string, keys: Record<string, unknown> = { p256dh: P256, auth: AUTH }) => ({ endpoint, keys });

  it("takes a browser's subscription from Apple, Google or Mozilla", () => {
    for (const host of ["web.push.apple.com", "fcm.googleapis.com", "updates.push.services.mozilla.com"]) {
      const r = parsePushSubscription(sub(`https://${host}/abc123`));
      expect(r).toEqual({ ok: true, sub: { endpoint: `https://${host}/abc123`, p256dh: P256, auth: AUTH } });
    }
  });

  it("refuses an endpoint that is not a push service", () => {
    expect(parsePushSubscription(sub("https://evil.example/x")).ok).toBe(false);
    expect(parsePushSubscription(sub("https://web.push.apple.com.evil.example/x")).ok).toBe(false);
    expect(parsePushSubscription(sub("http://web.push.apple.com/x")).ok).toBe(false);
    expect(parsePushSubscription(sub("https://user:pw@web.push.apple.com/x")).ok).toBe(false);
    expect(parsePushSubscription(sub("https://web.push.apple.com:8443/x")).ok).toBe(false);
    expect(parsePushSubscription(sub("not a url")).ok).toBe(false);
    expect(parsePushSubscription(sub("https://web.push.apple.com/" + "a".repeat(1000))).ok).toBe(false);
  });

  it("refuses missing or malformed keys", () => {
    expect(parsePushSubscription({ endpoint: "https://web.push.apple.com/x" }).ok).toBe(false);
    expect(parsePushSubscription(sub("https://web.push.apple.com/x", { p256dh: "short", auth: AUTH })).ok).toBe(false);
    expect(parsePushSubscription(sub("https://web.push.apple.com/x", { p256dh: P256, auth: "has spaces in it!!" })).ok).toBe(false);
    expect(parsePushSubscription(null).ok).toBe(false);
    expect(parsePushSubscription("nope").ok).toBe(false);
  });
});
