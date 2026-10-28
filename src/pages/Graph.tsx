/** Editable knowledge graph using React Flow; relationships and node positions are replicated documents. */
import dagre from "@dagrejs/dagre";
import { useEffect, useMemo, useState } from "react";
import { useConfirmation } from "../hooks/useConfirmation";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
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
export function Graph({ onOpen }: { onOpen: (id: string) => void }) {
  const s = useKnowledge(),
    t = useT();
  const [error, setError] = useState("");
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
          background: "var(--surface)",
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
  return (
    <div className="page graph-page">
      <div className="page-heading">
        <div>
          <h1>{t("知识星图", "Knowledge graph")}</h1>
          <p>
            {t(
              "拖动节点整理布局，连接圆点建立关系。双击打开词条，选中连线后按 Delete 删除。",
              "Drag to arrange. Connect handles to create links. Double-click to open; select an edge and Delete to remove.",
            )}
          </p>
        </div>
      </div>
      <button
        className="primary"
        onClick={() => {
          const graph = new dagre.graphlib.Graph()
            .setGraph({ rankdir: "LR", nodesep: 70, ranksep: 110 })
            .setDefaultEdgeLabel(() => ({}));
          for (const n of nodes)
            graph.setNode(n.id, { width: 190, height: 65 });
          for (const e of edges) graph.setEdge(e.source, e.target);
          dagre.layout(graph);
          void store.patch(
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
        }}
      >
        {t("自动整理布局", "Arrange automatically")}
      </button>
      {error && <p role="alert">{error}</p>}
      <div className="graph-canvas">
        <ReactFlow
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
          <Controls />
          <MiniMap />
        </ReactFlow>
      </div>
      {confirmation.dialog}
    </div>
  );
}
