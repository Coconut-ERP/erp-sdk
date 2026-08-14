import { describe, expect, it } from "vitest";
import { ErpClient } from "../src/client";
import {
  parseInitData,
  readInitDataFromLocation,
  sendInitDataToFrame,
} from "../src/webapp";
import { FakeHttp } from "./helpers/http";

const sampleInitData = new URLSearchParams({
  user: JSON.stringify({ id: "u-1", email: "an@corp.vn", displayName: "An" }),
  workspace_id: "ws-1",
  service_account_id: "sa-1",
  auth_date: "1753900000",
  hash: "abc123",
}).toString();

describe("parseInitData", () => {
  it("decodes user, workspace, and audience fields", () => {
    const parsed = parseInitData(sampleInitData);
    expect(parsed.user).toEqual({
      id: "u-1",
      email: "an@corp.vn",
      displayName: "An",
    });
    expect(parsed.workspaceId).toBe("ws-1");
    expect(parsed.serviceAccountId).toBe("sa-1");
    expect(parsed.authDate).toBe(1753900000);
    expect(parsed.hash).toBe("abc123");
  });
});

describe("readInitDataFromLocation", () => {
  it("reads from hash and search", () => {
    const encoded = encodeURIComponent(sampleInitData);
    expect(
      readInitDataFromLocation({ hash: `#erpInitData=${encoded}`, search: "" }),
    ).toBe(sampleInitData);
    expect(
      readInitDataFromLocation({ hash: "", search: `?erpInitData=${encoded}` }),
    ).toBe(sampleInitData);
    expect(readInitDataFromLocation({ hash: "", search: "" })).toBeUndefined();
  });
});

describe("sendInitDataToFrame", () => {
  it("posts the bridge message and refuses wildcard origins", () => {
    const messages: { message: unknown; origin: string }[] = [];
    const target = {
      postMessage: (message: unknown, origin: string) =>
        messages.push({ message, origin }),
    };
    sendInitDataToFrame(target, sampleInitData, "https://miniapp.example.com");
    expect(messages[0]).toEqual({
      message: { type: "erp-miniapp:init-data", initData: sampleInitData },
      origin: "https://miniapp.example.com",
    });
    expect(() =>
      sendInitDataToFrame(target, sampleInitData, "*"),
    ).toThrowError();
  });
});

describe("ErpClient mini app flow", () => {
  it("issues init data for a service account", async () => {
    const http = new FakeHttp({
      "POST /auth/miniapp/init-data": [
        { initData: sampleInitData, expiresIn: 300 },
      ],
    });
    const client = new ErpClient(http);
    const issued = await client.issueInitData("sa-1");
    expect(issued.initData).toBe(sampleInitData);
    expect(http.body(0)).toEqual({ serviceAccountId: "sa-1" });
  });

  it("exchanges init data for a user-scoped client", async () => {
    const http = new FakeHttp({
      "POST /auth/miniapp/session": [
        {
          accessToken: "jwt-user-token",
          tokenType: "Bearer",
          expiresIn: 900,
          user: { id: "u-1", email: "an@corp.vn" },
        },
      ],
    });
    const client = new ErpClient(http, [], {
      baseUrl: "https://erp.example.com",
      apiKey: "erp_sk_test",
    });

    const {
      user,
      client: userClient,
      expiresIn,
    } = await client.session(sampleInitData);
    expect(user.id).toBe("u-1");
    expect(expiresIn).toBe(900);
    expect(userClient).not.toBe(client);
    expect(http.body(0)).toEqual({ initData: sampleInitData });
  });
});
