export async function fetchWithTimeout(
  fetcher: typeof fetch,
  input: URL | RequestInfo,
  init: RequestInit = {},
  timeoutMs = 8_000
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const upstreamSignal = init.signal;
  const forwardAbort = () => controller.abort(upstreamSignal?.reason);

  if (upstreamSignal?.aborted) forwardAbort();
  else upstreamSignal?.addEventListener("abort", forwardAbort, { once: true });

  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const cleanup = () => {
    clearTimeout(timeout);
    upstreamSignal?.removeEventListener("abort", forwardAbort);
  };

  const normalizeError = (error: unknown): never => {
    if (timedOut) throw new Error(`Request timed out after ${timeoutMs}ms`, { cause: error });
    throw error;
  };

  try {
    const response = await fetcher(input, { ...init, signal: controller.signal });
    const bodyMethods = new Set(["arrayBuffer", "blob", "formData", "json", "text"]);
    return new Proxy(response, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, target);
        if (typeof property !== "string" || !bodyMethods.has(property) || typeof value !== "function") {
          return typeof value === "function" ? value.bind(target) : value;
        }
        return async (...args: unknown[]) => {
          try {
            return await value.apply(target, args);
          } catch (error) {
            normalizeError(error);
          } finally {
            cleanup();
          }
        };
      }
    });
  } catch (error) {
    cleanup();
    return normalizeError(error);
  }
}
