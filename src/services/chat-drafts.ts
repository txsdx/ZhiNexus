/** One main-workspace owner persists local chat drafts outside replicated knowledge and backups. */
import { ChatDrafts } from "../core/chat-drafts";
import { store } from "../core/store";
/** Shared across global/entry sidebars and navigation; native exit drains this same instance. */
export const chatDrafts = new ChatDrafts(
  () => store.db.local("chat-drafts-v1", {}),
  (drafts) => store.db.setLocal("chat-drafts-v1", drafts),
);
