/** Real native networking fixture: model discovery through an explicit application-wide HTTP proxy without browser CORS. */
import http from "node:http";
import assert from "node:assert/strict";
/** Drive the same proxy and provider controls used by users, then restore the system policy before closing the fixture. */
export async function testNativeNetwork({ click, type, script, waitFor }) {
  let requests = 0;
  let streamRequests = 0,
    finishStream = () => {};
  const proxy = http.createServer((request, response) => {
    try {
      assert.equal(request.headers.authorization, "Bearer native-fixture-key");
      if (
        request.method === "POST" &&
        /^http:\/\/native-fixture\.invalid:12010\/v1\/chat\/completions$/.test(
          request.url,
        )
      ) {
        let raw = "";
        request.on("data", (chunk) => {
          raw += chunk;
        });
        request.on("end", () => {
          const body = JSON.parse(raw);
          assert.equal(body.stream, true);
          assert.equal(body.model, "native-model-fixture");
          streamRequests++;
          response.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "close",
          });
          response.flushHeaders();
          response.write(
            "data: " +
              JSON.stringify({
                choices: [
                  { index: 0, delta: { content: "Native streaming partial" } },
                ],
              }) +
              "\n\n",
          );
          finishStream = () =>
            response.end(
              "data: " +
                JSON.stringify({
                  choices: [
                    {
                      index: 0,
                      delta: { content: " complete" },
                      finish_reason: "stop",
                    },
                  ],
                }) +
                "\n\ndata: [DONE]\n\n",
            );
        });
        return;
      }
      assert.match(
        request.url,
        /^http:\/\/native-fixture\.invalid:12010\/v1\/models\?client_version=cpa$/,
      );
      requests++;
      response.writeHead(200, {
        "Content-Type": "application/json",
        Connection: "close",
      });
      response.end(
        JSON.stringify({
          data: [
            {
              id: "native-model-fixture",
              display_name: "Native network fixture",
              supports_vision: true,
            },
          ],
        }),
      );
    } catch {
      response.writeHead(400);
      response.end();
    }
  });
  await new Promise((resolve, reject) => {
    proxy.once("error", reject);
    proxy.listen(0, "127.0.0.1", resolve);
  });
  try {
    await click('[data-settings-tab="network"]');
    await script(
      'const e=document.querySelector(".settings-content select");Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(e,"http");e.dispatchEvent(new Event("change",{bubbles:true}));return true;',
    );
    await type(
      ".settings-content input:not([type])",
      `http://127.0.0.1:${proxy.address().port}`,
    );
    await waitFor(() =>
      script(
        'return document.querySelector("[data-save-status]")?.getAttribute("data-save-status")==="saved"',
      ),
    );
    await click('[data-settings-tab="ai"]');
    await type(
      '.settings-content input[placeholder="https://api.example.com/v1"]',
      "http://native-fixture.invalid:12010/v1/chat/completions",
      ["http://native-fixture.invalid:12010/v1"],
    );
    await type(
      '.settings-content input[type="password"]',
      " Bearer native-fixture-key ",
      ["native-fixture-key"],
    );
    await click(".settings-content .actions button");
    await waitFor(() =>
      script(
        'const models=[...document.querySelectorAll(".model-list strong")].map(e=>e.textContent);return models.length===1&&models[0]==="native-model-fixture";',
      ),
    );
    assert.equal(
      await script(
        'return document.querySelector(".model-list").innerText.includes("Native network fixture")',
      ),
      false,
      "Model catalog must show the raw ID instead of the provider display name",
    );
    assert.equal(requests, 1);
    await click(".sidebar nav button:nth-child(5)");
    await waitFor(() =>
      script('return !!document.querySelector(".chat-model select")'),
    );
    await script(
      'const e=document.querySelector(".chat-model select");Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(e,"native-model-fixture");e.dispatchEvent(new Event("change",{bubbles:true}));return true;',
    );
    await type(".chat-input textarea", "Native genuine streaming check");
    await click('.chat-input button[aria-label="Send"]');
    await waitFor(() =>
      script(
        'return document.querySelector(".ai-live-message")?.innerText.includes("Native streaming partial")',
      ),
    );
    assert.equal(streamRequests, 1);
    assert.equal(
      await script(
        'return document.querySelector(".messages").innerText.includes("partial complete")',
      ),
      false,
      "The native bridge must expose received chunks before completion",
    );
    finishStream();
    await waitFor(() =>
      script(
        'return [...document.querySelectorAll(".message.assistant")].some(e=>e.innerText.includes("Native streaming partial complete"))',
      ),
    );
    await click(".ai-queue-button");
    await waitFor(() =>
      script(
        'return document.querySelector(".ai-job-card")?.getAttribute("data-job-state")==="review"',
      ),
    );
    await click(".ai-job-card .actions button");
    await waitFor(() =>
      script('return !!document.querySelector(".ai-result-review .primary")'),
    );
    await click(".ai-result-review .primary");
    await waitFor(() => script('return !document.querySelector(".modal")'));
    await click(".sidebar-bottom>button");
  } finally {
    if (
      !(await script(
        'return !!document.querySelector("[data-settings-tab=network]")',
      ))
    )
      await click(".sidebar-bottom>button");
    await click('[data-settings-tab="network"]');
    await script(
      'const e=document.querySelector(".settings-content select");Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(e,"system");e.dispatchEvent(new Event("change",{bubbles:true}));return true;',
    );
    await waitFor(() =>
      script(
        'return document.querySelector("[data-save-status]")?.getAttribute("data-save-status")==="saved"',
      ),
    );
    proxy.closeAllConnections();
    await new Promise((resolve) => proxy.close(resolve));
  }
}
