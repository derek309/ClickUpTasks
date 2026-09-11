import { describe, it, expect, vi } from "vitest";

// A share link to something in the trash must behave exactly like a link that
// never existed (found 2026-09-11: trashed clients and projects still resolved).
vi.mock("@/lib/supabaseAdmin", async () => ({
  supabaseAdmin: (await import("@/test/fakeSupabase")).fakeSupabaseAdmin,
  adminConfigured: true,
}));

const { resolveWaitingToken } = await import("./waitingToken");
const { resetTables } = await import("@/test/fakeSupabase");

const CLIENT_TOKEN = "client_token_aaaaaaaaaaaa";
const PROJECT_TOKEN = "project_token_bbbbbbbbbbb";
const TRASHED = "2026-09-10T12:00:00Z";

function seed(o: { clientDeleted?: boolean; projectDeleted?: boolean }) {
  resetTables({
    clients: [{
      id: "cl_acme", name: "Acme", share_token: CLIENT_TOKEN, assigned_to: [], linked_contact_id: null,
      can_request_new_tasks: true, show_growth_plan: true, portal_shows_all_tasks: false,
      deleted_at: o.clientDeleted ? TRASHED : null,
    }],
    projects: [{ id: "p_site", client_id: "cl_acme", share_token: PROJECT_TOKEN, deleted_at: o.projectDeleted ? TRASHED : null }],
  });
}

describe("resolveWaitingToken and the trash", () => {
  it("resolves a live client's token", async () => {
    seed({});
    expect(await resolveWaitingToken(CLIENT_TOKEN)).toMatchObject({ clientId: "cl_acme", projectId: null });
  });

  it("resolves a live project's token", async () => {
    seed({});
    expect(await resolveWaitingToken(PROJECT_TOKEN)).toMatchObject({ clientId: "cl_acme", projectId: "p_site" });
  });

  it("rejects a trashed client's token", async () => {
    seed({ clientDeleted: true });
    expect(await resolveWaitingToken(CLIENT_TOKEN)).toBeNull();
  });

  it("rejects a trashed project's token even though its client is live", async () => {
    seed({ projectDeleted: true });
    expect(await resolveWaitingToken(PROJECT_TOKEN)).toBeNull();
  });

  it("rejects a live project's token when its client is trashed", async () => {
    seed({ clientDeleted: true });
    expect(await resolveWaitingToken(PROJECT_TOKEN)).toBeNull();
  });
});
