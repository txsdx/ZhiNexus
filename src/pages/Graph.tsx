/** Editable knowledge graph using React Flow; relationships and node positions are replicated documents. */
import { useEffect, useMemo, useState, useRef } from "react";
import { ActionPicker } from "../components/ActionPicker";
import { copyText } from "../services/clipboard";
import { openContextMenu } from "../services/context-menu";
import { entryColors } from "../core/entry-colors";
import { useConfirmation } from "../hooks/useConfirmation";
import {
  ReactFlow,
  Background,
  MiniMap,
  MarkerType,
  SelectionMode,
  type ReactFlowInstance,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type Connection,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useKnowledge, useT } from "../components/common";
import { store } from "../core/store";
import {
  graphEdges,
  graphSignature,
  graphLayoutPatches,
  saveGraphPositions,
  relationPatches,
  graphBatches,
  graphBatchCount,
  graphCatalog,
  graphPositionSignature,
} from "../services/knowledge-graph";
import { submitAIJob } from "../services/ai-jobs";
import { resolveModel } from "../core/ai-config";
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
  const [finding, setFinding] = useState(false);
  const [minimap, setMinimap] = useState(false),
    flow = useRef<ReactFlowInstance | null>(null);
  const dragBaseline = useRef<string | undefined>(undefined);
  const confirmation = useConfirmation(setError);
  const analysisConfirmation = useConfirmation(setError, {
    title: t("自动关联全部条目", "Connect all entries"),
    confirmLabel: t("开始分析", "Start analysis"),
  });
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
  const projectedEdges: Edge[] = graphEdges().map((d) => ({
    id: d.id,
    source: d.source,
    target: d.target,
    label:
      d.type === "prerequisite"
        ? t("依赖", "Prerequisite")
        : d.type === "progression"
          ? t("递进", "Progression")
          : d.label === "related"
            ? t("关联", "Related")
            : d.label,
    markerEnd:
      d.type !== "related" ? { type: MarkerType.ArrowClosed } : undefined,
    style: {
      stroke:
        d.type === "prerequisite"
          ? "#8266cc"
          : d.type === "progression"
            ? "#319b88"
            : "#a4a7bb",
    },
    data: { reason: d.reason, type: d.type },
    animated: false,
  }));
  const [nodes, setNodes, onNodesChange] = useNodesState(projectedNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(projectedEdges);
  useEffect(() => {
    setNodes(projectedNodes);
    setEdges(projectedEdges);
  }, [s.revision]);
  const connect = (c: Connection) => {
    void (async () => {
      try {
        const patches = relationPatches([
          { source: c.source, target: c.target, type: "related" },
        ]);
        if (patches.length) {
          const before = graphSignature();
          if (
            !(await store.batchWhen(
              patches,
              "graph-connect",
              () => graphSignature() === before,
            ))
          )
            throw Error(t("星图已改变，请重试", "Graph changed; retry"));
        }
      } catch (error) {
        setError(String(error instanceof Error ? error.message : error));
      }
    })();
  };
  const arrange = async () => {
    const before = graphSignature(true),
      patches = await graphLayoutPatches();
    if (
      !(await store.batchWhen(
        patches,
        "graph-auto-layout",
        () => graphSignature(true) === before,
      ))
    )
      throw Error(t("布局已改变，请重试", "Layout changed; retry"));
    await flow.current?.fitView({ duration: 0, padding: 0.15 });
  };
  const connectAll = () => {
    const before = graphSignature();
    const model = s.ai.models.find((m) => m.id === resolveModel(s.ai, "graph"));
    const groups = graphBatches(
      graphCatalog(),
      Math.max(
        4096,
        Math.min(24000, Math.floor((model?.context ?? 96000) / 4)),
      ),
    );
    return analysisConfirmation.request(
      t(
        `分析全部 ${s.entries.length} 个词条，预计最多 ${graphBatchCount(groups)} 次分析请求。根据摘要与解释摘录提出依赖、递进和关联；审阅确认前不修改星图。`,
        `Analyze all ${s.entries.length} entries in up to ${graphBatchCount(groups)} requests using summaries and explanation excerpts. Review proposed prerequisites, progressions and associations before applying.`,
      ),
      async () => {
        if (graphSignature() !== before)
          throw Error(
            t(
              "词条或星图已改变，请重新开始",
              "Entries or graph changed; start again",
            ),
          );
        await submitAIJob("graph", { page: "graph" });
      },
    );
  };
  useEffect(() => {
    const find = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.shiftKey &&
        event.key.toLowerCase() === "f" &&
        !event.isComposing &&
        !event.repeat &&
        !document.querySelector('[role="dialog"]')
      ) {
        event.preventDefault();
        setFinding(true);
      }
    };
    document.addEventListener("keydown", find);
    return () => document.removeEventListener("keydown", find);
  }, []);
  return (
    <div className="page graph-page">
      {finding && (
        <ActionPicker
          title={t("查找星图节点", "Find graph node")}
          placeholder={t("输入词条标题…", "Entry title…")}
          items={s.entries.map((entry) => ({
            id: entry.id,
            label: entry.title,
            detail: entry.summary,
          }))}
          onClose={() => setFinding(false)}
          onChoose={(item) => {
            setFinding(false);
            const node = flow.current?.getNode(item);
            if (!node) return;
            setNodes((nodes) =>
              nodes.map((value) => ({
                ...value,
                selected: value.id === item,
              })),
            );
            void flow.current?.fitView({
              nodes: [node],
              duration: 0,
              padding: 0.5,
            });
          }}
        />
      )}
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
                  label: t("查找节点", "Find node"),
                  run: () => setFinding(true),
                },
                {
                  label: t("自动整理布局", "Arrange automatically"),
                  run: arrange,
                },
                {
                  label: t("自动关联全部条目", "Connect all entries with AI"),
                  disabled: s.entries.length < 2,
                  run: connectAll,
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
          selectionOnDrag
          selectionMode={SelectionMode.Partial}
          panOnDrag={[1]}
          panActivationKeyCode="Space"
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={connect}
          deleteKeyCode={["Backspace", "Delete"]}
          onNodeDoubleClick={(_, n) => onOpen(n.id)}
          onNodeDragStop={(_, n, dragged) =>
            void saveGraphPositions(
              dragged?.length ? dragged : [n],
              dragBaseline.current,
            ).catch((e) => setError(String(e.message ?? e)))
          }
          onSelectionDragStop={(_, selected) =>
            void saveGraphPositions(selected, dragBaseline.current).catch((e) =>
              setError(String(e.message ?? e)),
            )
          }
          onNodeDragStart={() => {
            dragBaseline.current = graphPositionSignature();
          }}
          onSelectionDragStart={() => {
            dragBaseline.current = graphPositionSignature();
          }}
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
      {analysisConfirmation.dialog}
    </div>
  );
}
