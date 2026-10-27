/** Real SSE framing, Unicode, tool fragments and incomplete-response safety. */
import { expect, it } from "vitest";
import { readAIStream } from "./ai-stream";
/** Deliberately split inside every UTF-8 character and SSE delimiter. */
function response(text: string) {
  const bytes = new TextEncoder().encode(text);
  let index = 0;
  return new Response(
    new ReadableStream({
      pull(controller) {
        if (index === bytes.length) {
          controller.close();
          return;
        }
        controller.enqueue(bytes.slice(index, index + 1));
        index++;
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}
it("streams Unicode and reasoning while assembling complete tool calls", async () => {
  const frames = [
    {
      choices: [
        {
          index: 0,
          delta: {
            reasoning_content: "思考",
            content: "你",
            tool_calls: [
              {
                index: 0,
                id: "call_",
                type: "function",
                function: { name: "look", arguments: '{"id":' },
              },
            ],
          },
        },
      ],
    },
    {
      choices: [
        {
          index: 0,
          delta: {
            content: "好",
            tool_calls: [
              {
                index: 0,
                id: "1",
                function: { name: "up", arguments: '"entry"}' },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    },
  ];
  const stream =
    ": heartbeat\r\n\r\n" +
    frames.map((f) => "data: " + JSON.stringify(f) + "\r\n\r\n").join("") +
    "data: [DONE]\n\n";
  const output: string[] = [];
  const result = await readAIStream(
    response(stream),
    undefined,
    (s) => output.push(s.content),
    () => {},
  );
  expect(output).toContain("你");
  expect(result).toEqual({
    content: "你好",
    reasoning: "思考",
    calls: [
      {
        id: "call_1",
        type: "function",
        function: { name: "lookup", arguments: '{"id":"entry"}' },
      },
    ],
  });
});
it.each([
  "data: {bad}\n\n",
  'data: {"error":{"message":"fixture error"}}\n\n',
  'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',
  'data: {"choices":[{"delta":{"content":"partial"},"finish_reason":"length"}]}\n\n',
])(
  "rejects malformed or interrupted output before application (%s)",
  async (text) => {
    await expect(
      readAIStream(
        response(text),
        undefined,
        () => {},
        () => {},
      ),
    ).rejects.toThrow();
  },
);
it("cancels the reader and rejects a partial answer on abort", async () => {
  const controller = new AbortController();
  let cancelled = false;
  const stream = new Response(
    new ReadableStream({
      start(c) {
        c.enqueue(
          new TextEncoder().encode(
            'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',
          ),
        );
      },
      cancel() {
        cancelled = true;
      },
    }),
  );
  const pending = readAIStream(
    stream,
    controller.signal,
    () => controller.abort(),
    () => {},
  );
  await expect(pending).rejects.toThrow();
  expect(cancelled).toBe(true);
});
