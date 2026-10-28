/** Editable knowledge graph using React Flow; relationships and node positions are replicated documents. */
import dagre from "@dagrejs/dagre";
import { useEffect, useMemo, useState, useRef } from "react";
import { copyText } from "../services/clipboard";
import { openContextMenu } from "../services/context-menu";
import { entryColors } from "../core/entry-colors";
import { useConfirmation } from "../hooks/useConfirmation";
import {
  ReactFlow,
  Background,
  MiniMap,
  type ReactFlowInstance,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type Connection,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useKnowledge, useT } from "../components/common";
import { store, json } from "../core/store";
/** Build stable graph projections; connect handles to create links and delete selected links to remove them. */
export function Graph({
  onOpen,
  onCreate,
}: {
  onOpen: (id: string) => void;
  onCreate?: () => void;
}) {
  const s = useKnowledge(),
    t = useT();
  const [error, setError] = useState("");
  const [minimap, setMinimap] = useState(false),
    flow = useRef<ReactFlowInstance | null>(null);
  const confirmation = useConfirmation(setError);
  const positions =
    s.docs.find((d) => d.collection === "setting" && d.id === "graph")
      ?.fields ?? {};
  const projectedNodes = useMemo<Node[]>(
    () =>
      s.entries.map((e, i) => ({
        id: e.id,
        data: { label: e.title },
        deletable: false,
        position: (positions[e.id] as unknown as { x: number; y: number }) ?? {
          x: (i % 3) * 260,
          y: Math.floor(i / 3) * 140,
        },
        style: {
          borderRadius: 14,
          padding: 15,
          border: "1px solid #bcb5ed",
          background:
            e.color && e.color !== "none"
              ? `var(--entry-${e.color})`
              : "var(--surface)",
          color: "var(--text)",
        },
      })),
    [s.entries, positions],
  );
  const projectedEdges: Edge[] = s.docs
    .filter(
      (d) =>
        d.collection === "edge" &&
        !d.fields.deleted &&
        s.entries.some((e) => e.id === d.fields.source) &&
        s.entries.some((e) => e.id === d.fields.target),
    )
    .map((d) => ({
      id: d.id,
      source: String(d.fields.source),
      target: String(d.fields.target),
      label: String(d.fields.label ?? ""),
      animated: false,
    }));
  const [nodes, setNodes, onNodesChange] = useNodesState(projectedNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(projectedEdges);
  useEffect(() => {
    setNodes(projectedNodes);
    setEdges(projectedEdges);
  }, [s.revision]);
  const connect = (c: Connection) => {
    if (c.source !== c.target)
      void store.patch("edge", crypto.randomUUID(), {
        source: c.source,
        target: c.target,
        label: "related",
      });
  };
  const arrange = async () => {
    const graph = new dagre.graphlib.Graph()
      .setGraph({ rankdir: "LR", nodesep: 70, ranksep: 110 })
      .setDefaultEdgeLabel(() => ({}));
    for (const n of nodes) graph.setNode(n.id, { width: 190, height: 65 });
    for (const e of edges) graph.setEdge(e.source, e.target);
    dagre.layout(graph);
    await store.patch(
      "setting",
      "graph",
      Object.fromEntries(
        nodes.map((n) => {
          const p = graph.node(n.id);
          return [n.id, json({ x: p.x - 95, y: p.y - 32.5 })];
        }),
      ),
      "graph-auto-layout",
    );
    await flow.current?.fitView({ duration: 0, padding: 0.15 });
  };
  return (
    <div className="page graph-page">
      {error && <p role="alert">{error}</p>}
      <div className="graph-canvas">
        <ReactFlow
          onInit={(instance) => {
            flow.current = instance;
          }}
          onPaneContextMenu={(event) =>
            openContextMenu(
              "nativeEvent" in event ? event.nativeEvent : event,
              [
                {
                  label: t("自动整理布局", "Arrange automatically"),
                  run: arrange,
                },
                {
                  label: t("适应窗口", "Fit view"),
                  run: async () => {
                    await flow.current?.fitView({ duration: 0, padding: 0.15 });
                  },
                },
                {
                  label: t("放大", "Zoom in"),
                  run: async () => {
                    await flow.current?.zoomIn({ duration: 0 });
                  },
                },
                {
                  label: t("缩小", "Zoom out"),
                  run: async () => {
                    await flow.current?.zoomOut({ duration: 0 });
                  },
                },
                {
                  label: t("全选节点", "Select all nodes"),
                  run: () =>
                    setNodes((nodes) =>
                      nodes.map((n) => ({ ...n, selected: true })),
                    ),
                },
                {
                  label: t("取消选择", "Clear selection"),
                  run: () => {
                    setNodes((nodes) =>
                      nodes.map((n) => ({ ...n, selected: false })),
                    );
                    setEdges((edges) =>
                      edges.map((e) => ({ ...e, selected: false })),
                    );
                  },
                },
                {
                  label: t(
                    minimap ? "隐藏缩略图" : "显示缩略图",
                    minimap ? "Hide minimap" : "Show minimap",
                  ),
                  run: () => setMinimap((value) => !value),
                },
                {
                  label: t("新建词条", "New entry"),
                  disabled: !onCreate,
                  run: onCreate,
                },
              ],
            )
          }
          onNodeContextMenu={(event, node) => {
            const entry = s.entries.find((e) => e.id === node.id);
            if (!entry) return;
            openContextMenu(
              "nativeEvent" in event ? event.nativeEvent : event,
              [
                {
                  label: t("打开词条", "Open entry"),
                  run: () => onOpen(node.id),
                },
                {
                  label: t("复制标题", "Copy title"),
                  run: () => copyText(entry.title),
                },
                {
                  label: t("复制 Markdown", "Copy Markdown"),
                  run: () => copyText(entry.content),
                },
                {
                  label: t("聚焦此节点", "Center node"),
                  run: async () => {
                    await flow.current?.fitView({
                      nodes: [node],
                      duration: 0,
                      padding: 0.5,
                    });
                  },
                },
                {
                  label: t("背景颜色", "Background color"),
                  children: entryColors.map((color, index) => ({
                    label: t(
                      ["默认", "浅红", "浅绿", "浅蓝", "浅黄", "浅紫"][index],
                      [
                        "Default",
                        "Soft red",
                        "Soft green",
                        "Soft blue",
                        "Soft yellow",
                        "Soft purple",
                      ][index],
                    ),
                    color,
                    run: () =>
                      store.patch("entry", entry.id, {
                        color,
                        updatedAt: new Date().toISOString(),
                      }),
                  })),
                },
                {
                  label: t("删除词条", "Delete entry"),
                  danger: true,
                  run: () =>
                    confirmation.request(
                      t(
                        `删除词条「${entry.title}」？`,
                        `Delete “${entry.title}”?`,
                      ),
                      () => store.patch("entry", entry.id, { deleted: true }),
                    ),
                },
              ],
            );
          }}
          onEdgeContextMenu={(event, edge) =>
            openContextMenu(
              "nativeEvent" in event ? event.nativeEvent : event,
              [
                {
                  label: t("复制关系", "Copy relationship"),
                  run: () =>
                    copyText(
                      `${s.entries.find((e) => e.id === edge.source)?.title} → ${s.entries.find((e) => e.id === edge.target)?.title}`,
                    ),
                },
                {
                  label: t("打开起点词条", "Open source entry"),
                  run: () => onOpen(edge.source),
                },
                {
                  label: t("打开终点词条", "Open target entry"),
                  run: () => onOpen(edge.target),
                },
                {
                  label: t("删除关系", "Delete relationship"),
                  danger: true,
                  run: () =>
                    confirmation.request(
                      t("删除此知识关系？", "Delete this relationship?"),
                      () => store.patch("edge", edge.id, { deleted: true }),
                    ),
                },
              ],
            )
          }
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={connect}
          deleteKeyCode={["Backspace", "Delete"]}
          onNodeDoubleClick={(_, n) => onOpen(n.id)}
          onNodeDragStop={(_, n) =>
            void store.patch("setting", "graph", { [n.id]: json(n.position) })
          }
          onBeforeDelete={async ({ edges: selectedEdges }) => {
            if (!selectedEdges.length) return false;
            await confirmation.request(
              t(
                `删除选中的 ${selectedEdges.length} 条知识关系？`,
                `Delete ${selectedEdges.length} selected relationships?`,
              ),
              () =>
                store.batch(
                  selectedEdges.map((e) => ({
                    collection: "edge",
                    id: e.id,
                    patch: { deleted: true },
                  })),
                ),
            );
            // The committed store projection updates the controlled edges; React Flow must never remove them optimistically.
            return false;
          }}
          fitView
        >
          <Background gap={24} color="#c7c9d9" />
          {minimap && <MiniMap />}
        </ReactFlow>
      </div>
      {confirmation.dialog}
    </div>
  );
}
