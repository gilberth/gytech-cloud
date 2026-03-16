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

export const formatEta = (seconds: number): string => {
  if (!isFinite(seconds) || seconds <= 0) return "";
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = Math.ceil(seconds % 60);
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.ceil((seconds % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
};

export const calculateEta = (
  bytesLoaded: number,
  totalBytes: number,
  startTime: number,
): number => {
  const elapsed = (Date.now() - startTime) / 1000;
  if (elapsed < 1 || bytesLoaded <= 0) return Infinity;
  const speed = bytesLoaded / elapsed;
  return (totalBytes - bytesLoaded) / speed;
};
