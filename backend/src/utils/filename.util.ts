export function sanitizeFilename(rawFilename: string): string {
  const filename = decodeURIComponent(rawFilename);

  if (
    !filename ||
    filename === "." ||
    filename === ".." ||
    filename.includes("/") ||
    filename.includes("\\") ||
    filename.includes("\0")
  ) {
    throw new Error("Invalid filename");
  }

  return filename;
}
