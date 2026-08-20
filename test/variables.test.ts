import { describe, expect, it } from "vitest";
import { ErpClient } from "../src/client";
import {
  DryRunUnsupportedError,
  ErpApiError,
  UnknownWorkflowVariableError,
  WorkflowDefinitionError,
} from "../src/errors";
import type { WorkflowVariableDto } from "../src/types";
import { WorkflowVariablesApi } from "../src/variables";
import { FakeHttp } from "./helpers/http";

function variable(
  overrides: Partial<WorkflowVariableDto> = {},
): WorkflowVariableDto {
  return {
    id: "var-1",
    key: "invoice.cursor",
    value: "2026-08-01",
    description: "Hoá đơn đã đồng bộ tới đâu",
    workflowIds: ["wf-1"],
    createdBy: "u",
    updatedBy: "u",
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

const notFound = () => new ErpApiError(404, "Workflow variable not found");

describe("shared variables", () => {
  it("reads a value, and answers undefined for a first run", async () => {
    const http = new FakeHttp({
      "GET /workflows/variables/invoice.cursor": [variable(), notFound()],
    });
    const api = new WorkflowVariablesApi(http);

    expect(await api.value("invoice.cursor")).toBe("2026-08-01");
    expect(await api.value("invoice.cursor")).toBeUndefined();
  });

  it("names both causes when a key cannot be read", async () => {
    const http = new FakeHttp({
      "GET /workflows/variables/invoice.cursor": [notFound()],
    });
    const api = new WorkflowVariablesApi(http);

    await expect(api.get("invoice.cursor")).rejects.toBeInstanceOf(
      UnknownWorkflowVariableError,
    );
    await expect(api.get("invoice.cursor")).rejects.toThrow(/was not granted/);
  });

  it("sets a value without touching the access list", async () => {
    const http = new FakeHttp({
      "PUT /workflows/variables/invoice.cursor": [
        variable({ value: "2026-08-20" }),
      ],
    });
    const api = new WorkflowVariablesApi(http);

    const updated = await api.set("invoice.cursor", "2026-08-20");
    expect(updated.value).toBe("2026-08-20");
    expect(http.body()).toEqual({ value: "2026-08-20" });
  });

  it("keeps a key that would 400 out of the round trip", async () => {
    const api = new WorkflowVariablesApi(new FakeHttp({}));
    for (const key of ["1cursor", "invoice cursor", "hoá-đơn", ""]) {
      await expect(api.value(key)).rejects.toBeInstanceOf(
        WorkflowDefinitionError,
      );
    }
    await expect(api.set("invoice.cursor", "x".repeat(16_385))).rejects.toThrow(
      /at most 16384/,
    );
  });

  it("catches an update that carries nothing", async () => {
    const api = new WorkflowVariablesApi(new FakeHttp({}));
    await expect(api.update("invoice.cursor", {})).rejects.toBeInstanceOf(
      WorkflowDefinitionError,
    );
  });

  it("escapes the key it puts in the path", async () => {
    const http = new FakeHttp({
      "GET /workflows/variables/a.b-c_d": [variable({ key: "a.b-c_d" })],
    });
    await new WorkflowVariablesApi(http).get("a.b-c_d");
    expect(http.calls[0]?.path).toBe("/workflows/variables/a.b-c_d");
  });

  it("declares a variable with the workflows allowed to reach it", async () => {
    const http = new FakeHttp({
      "POST /workflows/variables": [
        variable({ workflowIds: ["wf-1", "wf-2"] }),
      ],
    });
    const api = new WorkflowVariablesApi(http);

    await api.create({
      key: "invoice.cursor",
      description: "Hoá đơn đã đồng bộ tới đâu",
      workflowIds: ["wf-1", "wf-2"],
    });
    expect(http.body()).toEqual({
      key: "invoice.cursor",
      value: "",
      description: "Hoá đơn đã đồng bộ tới đâu",
      workflowIds: ["wf-1", "wf-2"],
    });
  });

  it("refuses more workflows than one variable may be shared with", async () => {
    const api = new WorkflowVariablesApi(new FakeHttp({}));
    await expect(
      api.create({
        key: "cursor",
        workflowIds: Array.from({ length: 101 }, (_, i) => `wf-${i}`),
      }),
    ).rejects.toThrow(/at most 100/);
  });

  it("refuses to write during a rehearsal rather than move the cursor", async () => {
    const http = new FakeHttp({
      "GET /workflows/variables/invoice.cursor": [variable()],
      "PUT /workflows/variables/invoice.cursor": [variable()],
    });
    const api = new WorkflowVariablesApi(http, { dryRun: true });

    expect(await api.value("invoice.cursor")).toBe("2026-08-01");
    await expect(
      api.set("invoice.cursor", "2026-08-20"),
    ).rejects.toBeInstanceOf(DryRunUnsupportedError);
    await expect(api.delete("invoice.cursor")).rejects.toBeInstanceOf(
      DryRunUnsupportedError,
    );
    expect(
      await api.set("invoice.cursor", "2026-08-20", { dryRun: false }),
    ).toBeTruthy();
  });

  it("rides on the client, in the client's mode", async () => {
    const http = new FakeHttp({
      "PUT /workflows/variables/cursor": [variable({ key: "cursor" })],
    });
    const production = new ErpClient(http, [], { baseUrl: "", apiKey: "" });
    await production.variables.set("cursor", "1");

    const development = production.development();
    await expect(
      development.variables.set("cursor", "2"),
    ).rejects.toBeInstanceOf(DryRunUnsupportedError);
  });
});
