# Chat interaction references · 2026-10-28

- [assistant-ui Thread primitives](https://github.com/assistant-ui/assistant-ui/blob/main/apps/docs/content/docs/primitives/thread.mdx): bounded flex root/viewport, right-aligned user messages, anchored composer, following only near the bottom, pausing during history reading, explicit jump to latest, resetting scroll on conversation switches.
- [Open WebUI Messages.svelte](https://github.com/open-webui/open-webui/blob/main/src/lib/components/chat/Messages.svelte): keeping scrolling within the message container, preserving history position, avoiding unnecessary rebuilds during streaming.

Reviewed the linked source/documentation through GitHub before implementation. The app retains its existing React/Markdown/storage/queue infrastructure; interaction patterns were implemented locally without adding either framework or copying their source. This iteration adds memoized message rendering, response identity for live/final handoff, native/browser copy, explicit stop/retry, mobile conversation navigation, input keyboard/IME handling and guarded automatic titles. No virtualization or large-history performance guarantee is claimed.
