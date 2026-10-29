/** Signing configuration fails safely and passes secret material only through stdin, never command arguments. */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse } from "yaml";
import {
  androidSigningValues,
  configureAndroidSigning,
} from "./setup-android-signing.mjs";
const values = {
  ANDROID_KEYSTORE_BASE64: Buffer.alloc(1200, 7).toString("base64"),
  ANDROID_KEY_ALIAS: "fixture-alias",
  ANDROID_KEYSTORE_PASSWORD: "fixture-store-password",
  ANDROID_KEY_PASSWORD: "fixture-key-password",
};
test("missing or malformed values cannot become a partially configured signing identity", () => {
  assert.throws(
    () => androidSigningValues({ ...values, ANDROID_KEYSTORE_PASSWORD: "" }),
    /four/,
  );
  assert.throws(
    () =>
      androidSigningValues({ ...values, ANDROID_KEYSTORE_BASE64: "invalid!" }),
    /Invalid/,
  );
});
test("all values travel through stdin and permission failures never echo private values", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "zhinexus-signing-")),
    file = path.join(directory, "secrets.json"),
    calls = [];
  fs.writeFileSync(file, JSON.stringify(values));
  try {
    configureAndroidSigning(file, "owner/repo", (name, args, options) => {
      calls.push({ name, args, input: options.input });
      return { status: 0 };
    });
    assert.equal(calls.length, 4);
    for (const call of calls) {
      assert.equal(call.name, "gh");
      assert.equal(call.args.includes(call.input), false);
    }
    assert.throws(
      () =>
        configureAndroidSigning(file, "owner/repo", () => ({
          status: 1,
          stderr: "fixture-store-password",
        })),
      (error) =>
        error.message.includes("Secrets write permission") &&
        !error.message.includes(values.ANDROID_KEYSTORE_PASSWORD),
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
test("missing signing secrets fail before the expensive shared frontend stage", () => {
  const workflow = parse(
    fs.readFileSync(".github/workflows/build.yml", "utf8"),
  );
  assert.equal(workflow.jobs.frontend.needs, "signing");
  assert.ok(
    workflow.jobs.signing.steps.some(
      (step) => step.run === "bash scripts/android-sign.sh --check",
    ),
  );
});

test("malformed private JSON is rejected without echoing any source text", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "zhinexus-signing-"));
  const file = path.join(directory, "broken.json");
  fs.writeFileSync(file, '{"private":"fixture-secret-never-echo",broken}');
  try {
    assert.throws(
      () => configureAndroidSigning(file),
      (error) =>
        error.message.includes("JSON format") &&
        !error.message.includes("fixture-secret-never-echo"),
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
test(
  "actual signing preflight unlocks a stable key, rejects wrong passwords and certificate rotation, and cleans temporary material",
  { skip: !!spawnSync("keytool", ["-help"]).error },
  () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "zhinexus-key-test-"),
    );
    const certificateDirectory = path.join(
      directory,
      "src-tauri/mobile/android",
    );
    const runner = path.join(directory, "runner");
    fs.mkdirSync(certificateDirectory, { recursive: true });
    fs.mkdirSync(runner);
    const env = {
      ...process.env,
      RUNNER_TEMP: runner,
      KEY_ALIAS: "fixture",
      KEYSTORE_PASSWORD: "fixture-password-only",
      KEY_PASSWORD: "fixture-password-only",
    };
    const key = path.join(directory, "fixture.p12");
    const certificate = path.join(directory, "fixture.der");
    const runKeytool = (args) => {
      const result = spawnSync("keytool", args, { env, encoding: "utf8" });
      assert.equal(result.status, 0, "Fixture keytool operation failed");
    };
    try {
      runKeytool([
        "-genkeypair",
        "-keystore",
        key,
        "-storetype",
        "PKCS12",
        "-storepass:env",
        "KEYSTORE_PASSWORD",
        "-keypass:env",
        "KEY_PASSWORD",
        "-alias",
        "fixture",
        "-keyalg",
        "RSA",
        "-keysize",
        "2048",
        "-validity",
        "2",
        "-dname",
        "CN=Test Fixture",
      ]);
      runKeytool([
        "-exportcert",
        "-keystore",
        key,
        "-storepass:env",
        "KEYSTORE_PASSWORD",
        "-alias",
        "fixture",
        "-file",
        certificate,
      ]);
      const hash = createHash("sha256")
        .update(fs.readFileSync(certificate))
        .digest("hex");
      const pin = path.join(certificateDirectory, "release-certificate.sha256");
      fs.writeFileSync(pin, hash);
      env.KEYSTORE_BASE64 = fs.readFileSync(key).toString("base64");
      const check = (overrides = {}) =>
        spawnSync(
          "bash",
          [path.resolve("scripts/android-sign.sh"), "--check"],
          { cwd: directory, env: { ...env, ...overrides }, encoding: "utf8" },
        );
      assert.equal(check().status, 0);
      assert.equal(
        check().status,
        0,
        "The same key must be reusable across builds",
      );
      assert.notEqual(check({ KEY_PASSWORD: "wrong-password" }).status, 0);
      assert.notEqual(check({ KEYSTORE_PASSWORD: "wrong-password" }).status, 0);
      assert.notEqual(check({ KEYSTORE_BASE64: "" }).status, 0);
      fs.writeFileSync(pin, "0".repeat(64));
      assert.notEqual(
        check().status,
        0,
        "A different signing identity must be rejected",
      );
      assert.deepEqual(
        fs.readdirSync(runner),
        [],
        "Private key and CSR must be cleaned on success and failure",
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  },
);
