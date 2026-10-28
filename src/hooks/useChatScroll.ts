/** Follow streaming output only while the reader stays at the bottom of the message viewport. */
import { useLayoutEffect, useRef, useState } from "react";

/** Keep document scrolling independent and let readers explicitly return to the latest message. */
export function useChatScroll(topic: string, revision: string) {
  const viewport = useRef<HTMLDivElement>(null),
    content = useRef<HTMLDivElement>(null),
    following = useRef(true);
  const [away, setAway] = useState(false);
  const bottom = () => {
    following.current = true;
    const node = viewport.current;
    if (node) node.scrollTop = node.scrollHeight;
    setAway(false);
  };
  useLayoutEffect(() => {
    bottom();
  }, [topic]);
  useLayoutEffect(() => {
    if (following.current) bottom();
  }, [revision]);
  useLayoutEffect(() => {
    const parent = viewport.current,
      child = content.current;
    if (!parent || !child) return;
    const observer = new ResizeObserver(() => {
      if (following.current) parent.scrollTop = parent.scrollHeight;
    });
    observer.observe(parent);
    observer.observe(child);
    return () => observer.disconnect();
  }, []);
  const onScroll = () => {
    const node = viewport.current;
    if (!node) return;
    const atBottom =
      node.scrollHeight - node.scrollTop - node.clientHeight < 56;
    following.current = atBottom;
    setAway(!atBottom);
  };
  const pause = () => {
    following.current = false;
    setAway(true);
  };
  return { viewport, content, away, bottom, onScroll, pause };
}
