/** A shared keyboard-first picker for commands and graph entries with one accessible active option. */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { Modal, useT } from "./common";
import { rankPickerItems, type PickerItem } from "../core/action-picker";
/** Keep keyboard focus in the combobox; selecting an option is always an explicit click or non-composing Enter. */
export function ActionPicker({
  title,
  placeholder,
  items,
  recent,
  onClose,
  onChoose,
  extra,
  searchItems,
}: {
  title: string;
  placeholder: string;
  items: PickerItem[];
  recent?: string[];
  onClose: () => void;
  onChoose: (id: string) => void;
  searchItems?: (items: PickerItem[], query: string) => PickerItem[];
  extra?: (query: string) => PickerItem | undefined;
}) {
  const t = useT(),
    id = useId().replace(/:/g, ""),
    input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(""),
    [active, setActive] = useState(0);
  const results = useMemo(
    () =>
      (query && searchItems
        ? searchItems(items, query)
        : rankPickerItems(items, query, recent)
      ).slice(0, 40),
    [items, query, recent, searchItems],
  );
  const additional = extra?.(query),
    rows = additional ? [...results, additional] : results;
  const current = Math.min(active, Math.max(0, rows.length - 1));
  useEffect(() => {
    document
      .getElementById(`${id}-option-${current}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [current, query]);
  return (
    <Modal title={title} onClose={onClose} className="action-picker">
      <label className="action-picker-search">
        <Search size={18} />
        <input
          autoFocus
          ref={input}
          value={query}
          aria-label={placeholder}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls={`${id}-results`}
          aria-activedescendant={
            rows.length ? `${id}-option-${current}` : undefined
          }
          placeholder={placeholder}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (
              event.nativeEvent.isComposing ||
              event.nativeEvent.keyCode === 229 ||
              (event.repeat && event.key === "Enter")
            )
              return;
            if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
              event.preventDefault();
              event.stopPropagation();
              if (event.key === "Home") setActive(0);
              else if (event.key === "End")
                setActive(Math.max(0, rows.length - 1));
              else
                setActive((previous) =>
                  rows.length
                    ? (Math.min(previous, rows.length - 1) +
                        (event.key === "ArrowDown" ? 1 : -1) +
                        rows.length) %
                      rows.length
                    : 0,
                );
            } else if (
              event.key === "Enter" &&
              !event.altKey &&
              !event.ctrlKey &&
              !event.metaKey &&
              !event.shiftKey
            ) {
              event.preventDefault();
              event.stopPropagation();
              if (rows[current]) onChoose(rows[current].id);
            }
          }}
        />
      </label>
      <div
        id={`${id}-results`}
        role="listbox"
        aria-label={title}
        className="action-picker-results"
      >
        {rows.map((item, index) => (
          <button
            key={item.id}
            id={`${id}-option-${index}`}
            type="button"
            role="option"
            aria-selected={index === current}
            tabIndex={-1}
            onMouseMove={() => setActive(index)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onChoose(item.id)}
          >
            <span>
              <strong>{item.label}</strong>
              {item.detail && <small>{item.detail}</small>}
            </span>
            {item.shortcut && <kbd>{item.shortcut}</kbd>}
          </button>
        ))}
        {!rows.length && (
          <p role="status">{t("没有匹配的项目", "No matching items")}</p>
        )}
      </div>
    </Modal>
  );
}
