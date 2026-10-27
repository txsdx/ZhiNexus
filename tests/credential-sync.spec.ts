/** Automatic credential encryption: connection-only setup and durable retries without manual vault actions. */
import { test, expect, type Page } from "@playwright/test";
/** Use the real repository and browser SQLite persistence. */
async function repository<T>(page: Page, code: string): Promise<T> {
  await expect(page.locator(".app-shell")).toBeVisible();
  return page.evaluate(async (source) => {
    const { store } = await import("/src/core/store.ts" as string);
    return new Function("store", `return (async()=>{${source}})()`)(store);
  }, code);
}

test("connection-only encryption does not create an empty API key and reads original API records", async ({
  page,
}) => {
  await page.goto("/");
  expect(
    await repository(
      page,
      `
    await store.updateDevice({davUrl:'https://dav.example/knowledge/',davPassword:'dav-only-password',syncMinutes:0});
    const {flushKeySync}=await import('/src/services/key-sync.ts');await flushKeySync();
    const fields=store.getSnapshot().docs.find(d=>d.id==='ai-key-vault').fields;
    const {encryptSecret,decryptSecret}=await import('/src/core/secrets.ts');
    if (typeof fields.cipher==='string') throw Error('Connection setup must not clear a remote API key');
    const connection=await decryptSecret(fields.connectionsCipher,'sync-connections');
    await store.patch('setting','ai-key-vault',{cipher:await encryptSecret({apiKey:'old-api-key',baseUrl:store.getSnapshot().ai.baseUrl},'sync-api-key'),keyMode:'builtin'},'previous-version');
    await flushKeySync();
    return {connection,key:store.getSnapshot().device.apiKey};
  `,
    ),
  ).toMatchObject({
    connection: { davPassword: "dav-only-password" },
    key: "old-api-key",
  });
  await page.reload();
  expect(
    await repository(page, "return store.getSnapshot().device"),
  ).toMatchObject({ apiKey: "old-api-key", davPassword: "dav-only-password" });
});

test("a failed encrypted publication keeps saved connection edits through reload and retries", async ({
  page,
}) => {
  await page.goto("/");
  await repository(
    page,
    `
    await store.updateDevice({davUrl:'https://dav.example/knowledge/',davPassword:'previous-password',syncMinutes:0});
    const {flushKeySync}=await import('/src/services/key-sync.ts');await flushKeySync();
    store.db.append=async()=>{throw Error('fixture encryption outbox disk failure')};
    await store.updateDevice({davPassword:'new-password-must-survive'});
    try {await flushKeySync()} catch {}
  `,
  );
  expect(
    await repository(
      page,
      "return store.getSnapshot().device.credentialSyncPending.connections",
    ),
  ).toBe(true);
  await page.reload();
  await expect
    .poll(() =>
      repository(
        page,
        `const {flushKeySync}=await import('/src/services/key-sync.ts');await flushKeySync();return store.getSnapshot().device.credentialSyncPending.connections`,
      ),
    )
    .toBe(false);
  expect(
    await repository(
      page,
      `
    const s=store.getSnapshot();const f=s.docs.find(d=>d.id==='ai-key-vault').fields;
    const {decryptSecret}=await import('/src/core/secrets.ts');
    return {password:s.device.davPassword,remote:await decryptSecret(f.connectionsCipher,'sync-connections'),events:JSON.stringify(s.events)};
  `,
    ),
  ).toMatchObject({
    password: "new-password-must-survive",
    remote: { davPassword: "new-password-must-survive" },
  });
  expect(
    await repository<string>(
      page,
      "return JSON.stringify(store.getSnapshot().events)",
    ),
  ).not.toContain("new-password-must-survive");
});
