"use client";
import { useActionState, useState } from "react";
import type { LabelPreset } from "@/server/labels";
import { Alert, Button, Field, inputClass } from "@/components/ui";
import { savePresetAction } from "../../actions";

const n = (v: number | undefined, d: number) => String(v ?? d);

export function PresetForm({ preset }: { preset?: LabelPreset }) {
  const [state, action, pending] = useActionState(savePresetAction.bind(null, preset?.id ?? null), null);
  const [kind, setKind] = useState<"roll" | "sheet">(preset?.kind ?? "roll");
  const id = (s: string) => `${preset?.id ?? "new"}-${s}`;
  const num = (name: string, label: string, value: string, hint?: string, step = "0.01") => (
    <Field label={label} htmlFor={id(name)} hint={hint}><input id={id(name)} name={name} type="number" step={step} min={0} defaultValue={value} required className={inputClass} /></Field>
  );
  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Name" htmlFor={id("name")} className="sm:col-span-2"><input id={id("name")} name="name" required maxLength={60} defaultValue={preset?.name} className={inputClass} /></Field>
        <Field label="Type" htmlFor={id("kind")}>
          <select id={id("kind")} name="kind" value={kind} onChange={(e) => setKind(e.target.value as "roll" | "sheet")} className={inputClass}>
            <option value="roll">Roll (one label per page)</option><option value="sheet">A4 / sheet</option>
          </select>
        </Field>
        {num("labelWidthMm", "Label width (mm)", n(preset?.label_width_mm, 50))}
        {num("labelHeightMm", "Label height (mm)", n(preset?.label_height_mm, 30))}
        {num("paddingMm", "Inner padding (mm)", n(preset?.padding_mm, 1.5))}
        {num("moduleMm", "Narrow bar width (mm)", n(preset?.module_mm, 0.375), "203 dpi: 0.25 or 0.375. 300 dpi: 0.254 or 0.338. Laser: 0.33.", "0.001")}
        {kind === "sheet" && <>
          {num("pageWidthMm", "Page width (mm)", n(preset?.page_width_mm, 210))}
          {num("pageHeightMm", "Page height (mm)", n(preset?.page_height_mm, 297))}
          {num("marginTopMm", "Top margin (mm)", n(preset?.margin_top_mm, 0), "Page top edge to top of first label.")}
          {num("marginLeftMm", "Left margin (mm)", n(preset?.margin_left_mm, 0), "Page left edge to left of first label.")}
          {num("pitchXMm", "Horizontal pitch (mm)", n(preset?.pitch_x_mm, 70), "Left edge of one label to left edge of the next.")}
          {num("pitchYMm", "Vertical pitch (mm)", n(preset?.pitch_y_mm, 37), "Top edge of one label to top edge of the next.")}
          {num("columns", "Columns", n(preset?.columns, 3), undefined, "1")}
          {num("rows", "Rows", n(preset?.rows, 8), undefined, "1")}
        </>}
        {kind === "roll" && <>
          <input type="hidden" name="pageWidthMm" value="10" /><input type="hidden" name="pageHeightMm" value="10" />
          <input type="hidden" name="marginTopMm" value="0" /><input type="hidden" name="marginLeftMm" value="0" />
          <input type="hidden" name="pitchXMm" value="10" /><input type="hidden" name="pitchYMm" value="10" />
          <input type="hidden" name="columns" value="1" /><input type="hidden" name="rows" value="1" />
        </>}
      </div>
      <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" name="isDefault" defaultChecked={preset?.is_default} className="size-5 accent-forest" /> Use by default</label>
      {state && (state.ok ? <Alert tone="success">{state.message}</Alert> : <Alert tone="error">{state.error}</Alert>)}
      <div><Button type="submit" busy={pending}>{preset ? "Save" : "Add label size"}</Button></div>
    </form>
  );
}
