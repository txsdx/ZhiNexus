/** On-demand keyboard reference uses actual desktop configuration instead of permanent instructional clutter. */
import { Modal, useT } from "./common";
import { shortcutModifier } from "../core/action-picker";
import type { DesktopPreferences } from "../core/types";
/** Keep configurable OS shortcuts distinct from in-app editor and navigation controls. */
export function KeyboardHelp({
  desktop,
  onClose,
}: {
  desktop?: DesktopPreferences;
  onClose: () => void;
}) {
  const t = useT(),
    modifier = shortcutModifier();
  const rows = [
    [t("命令面板", "Command palette"), `${modifier}+Shift+P`],
    [t("搜索知识", "Search knowledge"), `${modifier}+K`],
    [t("上一个位置 / 下一个位置", "Previous / next position"), "Alt+← / Alt+→"],
    [
      t("提交对话；输入换行", "Send chat; insert newline"),
      "Enter / Shift+Enter",
    ],
    [t("保存新条目", "Save capture"), `${modifier}+Enter`],
    [
      t("录入框加粗 / 斜体", "Capture bold / italic"),
      `${modifier}+B / ${modifier}+I`,
    ],
    [t("星图查找节点", "Find graph node"), `${modifier}+F`],
    [t("选择复习回忆档位", "Select review rating"), "1 / 2 / 3 / 4"],
    [t("关闭弹窗", "Close dialog"), "Escape"],
  ];
  if (desktop)
    rows.push(
      [
        t("快速记录（全局）", "Quick capture (global)"),
        desktop.captureShortcut,
      ],
      [
        t("截图 / OCR（全局）", "Screenshot / OCR (global)"),
        desktop.ocrShortcut,
      ],
      [t("显示窗口（全局）", "Show window (global)"), desktop.showShortcut],
    );
  return (
    <Modal
      title={t("键盘快捷键", "Keyboard shortcuts")}
      onClose={onClose}
      className="keyboard-help"
    >
      <table>
        <tbody>
          {rows.map(([label, key]) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              <td>
                <kbd>{key.replace("CommandOrControl", modifier)}</kbd>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}
