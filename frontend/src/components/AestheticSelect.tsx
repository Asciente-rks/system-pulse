import React, { useEffect, useMemo, useRef, useState } from "react";

export type SelectOption<T extends string> = {
  value: T;
  label: string;
};

type AestheticSelectProps<T extends string> = {
  value: T;
  options: ReadonlyArray<SelectOption<T>>;
  onChange: (value: T) => void;
  ariaLabel: string;
  disabled?: boolean;
};

export default function AestheticSelect<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  disabled,
}: AestheticSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const selectedLabel = useMemo(() => {
    return options.find((item) => item.value === value)?.label || "";
  }, [options, value]);

  useEffect(() => {
    function handleDocumentMouseDown(event: MouseEvent) {
      const node = event.target as Node | null;
      if (!node || !rootRef.current?.contains(node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleDocumentMouseDown);
    return () => {
      document.removeEventListener("mousedown", handleDocumentMouseDown);
    };
  }, []);

  function onToggle() {
    if (disabled) {
      return;
    }

    setOpen((current) => !current);
  }

  function onPick(nextValue: T) {
    onChange(nextValue);
    setOpen(false);
  }

  return (
    <div className={`aesthetic-select ${open ? "open" : ""}`} ref={rootRef}>
      <button
        type="button"
        className="aesthetic-select-trigger field-input"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={onToggle}
      >
        <span>{selectedLabel}</span>
        <span className="aesthetic-select-caret" aria-hidden="true" />
      </button>

      {open && (
        <div className="aesthetic-select-menu" role="listbox">
          {options.map((option) => {
            const isActive = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={isActive}
                className={`aesthetic-select-option ${isActive ? "active" : ""}`}
                onClick={() => onPick(option.value)}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
