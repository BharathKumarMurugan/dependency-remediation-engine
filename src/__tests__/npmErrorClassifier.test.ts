import { classifyNpmError } from "../runner/npmErrorClassifier";

describe("npmErrorClassifier", () => {
  it("should classify broken npm installation errors correctly", () => {
    const error = classifyNpmError("npm: command not found");
    expect(error).not.toBeNull();
    expect(error?.category).toBe("BROKEN_NPM_INSTALL");
  });

  it("should classify no compatible version found errors correctly", () => {
    expect(classifyNpmError("npm ERR! code ETARGET")?.category).toBe("NO_COMPATIBLE_VERSION");
    expect(classifyNpmError("npm ERR! notarget No matching version found")?.category).toBe("NO_COMPATIBLE_VERSION");
  });

  it("should classify permission EACCES / EPERM errors correctly", () => {
    expect(classifyNpmError("npm ERR! Error: EACCES: permission denied")?.category).toBe("PERMISSION_ERROR");
    expect(classifyNpmError("npm ERR! Error: EPERM: operation not permitted")?.category).toBe("PERMISSION_ERROR");
  });

  it("should classify disk space ENOSPC errors correctly", () => {
    expect(classifyNpmError("npm ERR! Error: ENOSPC: no space left on device, write")?.category).toBe(
      "NO_SPACE_ENOSPC"
    );
  });

  it("should classify git missing ENOGIT errors correctly", () => {
    expect(classifyNpmError("npm ERR! not found: git ENOGIT")?.category).toBe("NO_GIT_ENOGIT");
  });

  it("should classify SSL certificate errors correctly", () => {
    expect(classifyNpmError("npm ERR! Error: SSL Error: CERT_UNTRUSTED")?.category).toBe("SSL_ERROR");
    expect(classifyNpmError("npm ERR! Error: SSL Error: UNABLE_TO_VERIFY_LEAF_SIGNATURE")?.category).toBe(
      "SSL_ERROR"
    );
  });

  it("should classify registry 404 / 500 / fetch failed server errors correctly", () => {
    expect(classifyNpmError("npm ERR! fetch failed")?.category).toBe("REGISTRY_SERVER_ERROR");
    expect(classifyNpmError("npm ERR! Error: 404 Not Found")?.category).toBe("REGISTRY_SERVER_ERROR");
    expect(classifyNpmError("npm http 500 https://registry.npmjs.org/phonegap")?.category).toBe(
      "REGISTRY_SERVER_ERROR"
    );
  });

  it("should classify invalid JSON errors correctly", () => {
    expect(classifyNpmError("SyntaxError: Unexpected token } in JSON at position 12")?.category).toBe(
      "INVALID_JSON"
    );
  });

  it("should classify ENOENT / ENOEMPTY errors correctly", () => {
    expect(classifyNpmError("npm ERR! Error: ENOENT: no such file or directory")?.category).toBe(
      "ENOENT_ENOEMPTY"
    );
  });
});
