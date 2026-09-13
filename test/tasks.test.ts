import { describe, expect, it } from "vitest";
import { ErpClient } from "../src/client";
import {
  DryRunUnsupportedError,
  ErpApiError,
  TaskBoardError,
  UnknownTaskError,
} from "../src/errors";
import { TaskBoardApi } from "../src/tasks";
import type { TaskBoardDto, TaskDto } from "../src/types";
import { FakeHttp } from "./helpers/http";

function board(overrides: Partial<TaskBoardDto> = {}): TaskBoardDto {
  return {
    id: "b-1",
    workspaceId: "ws-1",
    ownerId: "u-1",
    name: "My board",
    description: "",
    createdBy: { id: "u-1", type: "user" },
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

function task(overrides: Partial<TaskDto> = {}): TaskDto {
  return {
    id: "t-1",
    boardId: "b-1",
    workspaceId: "ws-1",
    title: "Hàng chậm luân chuyển — tháng 8",
    description: "",
    status: "todo",
    priority: "medium",
    assignedTo: null,
    createdBy: { id: "u-1", type: "user" },
    tags: [],
    metadata: {},
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

describe("TaskBoardApi", () => {
  it("finds the caller's board once and reuses its id", async () => {
    const http = new FakeHttp({
      "GET /ai-task/boards": [[board()]],
      "GET /ai-task/boards/b-1": [
        {
          ...board(),
          taskCounts: { todo: 1, in_progress: 0, review: 0, done: 0 },
        },
      ],
      "POST /ai-task/boards/b-1/tasks": [task()],
    });
    const tasks = new TaskBoardApi(http);

    const detail = await tasks.board();
    await tasks.create({ title: "Hàng chậm luân chuyển — tháng 8" });

    expect(detail.taskCounts.todo).toBe(1);
    expect(
      http.calls.filter((call) => call.path === "/ai-task/boards"),
    ).toHaveLength(1);
  });

  it("sends the server's shape for assignee, tags and due date", async () => {
    const http = new FakeHttp({
      "GET /ai-task/boards": [[board()]],
      "POST /ai-task/boards/b-1/tasks": [task()],
    });

    await new TaskBoardApi(http).create({
      title: "Báo cáo tồn kho",
      status: "review",
      assignee: { type: "user", id: "u-1" },
      dueDate: new Date("2026-09-20T10:00:00Z"),
      tags: ["inventory-analysis", { name: "kho", color: "#F59E0B" }],
      actor: { type: "agent", id: "agent-1" },
    });

    expect(http.body(1)).toMatchObject({
      title: "Báo cáo tồn kho",
      status: "review",
      assignedTo: "u-1",
      assignedToType: "user",
      dueDate: "2026-09-20T10:00:00.000Z",
      tags: [{ name: "inventory-analysis" }, { name: "kho", color: "#F59E0B" }],
      actor: { type: "agent", id: "agent-1" },
    });
  });

  it("refuses what the server would reject, before any request", async () => {
    const http = new FakeHttp({});
    const tasks = new TaskBoardApi(http);

    await expect(
      tasks.create({ title: "x", dueDate: "2026-09-20" }),
    ).rejects.toBeInstanceOf(TaskBoardError);
    await expect(
      tasks.create({ title: "x", actor: { type: "agent" } }),
    ).rejects.toBeInstanceOf(TaskBoardError);
    await expect(
      tasks.create({ title: "x", tags: [{ name: "kho", color: "orange" }] }),
    ).rejects.toBeInstanceOf(TaskBoardError);
    await expect(
      tasks.create({
        title: "x",
        tags: Array.from({ length: 51 }, (_, i) => `tag-${i}`),
      }),
    ).rejects.toBeInstanceOf(TaskBoardError);
    await expect(tasks.update("t-1", {})).rejects.toBeInstanceOf(
      TaskBoardError,
    );
    await expect(
      tasks.setStatus("t-1", "closed" as never),
    ).rejects.toBeInstanceOf(TaskBoardError);
    expect(http.calls).toHaveLength(0);
  });

  it("filters by assignee and walks every page", async () => {
    const http = new FakeHttp(
      {
        "GET /ai-task/boards": [[board()]],
        "GET /ai-task/boards/b-1/tasks": [
          [task({ id: "a" })],
          [task({ id: "b" })],
        ],
      },
      { page: 1, perPage: 1, totalItems: 2, totalPages: 2 },
    );

    const all = await new TaskBoardApi(http).listAll({
      perPage: 1,
      assignee: { type: "agent", id: "agent-1" },
      tag: "inventory-analysis",
    });

    expect(all.map((t) => t.id)).toEqual(["a", "b"]);
    expect(http.calls[2]?.options.query).toMatchObject({
      assignedTo: "agent-1",
      assignedToType: "agent",
      tag: "inventory-analysis",
      page: 2,
    });
  });

  it("turns a 404 on a task into UnknownTaskError", async () => {
    const http = new FakeHttp({
      "GET /ai-task/tasks/t-other": [new ErpApiError(404, "not found")],
    });

    await expect(new TaskBoardApi(http).get("t-other")).rejects.toBeInstanceOf(
      UnknownTaskError,
    );
  });

  it("unassigns with an empty body and encodes a tag name", async () => {
    const http = new FakeHttp({
      "PATCH /ai-task/tasks/t-1/assign": [task()],
      "DELETE /ai-task/tasks/t-1/tags/kho%20A": [null],
    });
    const tasks = new TaskBoardApi(http);

    await tasks.assign("t-1", null);
    await tasks.removeTag("t-1", "kho A");

    expect(http.body(0)).toEqual({});
    expect(http.calls[1]?.path).toBe("/ai-task/tasks/t-1/tags/kho%20A");
  });

  it("refuses to delete during a rehearsal unless told otherwise", async () => {
    const http = new FakeHttp({ "DELETE /ai-task/tasks/t-1": [null] });
    const tasks = new TaskBoardApi(http, { dryRun: true });

    await expect(tasks.delete("t-1")).rejects.toBeInstanceOf(
      DryRunUnsupportedError,
    );
    await expect(tasks.deleteComment("t-1", "c-1")).rejects.toBeInstanceOf(
      DryRunUnsupportedError,
    );
    await tasks.delete("t-1", { dryRun: false });
    expect(http.calls).toHaveLength(1);
  });

  it("stops a service account key before it reaches the server", async () => {
    const http = new FakeHttp({ "GET /ai-task/boards": [[board()]] });
    const app = new ErpClient(http, [], {
      baseUrl: "https://erp.example.com",
      apiKey: "erp_sk_test",
    });
    const member = new ErpClient(http, [], {
      baseUrl: "https://erp.example.com",
      apiKey: "erp_uk_test",
    });

    await expect(app.tasks.list()).rejects.toBeInstanceOf(TaskBoardError);
    expect(http.calls).toHaveLength(0);

    await member.tasks.list().catch(() => undefined);
    expect(http.calls[0]?.path).toBe("/ai-task/boards");
  });
});
