import { useState } from "react";

export default function NumberInput({ value, onChange, min, max, step, placeholder, className, disabled }: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState(String(value ?? 0));

  function commit() {
    const n = Number(editVal);
    if (Number.isFinite(n)) {
      let v = n;
      if (min !== undefined) v = Math.max(min, v);
      if (max !== undefined) v = Math.min(max, v);
      onChange(v);
    }
    setEditing(false);
  }

  function dec() {
    const v = Math.max(min ?? -Infinity, (value ?? 0) - (step ?? 1));
    onChange(v);
    setEditVal(String(v));
  }

  function inc() {
    const v = Math.min(max ?? Infinity, (value ?? 0) + (step ?? 1));
    onChange(v);
    setEditVal(String(v));
  }

  return (
    <div className={`inline-flex items-center border rounded overflow-hidden bg-transparent ${className || ""} ${disabled ? "opacity-50" : ""}`}>
      <button type="button" disabled={disabled} onClick={dec} className="w-8 h-8 flex items-center justify-center text-lg font-bold hover:bg-slate-100 dark:hover:bg-slate-700 active:bg-slate-200 dark:active:bg-slate-600">−</button>
      {editing ? (
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={editVal}
          onChange={e => setEditVal(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === "Enter") commit(); }}
          autoFocus
          className="w-14 text-center bg-transparent outline-none text-sm"
        />
      ) : (
        <button type="button" disabled={disabled} onClick={() => { setEditVal(String(value ?? 0)); setEditing(true); }} className="w-14 text-center text-sm font-medium">
          {value ?? 0}
        </button>
      )}
      <button type="button" disabled={disabled} onClick={inc} className="w-8 h-8 flex items-center justify-center text-lg font-bold hover:bg-slate-100 dark:hover:bg-slate-700 active:bg-slate-200 dark:active:bg-slate-600">+</button>
    </div>
  );
}