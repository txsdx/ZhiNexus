/** Public certificate fixtures guard signer identity across legacy and current SDK report formats. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import fs from "node:fs";
import { verifyAndroidCertificateReport } from "./verify-android-certificate.mjs";

const certificate = new X509Certificate(
  fs.readFileSync("src-tauri/mobile/android/release-certificate.der"),
);
const pem = certificate.toString();
const expected = fs
  .readFileSync("src-tauri/mobile/android/release-certificate.sha256", "utf8")
  .trim();

test("SDK signer labels do not affect the standard certificate identity", () => {
  for (const label of ["Signer #1", "V3.0 Signer", "V3.2 Signer"])
    assert.equal(
      verifyAndroidCertificateReport(
        label + ": certificate SHA-256 digest: display text\n" + pem,
        expected,
      ),
      expected,
    );
});
test("human-readable fingerprints alone cannot authorize a package", () => {
  assert.throws(
    () =>
      verifyAndroidCertificateReport(
        "Signer #1 certificate SHA-256 digest: " + expected,
        expected,
      ),
    /exactly one/,
  );
  assert.throws(
    () => verifyAndroidCertificateReport(pem, "0".repeat(64)),
    /differs/,
  );
  assert.throws(
    () => verifyAndroidCertificateReport(pem, "malformed pin"),
    /Invalid pinned/,
  );
});
test("duplicate or damaged signer certificates are rejected", () => {
  assert.throws(
    () => verifyAndroidCertificateReport(pem + "\n" + pem, expected),
    /exactly one/,
  );
  assert.throws(
    () =>
      verifyAndroidCertificateReport(
        "-----BEGIN CERTIFICATE-----\nbroken\n-----END CERTIFICATE-----",
        expected,
      ),
    /Malformed/,
  );
});
