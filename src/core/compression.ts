/** Native browser gzip streams with explicit limits before and after decompression. */
/** Collect bounded binary data and cancel oversized or malformed streams instead of retaining a zip bomb. */
export async function boundedBytes(
  stream: ReadableStream<Uint8Array>,
  max: number,
): Promise<Uint8Array> {
  const reader = stream.getReader(),
    chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max)
        throw Error("数据超过大小限制 / Data exceeds size limit");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
/** Compress canonical UTF-8 text without a base64 wrapper or a second full JSON archive. */
export async function gzipText(text: string, max: number): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength > max)
    throw Error("日志批次超过大小限制 / Pack exceeds size limit");
  const source = new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(Uint8Array.from(bytes));
      controller.close();
    },
  });
  return boundedBytes(
    source.pipeThrough(new CompressionStream("gzip")),
    max + 65536,
  );
}
/** Bound inflated bytes and reject truncated gzip or invalid UTF-8 before interpreting JSON. */
export async function gunzipText(
  bytes: Uint8Array,
  max: number,
): Promise<string> {
  const source = new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(Uint8Array.from(bytes));
      controller.close();
    },
  });
  const plain = await boundedBytes(
    source.pipeThrough(new DecompressionStream("gzip")),
    max,
  );
  return new TextDecoder("utf-8", { fatal: true }).decode(plain);
}
