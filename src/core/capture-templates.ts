/** Optional human-authored capture outlines provide structure without inventing facts or requesting AI. */
/** Templates are plain Markdown inserted only on an explicit user choice. */
export function captureTemplates(language: "zh" | "en") {
  const values = [
    {
      id: "concept",
      label: ["概念理解", "Concept"],
      headings: [
        [
          "一句话解释",
          "标准定义与条件",
          "直观例子",
          "边界与反例",
          "自测",
          "来源",
        ],
        [
          "One-line explanation",
          "Definition and conditions",
          "Example",
          "Limits and counterexamples",
          "Self-test",
          "Sources",
        ],
      ],
    },
    {
      id: "reading",
      label: ["阅读摘录", "Reading note"],
      headings: [
        ["来源", "原文摘录", "我的理解", "疑问", "可关联的概念"],
        [
          "Source",
          "Excerpt",
          "My understanding",
          "Questions",
          "Related concepts",
        ],
      ],
    },
    {
      id: "problem",
      label: ["问题解决", "Problem solving"],
      headings: [
        [
          "问题",
          "已知条件",
          "尝试与证据",
          "解决过程",
          "验证结果",
          "可复用的经验",
        ],
        [
          "Problem",
          "Known conditions",
          "Attempts and evidence",
          "Solution",
          "Validation",
          "Reusable lessons",
        ],
      ],
    },
    {
      id: "feynman",
      label: ["费曼自测", "Explain simply"],
      headings: [
        [
          "用自己的话解释",
          "生活中的例子",
          "我还说不清的地方",
          "核对后的修正",
          "再次解释",
        ],
        [
          "Explain in my own words",
          "Everyday example",
          "Gaps in my explanation",
          "Corrections after checking",
          "Explain again",
        ],
      ],
    },
  ];
  const index = language === "zh" ? 0 : 1;
  return values.map((value) => ({
    id: value.id,
    label: value.label[index],
    content: value.headings[index]
      .map((heading) => "## " + heading + "\n\n")
      .join("\n"),
  }));
}
