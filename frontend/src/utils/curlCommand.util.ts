export const buildPosixCurlCommand = (uploadUrl: string) =>
  `curl -T "ruta/al/archivo.zip" "${uploadUrl}"`;

export const buildPowerShellCurlCommand = (uploadUrl: string) =>
  `curl.exe --ssl-revoke-best-effort -T "C:\\ruta\\al\\archivo.zip" "${uploadUrl}"`;
