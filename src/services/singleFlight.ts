export function createSingleFlight<T>(task: () => Promise<T>): () => Promise<T> {
  let inFlight: Promise<T> | null = null;

  return () => {
    if (inFlight) return inFlight;
    inFlight = task().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };
}
