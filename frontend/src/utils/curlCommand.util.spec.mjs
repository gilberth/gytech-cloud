import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildPosixCurlCommand,
  buildPowerShellCurlCommand,
} from "./curlCommand.util.ts";

const uploadUrl = "https://files.example.test/api/upload/token/";

test("builds a POSIX command with an explicit file path placeholder", () => {
  assert.equal(
    buildPosixCurlCommand(uploadUrl),
    'curl -T "ruta/al/archivo.zip" "https://files.example.test/api/upload/token/"',
  );
});

test("builds a PowerShell command with the Windows revocation workaround", () => {
  assert.equal(
    buildPowerShellCurlCommand(uploadUrl),
    'curl.exe --ssl-revoke-best-effort -T "C:\\ruta\\al\\archivo.zip" "https://files.example.test/api/upload/token/"',
  );
});
