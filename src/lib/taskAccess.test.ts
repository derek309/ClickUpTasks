import { describe, it, expect, vi } from "vitest";

// canActOnTask, the hand applied row security for service role routes.
// Client visibility itself is extensionApi's job and is faked here.

vi.mock("./serverAuth", () => ({}));
vi.mock("./extensionApi", () => ({ isClientVisible: async (_caller: unknown, clientId: string) => clientId === "cl_mine" }));

const { canActOnTask } = await import("./taskAccess");

const va = { id: "p_va", memberId: "u_va", email: "va@example.com", role: "va" as const, canSendMessages: false };
const admin = { ...va, id: "p_admin", memberId: "u_admin", role: "admin" as const };
const task = (over: Partial<{ client_id: string; assignee_id: string | null; is_private: boolean; deleted_at: string | null }> = {}) =>
  ({ client_id: "cl_mine", assignee_id: "u_someone", is_private: false, deleted_at: null, ...over });

describe("canActOnTask", () => {
  it("refuses a task in the Trash", async () => {
    expect(await canActOnTask(va, task({ deleted_at: "2026-09-01T00:00:00Z" }))).toBe(false);
  });
  it("lets only the assignee act on a private task, admins included", async () => {
    expect(await canActOnTask(va, task({ is_private: true, assignee_id: "u_va" }))).toBe(true);
    expect(await canActOnTask(admin, task({ is_private: true, assignee_id: "u_va" }))).toBe(false);
  });
  it("otherwise follows client visibility", async () => {
    expect(await canActOnTask(va, task())).toBe(true);
    expect(await canActOnTask(va, task({ client_id: "cl_other" }))).toBe(false);
  });
});
