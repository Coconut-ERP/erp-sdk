import { describe, expect, it } from "vitest";
import { ErpClient } from "../src/client";
import {
  DryRunUnsupportedError,
  UnknownWorkflowError,
  WorkflowDefinitionError,
  WorkflowRunFailedError,
  WorkflowRunTimeoutError,
} from "../src/errors";
import type { Http, HttpOptions } from "../src/http";
import type { WorkflowDto, WorkflowRunDto } from "../src/types";
import {
  isRunFinished,
  runLogs,
  runResult,
  WorkflowsApi,
  WORKFLOW_ENV_KEEP,
} from "../src/workflows";

const CODE = "async function main(input) { return input }";

function workflow(overrides: Partial<WorkflowDto> = {}): WorkflowDto {
  return {
    id: "wf-1",
    workspaceId: "ws-1",
    name: "Nhắc đơn quá hạn",
    description: "",
    status: "active",
    visibility: "workspace",
    trigger: { type: "manual" },
    code: CODE,
    env: { SMTP_PASSWORD: "***" },
    version: 2,
    createdBy: "u",
    updatedBy: "u",
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

function run(overrides: Partial<WorkflowRunDto> = {}): WorkflowRunDto {
  return {
    id: "run-1",
    status: "ENQUEUED",
    attempts: 0,
    queueName: "workflow",
    applicationVersion: "2",
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

interface Call {
  method: string;
  path: string;
  options?: HttpOptions;
}

class FakeHttp implements Http {
  calls: Call[] = [];
  constructor(private readonly responses: Record<string, unknown[]>) {}

  async request<T>(method: string, path: string, options?: HttpOptions): Promise<T> {
    this.calls.push({ method, path, options });
    const queue = this.responses[`${method} ${path}`];
    if (!queue || queue.length === 0) {
      throw new Error(`Unexpected request: ${method} ${path}`);
    }
    return queue.shift() as T;
  }
}

describe("workflow definition checks", () => {
  it("rejects trigger types the backend does not have", async () => {
    const api = new WorkflowsApi(new FakeHttp({}));
    await expect(
      api.create({ name: "x", code: CODE, trigger: { type: "webhook" } }),
    ).rejects.toBeInstanceOf(WorkflowDefinitionError);
  });

  it("rejects a five-field cron, because the scheduler wants seconds", async () => {
    const api = new WorkflowsApi(new FakeHttp({}));
    await expect(
      api.create({
        name: "x",
        code: CODE,
        trigger: {
          type: "cron",
          config: { schedule: "0 9 * * *", timezone: "Asia/Ho_Chi_Minh" },
        },
      }),
    ).rejects.toThrow(/6 \(seconds first\)/);
  });

  it("accepts a six-field cron and a descriptor", async () => {
    const http = new FakeHttp({ "POST /workflows": [workflow(), workflow()] });
    const api = new WorkflowsApi(http);
    for (const schedule of ["0 0 9 * * *", "@every 1h"]) {
      await api.create({
        name: "x",
        code: CODE,
        trigger: { type: "cron", config: { schedule, timezone: "Asia/Ho_Chi_Minh" } },
      });
    }
    expect(http.calls).toHaveLength(2);
  });

  it("rejects code without a main() before the round trip", async () => {
    const http = new FakeHttp({});
    await expect(
      new WorkflowsApi(http).create({
        name: "x",
        code: "export default async () => 1",
        trigger: { type: "manual" },
      }),
    ).rejects.toBeInstanceOf(WorkflowDefinitionError);
    expect(http.calls).toHaveLength(0);
  });

  it("rejects env names the server would refuse", async () => {
    const handle = await new WorkflowsApi(
      new FakeHttp({ "POST /workflows": [workflow()] }),
    ).create({ name: "x", code: CODE, trigger: { type: "manual" } });
    await expect(handle.setEnv({ "BOT-TOKEN": "x" })).rejects.toThrow(
      /not a valid name/,
    );
  });
});

describe("WorkflowsApi", () => {
  it("resolves a workflow by name, case-insensitively, then reads its code", async () => {
    const http = new FakeHttp({
      "GET /workflows": [[workflow()]],
      "GET /workflows/wf-1": [workflow()],
    });
    const handle = await new WorkflowsApi(http).handle("nhắc đơn quá hạn");
    expect(handle.id).toBe("wf-1");
    expect(handle.code).toBe(CODE);
    expect(handle.isPublished).toBe(true);
  });

  it("names the known workflows when the name is wrong", async () => {
    const http = new FakeHttp({ "GET /workflows": [[workflow()]] });
    await expect(new WorkflowsApi(http).handle("Nhac don")).rejects.toBeInstanceOf(
      UnknownWorkflowError,
    );
  });

  it("walks offsets until a page is short", async () => {
    const http = new FakeHttp({
      "GET /workflows": [
        [workflow({ id: "a" }), workflow({ id: "b" })],
        [workflow({ id: "c" })],
      ],
    });
    const all = await new WorkflowsApi(http).listAll({ pageSize: 2 });
    expect(all.map((w) => w.id)).toEqual(["a", "b", "c"]);
    expect(http.calls[1]?.options?.query).toEqual({ limit: 2, offset: 2 });
  });
});

describe("WorkflowHandle", () => {
  it("sends the current version on update, publish and delete", async () => {
    const http = new FakeHttp({
      "GET /workflows": [[workflow()]],
      "GET /workflows/wf-1": [workflow()],
      "PUT /workflows/wf-1": [workflow({ version: 3, status: "draft" })],
      "POST /workflows/wf-1/publish": [workflow({ version: 4 })],
      "DELETE /workflows/wf-1": [{ deleted: true }],
    });
    const handle = await new WorkflowsApi(http).handle("wf-1");

    await handle.update({ code: CODE });
    expect(http.calls[2]?.options?.body).toMatchObject({ version: 2 });
    expect(handle.status).toBe("draft");

    await handle.publish();
    expect(http.calls[3]?.options?.body).toEqual({ version: 3 });

    await handle.delete();
    expect(http.calls[4]?.options?.query).toEqual({ version: 4 });
  });

  it("keeps a secret it cannot read by resending the KEEP sentinel", async () => {
    const http = new FakeHttp({
      "GET /workflows": [[workflow()]],
      "GET /workflows/wf-1": [workflow()],
      "PUT /workflows/wf-1/env": [workflow()],
    });
    const handle = await new WorkflowsApi(http).handle("wf-1");
    expect(handle.envNames).toEqual(["SMTP_PASSWORD"]);

    await handle.setEnv({ SMTP_PASSWORD: WORKFLOW_ENV_KEEP, BOT_TOKEN: "t" });
    expect(http.calls[2]?.options?.body).toEqual({
      env: { SMTP_PASSWORD: "[KEEP]", BOT_TOKEN: "t" },
    });
  });

  it("refuses to start a run in development mode", async () => {
    const http = new FakeHttp({
      "GET /workflows": [[workflow()]],
      "GET /workflows/wf-1": [workflow()],
    });
    const client = new ErpClient(http, [], undefined, "development");
    const handle = await client.workflow("wf-1");
    await expect(handle.run({ a: 1 })).rejects.toBeInstanceOf(DryRunUnsupportedError);
    await expect(handle.run({ a: 1 }, { dryRun: false })).rejects.toThrow(
      /Unexpected request: POST/,
    );
  });

  it("polls until the run finishes and unpacks its output", async () => {
    const finished = run({
      status: "SUCCESS",
      output: JSON.stringify({
        workflowId: "wf-1",
        version: 2,
        result: { sent: 3 },
        logs: ["log: bắt đầu"],
        durationMs: 240,
      }),
    });
    const http = new FakeHttp({
      "GET /workflows": [[workflow()]],
      "GET /workflows/wf-1": [workflow()],
      "POST /workflows/wf-1/runs": [run()],
      "GET /workflows/wf-1/runs/run-1": [run({ status: "PENDING" }), finished],
    });
    const handle = await new WorkflowsApi(http).handle("wf-1");
    const result = await handle.runAndWait({ ngay: "2026-01-01" }, { intervalMs: 1 });

    expect(http.calls[2]?.options?.body).toEqual({ input: { ngay: "2026-01-01" } });
    expect(runResult<{ sent: number }>(result)?.sent).toBe(3);
    expect(runLogs(result)).toEqual(["log: bắt đầu"]);
  });

  it("throws what the script threw when a run ends in ERROR", async () => {
    const http = new FakeHttp({
      "GET /workflows": [[workflow()]],
      "GET /workflows/wf-1": [workflow()],
      "GET /workflows/wf-1/runs/run-1": [
        run({ status: "ERROR", error: "boom [log: before boom]" }),
      ],
    });
    const handle = await new WorkflowsApi(http).handle("wf-1");
    await expect(handle.waitForRun("run-1", { intervalMs: 1 })).rejects.toBeInstanceOf(
      WorkflowRunFailedError,
    );
  });

  it("times out without pretending the run stopped", async () => {
    const http = new FakeHttp({
      "GET /workflows": [[workflow()]],
      "GET /workflows/wf-1": [workflow()],
      "GET /workflows/wf-1/runs/run-1": [run(), run()],
    });
    const handle = await new WorkflowsApi(http).handle("wf-1");
    await expect(
      handle.waitForRun("run-1", { intervalMs: 1, timeoutMs: 0 }),
    ).rejects.toBeInstanceOf(WorkflowRunTimeoutError);
  });
});

describe("run status helpers", () => {
  it("treats only queued and executing states as unfinished", () => {
    expect(isRunFinished("ENQUEUED")).toBe(false);
    expect(isRunFinished("PENDING")).toBe(false);
    expect(isRunFinished("SUCCESS")).toBe(true);
    expect(isRunFinished("ERROR")).toBe(true);
  });

  it("survives an output that is not the JSON it expects", () => {
    expect(runResult(run({ output: "not json" }))).toBeUndefined();
    expect(runLogs(run())).toEqual([]);
  });
});
