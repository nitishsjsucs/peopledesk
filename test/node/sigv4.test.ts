// AWS's published SigV4 example for S3 GET Object (Signature Version 4 documentation, "Example: GET
// Object"), used to check the signer the R2 S3 seeding fallback relies on.
import { describe, expect, it } from "vitest";
import { amzDateOf, sha256Hex, signRequest, uriEncode } from "../../scripts/lib/sigv4.ts";

describe("SigV4 signer", () => {
  it("reproduces the documented GET Object example signature", async () => {
    const emptyHash = await sha256Hex("");
    expect(emptyHash).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    const out = await signRequest({
      method: "GET",
      url: "https://examplebucket.s3.amazonaws.com/test.txt",
      headers: { Range: "bytes=0-9" },
      payloadHash: emptyHash,
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      region: "us-east-1",
      amzDate: "20130524T000000Z",
    });
    expect(out.authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request," +
        "SignedHeaders=host;range;x-amz-content-sha256;x-amz-date," +
        "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
    );
  });

  it("encodes paths and dates the way S3 expects", () => {
    expect(uriEncode("policies/r1-all/POL-014/v03.md", true)).toBe("policies/r1-all/POL-014/v03.md");
    expect(uriEncode("a b$c", false)).toBe("a%20b%24c");
    expect(amzDateOf(new Date("2026-10-08T22:01:02.345Z"))).toBe("20261008T220102Z");
  });
});
