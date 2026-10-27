/** Credential projection and program execution consent regressions. */
import { describe, expect, it } from "vitest";
import {
  connectionsFrom,
  importedConnections,
  synchronizedCredentials,
} from "./credentials";
import { defaultDevice } from "./defaults";
import type { McpConfig } from "./types";
const program: McpConfig = {
  id: "stdio",
  name: "Local",
  url: "",
  transport: "stdio",
  command: "fixture",
  args: ["serve"],
  env: { TOKEN: "secret" },
  token: "",
  enabled: true,
};
describe("shared credential boundaries", () => {
  it("selects connections without device reminders, proxy, schedules or synchronization key", () => {
    expect(
      connectionsFrom({
        ...defaultDevice,
        notifications: true,
        syncMinutes: 42,
        apiKeySyncKey: "private",
      }),
    ).toEqual({ davUrl: "", davUser: "", davPassword: "", mcp: [] });
  });
  it("never enables downloaded or changed local programs", () => {
    const shared = { ...connectionsFrom(defaultDevice), mcp: [program] };
    expect(importedConnections(shared, []).mcp[0].enabled).toBe(false);
    expect(
      importedConnections(shared, [{ ...program, enabled: false }]).mcp[0]
        .enabled,
    ).toBe(false);
    expect(
      importedConnections(shared, [{ ...program, command: "different" }]).mcp[0]
        .enabled,
    ).toBe(false);
    expect(
      importedConnections(shared, [{ ...program, env: { TOKEN: "different" } }])
        .mcp[0].enabled,
    ).toBe(false);
    expect(importedConnections(shared, [program]).mcp[0].enabled).toBe(true);
    expect(program.enabled).toBe(true);
  });
  it("continues to validate original API-only payloads", () => {
    expect(
      synchronizedCredentials.parse({
        apiKey: "old-key",
        baseUrl: "https://ai.example/v1",
      }),
    ).toEqual({ apiKey: "old-key", baseUrl: "https://ai.example/v1" });
    expect(() =>
      synchronizedCredentials.parse({
        apiKey: null,
        baseUrl: "https://ai.example",
      }),
    ).toThrow();
  });
});
