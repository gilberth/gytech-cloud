export const CHUNK_CONCURRENCY = 5;

export const retryChunk = async (
  fn: () => Promise<void>,
  retries = 3,
): Promise<void> => {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      await fn();
      return;
    } catch (e) {
      if (attempt === retries - 1) throw e;
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
    }
  }
};
