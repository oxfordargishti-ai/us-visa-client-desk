import { describe, it, expect } from "vitest";
import { storageError } from "@/lib/storage";

describe("storage error messages", () => {
  it("explains wrong keys without leaking them", () => {
    const e = storageError({ name: "SignatureDoesNotMatch", message: "sig mismatch", $metadata: { httpStatusCode: 403 } });
    expect(e.name).toBe("StorageError");
    expect(e.message).toMatch(/keys don't match/);
  });
  it("explains a key without bucket permission", () => {
    expect(storageError({ name: "AccessDenied", $metadata: { httpStatusCode: 403 } }).message).toMatch(/Object Read & Write/);
  });
  it("explains a wrong bucket name", () => {
    expect(storageError({ name: "NoSuchBucket", $metadata: { httpStatusCode: 404 } }).message).toMatch(/S3_BUCKET/);
  });
  it("explains an unreachable endpoint", () => {
    expect(storageError(new Error("getaddrinfo ENOTFOUND x.r2.cloudflarestorage.com")).message).toMatch(/S3_ENDPOINT/);
  });
});
