/** Real native networking fixture: model discovery through an explicit application-wide HTTP proxy without browser CORS. */
import http from "node:http";
import assert from "node:assert/strict";
/** Drive the same proxy and provider controls used by users, then restore the system policy before closing the fixture. */
export async function testNativeNetwork({ click, type, script, waitFor }) {
  let requests = 0;
  const proxy = http.createServer((request, response) => {
    try {
      assert.equal(request.headers.authorization, "Bearer native-fixture-key");
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
    await click(".settings-content .primary");
    await waitFor(() =>
      script(
        'return /Global proxy applied|全局代理已应用/.test(document.querySelector(".toast")?.innerText??"")',
      ),
    );
    await click('[data-settings-tab="ai"]');
    await type(
      '.settings-content input[placeholder="https://api.example.com/v1"]',
      "http://native-fixture.invalid:12010/v1/chat/completions",
    );
    await type(
      '.settings-content input[type="password"]',
      " Bearer native-fixture-key ",
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
  } finally {
    await click('[data-settings-tab="network"]');
    await script(
      'const e=document.querySelector(".settings-content select");Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(e,"system");e.dispatchEvent(new Event("change",{bubbles:true}));return true;',
    );
    await click(".settings-content .primary");
    await waitFor(() =>
      script(
        'return /Global proxy applied|全局代理已应用/.test(document.querySelector(".toast")?.innerText??"")',
      ),
    );
    proxy.closeAllConnections();
    await new Promise((resolve) => proxy.close(resolve));
  }
}
