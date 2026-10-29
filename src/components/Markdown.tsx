/** Safe Markdown, KaTeX, strict Mermaid diagrams and verified local attachment rendering. */
import { useEffect, useId, useState, useMemo } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

import { store } from "../core/store";
import "katex/dist/katex.min.css";

/** Render Mermaid through its strict sanitizer; errors remain readable rather than becoming raw HTML. */
export function Diagram({ code }: { code: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, ""),
    [svg, setSvg] = useState(""),
    [error, setError] = useState(false);
  useEffect(() => {
    let live = true;
    void import("mermaid")
      .then(async ({ default: mermaid }) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "neutral",
          maxTextSize: 30000,
          suppressErrorRendering: true,
        });
        return mermaid.render("diagram" + id, code);
      })
      .then((r) => {
        if (live) {
          setSvg(r.svg);
          setError(false);
        }
      })
      .catch(() => {
        if (live) setError(true);
      });
    return () => {
      live = false;
    };
  }, [id, code]);
  return error ? (
    <pre>{code}</pre>
  ) : (
    <div className="diagram" dangerouslySetInnerHTML={{ __html: svg }} />
  );
}
/** Resolve only content-addressed images; remote Markdown cannot silently track the reader. */
export function AssetImage({
  src,
  alt,
  resolveAsset,
}: {
  src?: string;
  alt?: string;
  resolveAsset?: (hash: string) => Promise<string>;
}) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let live = true,
      current = "";
    setUrl("");
    if (src?.startsWith("asset:") && resolveAsset) {
      void resolveAsset(src.slice(6))
        .then((value) => {
          if (live) setUrl(value);
        })
        .catch(() => {});
    } else if (src?.startsWith("asset:"))
      void store.db
        .blob(src.slice(6))
        .then((b) => {
          if (b && live) {
            current = URL.createObjectURL(
              new Blob([b.bytes as BlobPart], { type: b.mime }),
            );
            setUrl(current);
          }
        })
        .catch(() => {});
    return () => {
      live = false;
      if (current) URL.revokeObjectURL(current);
    };
  }, [src, resolveAsset]);
  return url ? (
    <img src={url} alt={alt ?? ""} />
  ) : (
    <span className="muted">[图片：{alt || "请导入本地附件"}]</span>
  );
}
/** Render rich text with raw HTML disabled and allow only explicit safe URL schemes. */
export function Markdown({
  children,
  resolveAsset,
}: {
  children: string;
  resolveAsset?: (hash: string) => Promise<string>;
}) {
  const Image = useMemo(
    () =>
      resolveAsset
        ? ({ src, alt }: { src?: string; alt?: string }) => (
            <AssetImage src={src} alt={alt} resolveAsset={resolveAsset} />
          )
        : AssetImage,
    [resolveAsset],
  );
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        urlTransform={(url) =>
          url.startsWith("asset:") ? url : defaultUrlTransform(url)
        }
        components={{
          img: Image,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          code: ({ className, children, ...props }) =>
            className === "language-mermaid" ? (
              <Diagram code={String(children)} />
            ) : (
              <code className={className} {...props}>
                {children}
              </code>
            ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
