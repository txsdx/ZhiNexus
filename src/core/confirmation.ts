/** Explicit asynchronous consent gate shared by destructive UI actions. */

/** Run a mutation only after literal true; cancellation, missing results and rejection never run it. */
export async function runConfirmed(
  confirm: () => Promise<boolean>,
  action: () => Promise<void>,
): Promise<void> {
  if ((await confirm()) === true) await action();
}
