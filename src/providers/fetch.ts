export async function fetchWithTimeout(
  fetcher: typeof fetch,
  input: URL | RequestInfo,
  init: RequestInit = {},
  timeoutMs = 8_000
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  let released = false;
  let draining = false;
  const upstreamSignal = init.signal;
  const forwardAbort = () => controller.abort(upstreamSignal?.reason);

  if (upstreamSignal?.aborted) forwardAbort();
  else upstreamSignal?.addEventListener("abort", forwardAbort, { once: true });

  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  // 定时器不应阻止进程退出（否则 node --test 跑完后可能被挂住）。
  unrefTimer(timeout);

  const release = () => {
    if (released) return;
    released = true;
    clearTimeout(timeout);
    upstreamSignal?.removeEventListener("abort", forwardAbort);
  };

  // 非 ok 响应：各 provider 都是 `if (!response.ok) throw`，既不读 body 也不消费它，
  // 于是超时定时器会一直挂到 timeoutMs，错误响应体也永远不被排空（连接被占住）。
  // 这里主动排空并释放——当前没有任何调用方会去读非 ok 的响应体。
  const drain = (response: Response): void => {
    const read = (response as Partial<Pick<Response, "arrayBuffer">>).arrayBuffer;
    if (typeof read !== "function") {
      release();
      return;
    }
    void read
      .call(response)
      .catch(() => undefined)
      .finally(release);
  };

  const normalizeError = (error: unknown): never => {
    if (timedOut) throw new Error(`Request timed out after ${timeoutMs}ms`, { cause: error });
    throw error;
  };

  try {
    const response = await fetcher(input, { ...init, signal: controller.signal });
    const bodyMethods = new Set(["arrayBuffer", "blob", "formData", "json", "text"]);
    return new Proxy(response, {
      get(target, property) {
        // Reflect.get 的返回类型是 any；先收敛成 unknown 再窄化，避免 any 向外扩散。
        const value: unknown = Reflect.get(target, property, target);
        if (
          typeof property !== "string" ||
          !bodyMethods.has(property) ||
          typeof value !== "function"
        ) {
          // 严格判 false：`await` 会读取 .then，而鸭子类型的响应对象没有 ok（undefined），
          // 用 `!target.ok` 会误判为非 ok 并提前清掉超时定时器。
          if (target.ok === false && !released && !draining) {
            draining = true;
            drain(target);
          }
          // Function.prototype.bind 的返回类型是 any；收敛成 unknown 再返回。
          if (typeof value === "function") return value.bind(target) as unknown;
          return value;
        }
        const readBody = value as (this: unknown, ...args: unknown[]) => Promise<unknown>;
        return async (...args: unknown[]) => {
          try {
            // 用 .call 保留 this（原实现是 value.apply(target, args)），并避免 apply 的 any 返回。
            return await readBody.call(target, ...args);
          } catch (error) {
            normalizeError(error);
          } finally {
            release();
          }
        };
      }
    });
  } catch (error) {
    release();
    return normalizeError(error);
  }
}

/** Node 的 timer 支持 unref；DOM 的 number 句柄没有该方法，因此做能力探测。 */
function unrefTimer(handle: ReturnType<typeof setTimeout>): void {
  const candidate = handle as { unref?: () => void };
  if (typeof candidate.unref === "function") candidate.unref();
}
