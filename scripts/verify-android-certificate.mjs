/** Compare the verified APK's PEM certificate with the pinned DER identity, independently of SDK report labels. */
import fs from "node:fs";
import { createHash, X509Certificate } from "node:crypto";
import { pathToFileURL } from "node:url";

/** Call after apksigner verify succeeds; reject absent, multiple, malformed or unexpected signer certificates. */
export function verifyAndroidCertificateReport(report, expected) {
  if (!/^[a-f0-9]{64}$/.test(expected))
    throw Error("Invalid pinned Android certificate digest");
  const certificates =
    report.match(
      /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g,
    ) ?? [];
  if (certificates.length !== 1)
    throw Error("Expected exactly one verified Android signing certificate");
  let certificate;
  try {
    certificate = new X509Certificate(certificates[0]);
  } catch {
    throw Error("Malformed Android signing certificate");
  }
  const actual = createHash("sha256").update(certificate.raw).digest("hex");
  if (actual !== expected)
    throw Error("The APK signer differs from the pinned release certificate");
  return actual;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const report = fs.readFileSync(process.argv[2], "utf8");
    const expected = fs.readFileSync(process.argv[3], "utf8").trim();
    console.log(
      "Verified fixed Android APK certificate: " +
        verifyAndroidCertificateReport(report, expected),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
