import type { KeyboardEvent, ReactNode } from "react";

type SegmentedTabsProps<Value extends string> = {
  id: string;
  label: string;
  value: Value;
  options: readonly { value: Value; label: ReactNode }[];
  disabled?: boolean;
  onChange: (value: Value) => void;
};

/** Render the active panel with id={`${id}-panel`} and aria-labelledby={`${id}-${value}`}. */
export function SegmentedTabs<Value extends string>({ id, label, value, options, disabled = false, onChange }: SegmentedTabsProps<Value>) {
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, currentIndex: number) {
    if (disabled || !options.length) return;
    let nextIndex: number;
    switch (event.key) {
      case "ArrowRight": nextIndex = (currentIndex + 1) % options.length; break;
      case "ArrowLeft": nextIndex = (currentIndex - 1 + options.length) % options.length; break;
      case "Home": nextIndex = 0; break;
      case "End": nextIndex = options.length - 1; break;
      default: return;
    }
    event.preventDefault();
    onChange(options[nextIndex].value);
    const tabs = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    tabs?.[nextIndex]?.focus();
  }

  return (
    <div className="segmented-control" role="tablist" aria-label={label} aria-orientation="horizontal">
      {options.map((option, index) => (
        <button key={option.value} type="button" role="tab" id={`${id}-${option.value}`} aria-controls={`${id}-panel`}
          aria-selected={value === option.value} tabIndex={value === option.value ? 0 : -1} disabled={disabled}
          onClick={() => onChange(option.value)} onKeyDown={event => handleKeyDown(event, index)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}
