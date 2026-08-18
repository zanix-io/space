/** Fully drains a `renderToReadableStream` result — React's own stream starts producing bytes
 * before rendering finishes, so a benchmark timing only the call that returns the stream would
 * measure react-dom's initial setup, not the real total SSR cost; every `*.bench.ts` file in this
 * directory that touches React reads the stream to completion before stopping its timer. */
export async function drainReactStream(stream: ReadableStream<Uint8Array>): Promise<void> {
  const reader = stream.getReader()
  // deno-lint-ignore no-await-in-loop -- a real sequential stream read, not independent work
  while (!(await reader.read()).done) {
    // draining only — the benchmark cares about total time-to-fully-rendered, not the bytes
  }
}
