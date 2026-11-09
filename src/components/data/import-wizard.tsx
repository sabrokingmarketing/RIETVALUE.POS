"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Download, FileSpreadsheet, RefreshCw, Upload, XCircle } from "lucide-react";
import { Alert, Badge, Button, StatTile, cx, inputClass } from "@/components/ui";
import { Dialog } from "@/components/dialog";
import { FIELDS, DEFAULT_OPTIONS, type FieldKey, type ImportOptions } from "@/lib/import-fields";
import { formatDateTime } from "@/lib/dates";

type Job = {
  id: string; fileName: string; format: string; status: string; createdAt: string; createdBy: string; totalRows: number; headers: string[];
  mapping: Partial<Record<FieldKey, string>>; options: ImportOptions; lastError: string | null;
  counts: { new: number; pending: number; ok: number; failed: number; skipped: number };
  actions: { create: number; update: number; unchanged: number; skip: number }; newProducts: number;
};
type Row = { rowNo: number; status: string; action: string | null; message: string; warnings: string[]; changes: Record<string, [unknown, unknown]>; sku: string; name: string; size: string; raw: Record<string, string> };
type Recent = { id: string; file_name: string; status: string; created_at: string; total_rows: number; ok: number; failed: number; created_by: string };

const STEPS = ["Upload", "Map columns", "Check & preview", "Confirm", "Progress", "Results"] as const;
type Step = 0 | 1 | 2 | 3 | 4 | 5;

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try { res = await fetch(url, { ...init, cache: "no-store" }); } catch { throw new Error("No connection. Nothing was changed — try again."); }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: { message?: string } }).error?.message ?? `Server error ${res.status}`);
  return body as T;
}
const post = <T,>(url: string, data: unknown) => api<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });

const rand = (v: unknown) => (typeof v === "number" ? `R${(v / 100).toFixed(2)}` : String(v));
function describe(changes: Row["changes"]) {
  return Object.entries(changes).filter(([k]) => !k.startsWith("_")).map(([k, [a, b]]) => {
    const f = k === "price" ? rand : (x: unknown) => (x === null || x === undefined || x === "" ? "—" : Array.isArray(x) ? x.join(", ") : String(x));
    return k === "supplier_barcodes" ? `adds barcodes ${f(b)}` : k === "image" ? "new photo" : `${k} ${f(a)} → ${f(b)}`;
  }).join(" · ");
}

const ACTION_BADGE: Record<string, { tone: "green" | "neutral" | "warn" | "danger"; label: string }> = {
  create: { tone: "green", label: "New" }, update: { tone: "warn", label: "Update" }, unchanged: { tone: "neutral", label: "No change" }, skip: { tone: "neutral", label: "Skipped" },
};
function rowBadge(r: Row) {
  if (r.status === "failed") return <Badge tone="danger">Problem</Badge>;
  if (r.status === "skipped") return <Badge>Skipped</Badge>;
  if (r.status === "ok") return <Badge tone="green">{r.action === "create" ? "Created" : r.action === "update" ? "Updated" : "No change"}</Badge>;
  const b = ACTION_BADGE[r.action ?? ""] ?? { tone: "neutral" as const, label: r.action ?? "—" };
  return <Badge tone={b.tone}>{b.label}</Badge>;
}

export function ImportWizard({ recent: initialRecent, initialJobId }: { recent: Recent[]; initialJobId?: string }) {
  const [step, setStep] = useState<Step>(0);
  const [job, setJob] = useState<Job | null>(null);
  const [mapping, setMapping] = useState<Partial<Record<FieldKey, string>>>({});
  const [options, setOptions] = useState<ImportOptions>(DEFAULT_OPTIONS);
  const [samples, setSamples] = useState<Record<string, string>[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [filter, setFilter] = useState<"all" | "create" | "update" | "unchanged" | "skipped" | "failed">("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ack, setAck] = useState(false);
  const [edit, setEdit] = useState<Row | null>(null);
  const [recent, setRecent] = useState(initialRecent);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadRows = useCallback(async (id: string, status = "all") => {
    const r = await api<{ job: Job; rows: Row[] }>(`/api/import/${id}?rows=${status}&limit=1000`);
    setJob(r.job); setRows(r.rows); return r;
  }, []);

  const openJob = useCallback(async (id: string) => {
    setError(null); setBusy("open");
    try {
      const r = await loadRows(id);
      setMapping(r.job.mapping); setOptions(r.job.options); setSamples(r.rows.slice(0, 3).map((x) => x.raw));
      setStep(r.job.status === "uploaded" ? 1 : r.job.status === "validated" ? 2 : r.job.status === "queued" || r.job.status === "running" ? 4 : 5);
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }, [loadRows]);
  useEffect(() => { if (initialJobId) openJob(initialJobId); }, [initialJobId, openJob]);

  // Poll progress while the background job runs.
  useEffect(() => {
    if (step !== 4 || !job) return;
    const t = setInterval(async () => {
      try {
        const r = await api<{ job: Job }>(`/api/import/${job.id}`);
        setJob(r.job);
        if (r.job.status === "completed" || r.job.status === "cancelled") {
          clearInterval(t); await loadRows(job.id); setStep(5);
          api<{ jobs: Recent[] }>("/api/import").then((x) => setRecent(x.jobs)).catch(() => {});
        }
      } catch { /* keep polling; the job continues on the server */ }
    }, 1000);
    return () => clearInterval(t);
  }, [step, job, loadRows]);

  const upload = async (file: File) => {
    setError(null); setBusy("upload");
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error("The file is larger than 10 MB. Split it into smaller files.");
      const fd = new FormData(); fd.append("file", file);
      const j = await api<Job>("/api/import", { method: "POST", body: fd });
      setJob(j); setMapping(j.mapping); setOptions(j.options); setAck(false);
      const r = await api<{ rows: Row[] }>(`/api/import/${j.id}?rows=all&limit=3`);
      setSamples(r.rows.map((x) => x.raw)); setStep(1);
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); if (fileRef.current) fileRef.current.value = ""; }
  };

  const validate = async () => {
    if (!job) return; setError(null); setBusy("validate");
    try { await post<Job>(`/api/import/${job.id}`, { action: "validate", mapping, options }); await loadRows(job.id); setFilter("all"); setAck(false); setStep(2); }
    catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };
  const start = async () => {
    if (!job) return; setError(null); setBusy("start");
    try { setJob(await post<Job>(`/api/import/${job.id}`, { action: "start" })); setStep(4); }
    catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };
  const retry = async () => {
    if (!job) return; setError(null); setBusy("retry");
    try { const j = await post<Job>(`/api/import/${job.id}`, { action: "retry" }); setJob(j); if (j.status === "queued" || j.status === "running") setStep(4); else await loadRows(job.id); }
    catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };
  const cancel = async () => {
    if (!job) return; setBusy("cancel");
    try { setJob(await post<Job>(`/api/import/${job.id}`, { action: "cancel" })); await loadRows(job.id); setStep(5); }
    catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };
  const reset = () => { setJob(null); setRows([]); setSamples([]); setStep(0); setError(null); };

  const c = job?.counts; const a = job?.actions;
  const shown = rows.filter((r) => filter === "all" ? true : filter === "failed" ? r.status === "failed" : filter === "skipped" ? r.status === "skipped" : r.status !== "failed" && r.status !== "skipped" && r.action === filter);
  const processed = c ? c.ok + c.failed + c.skipped : 0;
  const pct = job?.totalRows ? Math.round((processed / job.totalRows) * 100) : 0;

  return (
    <div className="flex flex-col gap-5">
      <ol className="flex gap-2 overflow-x-auto pb-1" aria-label="Import steps">
        {STEPS.map((s, i) => (
          <li key={s} aria-current={i === step ? "step" : undefined}
            className={cx("flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-sm", i === step ? "bg-primary font-semibold text-ink" : i < step ? "bg-soft text-deep" : "bg-surface text-muted ring-1 ring-line")}>
            <span className="tabular inline-flex size-6 items-center justify-center rounded-full bg-white/70 text-xs font-bold">{i < step ? "✓" : i + 1}</span>{s}
          </li>
        ))}
      </ol>
      {error && <Alert tone="error">{error}</Alert>}

      {step === 0 && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <label htmlFor="import-file"
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) upload(f); }}
            className={cx("card flex min-h-64 cursor-pointer flex-col items-center justify-center gap-3 border-2 border-dashed p-8 text-center", drag ? "border-deep bg-soft" : "border-field/50")}>
            <span className="inline-flex size-14 items-center justify-center rounded-2xl bg-soft text-deep" aria-hidden><Upload className="size-7" /></span>
            <span className="text-lg font-semibold">{busy === "upload" ? "Reading the file…" : "Choose a CSV or Excel file"}</span>
            <span className="text-sm text-muted">or drag it here · .csv or .xlsx · up to 10 MB / 20 000 rows</span>
            <input ref={fileRef} id="import-file" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} disabled={busy === "upload"} data-testid="import-file" />
          </label>
          <div className="card flex flex-col gap-3 p-5">
            <h2 className="font-semibold">Start from the template</h2>
            <p className="text-sm text-muted">One row per pot size. Rows with the same product handle are sizes of one plant. Rows are matched by SKU, so importing the same file twice never creates duplicates.</p>
            <div className="flex flex-wrap gap-2">
              <a className={cx("inline-flex min-h-11 items-center gap-2 rounded-xl border border-field/60 px-4 text-sm font-semibold hover:bg-soft")} href="/api/import/template?format=xlsx"><FileSpreadsheet className="size-4" aria-hidden /> Template (.xlsx)</a>
              <a className={cx("inline-flex min-h-11 items-center gap-2 rounded-xl border border-field/60 px-4 text-sm font-semibold hover:bg-soft")} href="/api/import/template?format=csv"><Download className="size-4" aria-hidden /> Template (.csv)</a>
            </div>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
              <li>Required on every row: <strong className="text-ink">SKU</strong>. For new items also name, category, pot size and price.</li>
              <li>Format barcode columns as <strong className="text-ink">Text</strong> in Excel so leading zeros stay.</li>
              <li>An export from this page can be edited and imported back.</li>
              <li>Nothing changes until you check the preview and confirm.</li>
            </ul>
          </div>
        </div>
      )}

      {step === 1 && job && (
        <div className="flex flex-col gap-5">
          <div className="card p-5">
            <h2 className="font-semibold">Match your columns · {job.fileName}</h2>
            <p className="mt-1 text-sm text-muted">{job.totalRows.toLocaleString("en-ZA")} data rows. Columns we recognised are already matched — check them and choose any that are missing.</p>
            <div className="mt-4 grid gap-x-6 gap-y-4 md:grid-cols-2">
              {FIELDS.map((f) => {
                const sample = mapping[f.key] ? samples.map((r) => r[mapping[f.key]!]).filter(Boolean).slice(0, 2).join(" · ") : "";
                return (
                  <div key={f.key} className="flex flex-col gap-1">
                    <label htmlFor={`map-${f.key}`} className="flex items-center gap-2 text-sm font-medium">{f.label}
                      {f.requiredAlways ? <Badge tone="danger">Required</Badge> : f.requiredForCreate ? <Badge tone="warn">New items</Badge> : null}</label>
                    <select id={`map-${f.key}`} value={mapping[f.key] ?? ""} className={inputClass}
                      onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value || undefined }))}>
                      <option value="">— Not in this file —</option>
                      {job.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                    </select>
                    <p className="text-xs text-muted">{sample ? <>e.g. <span className="font-mono text-ink">{sample.slice(0, 60)}</span></> : f.help}</p>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="card grid gap-5 p-5 md:grid-cols-2">
            <fieldset><legend className="font-semibold">What may the import do?</legend>
              {([["create_update", "Create new items and update existing ones"], ["create_only", "Create new items only (existing SKUs are skipped)"], ["update_only", "Update existing items only (new SKUs are skipped)"]] as const).map(([v, l]) => (
                <label key={v} className="mt-2 flex min-h-11 items-center gap-3 text-sm"><input type="radio" name="mode" checked={options.mode === v} onChange={() => setOptions({ ...options, mode: v })} className="size-5 accent-deep" />{l}</label>
              ))}
            </fieldset>
            <fieldset><legend className="font-semibold">How should quantities be used?</legend>
              {([["ignore", "Don't change stock"], ["set", "Replace stock with the quantity (a stock count)"], ["add", "Add the quantity to stock (stock received)"]] as const).map(([v, l]) => (
                <label key={v} className="mt-2 flex min-h-11 items-center gap-3 text-sm"><input type="radio" name="stock" checked={options.stock === v} onChange={() => setOptions({ ...options, stock: v })} className="size-5 accent-deep" />{l}</label>
              ))}
              {options.stock === "add" && <p className="mt-1 text-xs text-warn">Each import job adds its quantities once. Importing the same file again as a new job adds them again.</p>}
            </fieldset>
            <fieldset><legend className="font-semibold">Blank cells for existing items</legend>
              <label className="mt-2 flex min-h-11 items-center gap-3 text-sm"><input type="radio" name="blanks" checked={options.blanks === "keep"} onChange={() => setOptions({ ...options, blanks: "keep" })} className="size-5 accent-deep" />Keep the current value</label>
              <label className="mt-2 flex min-h-11 items-center gap-3 text-sm"><input type="radio" name="blanks" checked={options.blanks === "clear"} onChange={() => setOptions({ ...options, blanks: "clear" })} className="size-5 accent-deep" />Clear optional text (botanical name, description, care notes)</label>
            </fieldset>
            <fieldset><legend className="font-semibold">Extras</legend>
              <label className="mt-2 flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={options.createCategories} onChange={(e) => setOptions({ ...options, createCategories: e.target.checked })} className="size-5 accent-deep" />Create missing categories</label>
              <label className="mt-2 flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={options.downloadImages} onChange={(e) => setOptions({ ...options, downloadImages: e.target.checked })} className="size-5 accent-deep" />Download photos from image URLs</label>
            </fieldset>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="lg" onClick={validate} busy={busy === "validate"} disabled={!mapping.sku} data-testid="import-check">Check file</Button>
            <Button size="lg" variant="ghost" onClick={reset}>Choose another file</Button>
            {!mapping.sku && <p className="self-center text-sm text-danger">Match a column to SKU to continue.</p>}
          </div>
        </div>
      )}

      {(step === 2 || step === 3 || step === 5) && job && c && a && (
        <div className="flex flex-col gap-5">
          {step === 5 && (
            <Alert tone={job.status === "cancelled" || c.failed || c.pending ? "warn" : "success"} title={job.status === "cancelled" ? "Import cancelled" : c.failed ? "Import finished with problems" : c.pending ? "Rows waiting to import" : "Import complete"}>
              {job.status !== "cancelled" && <>{c.ok} row{c.ok === 1 ? "" : "s"} imported{c.failed ? `, ${c.failed} need correcting` : ""}{c.skipped ? `, ${c.skipped} skipped` : ""}.</>} {job.lastError}
            </Alert>
          )}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5" data-testid="import-summary">
            <StatTile label={step === 5 ? "Created" : "New sizes"} value={step === 5 ? rows.filter((r) => r.status === "ok" && r.action === "create").length : a.create} sub={step === 5 ? undefined : `${job.newProducts} new plant${job.newProducts === 1 ? "" : "s"}`} />
            <StatTile label={step === 5 ? "Updated" : "Updates"} value={step === 5 ? rows.filter((r) => r.status === "ok" && r.action === "update").length : a.update} />
            <StatTile label="No change" value={step === 5 ? rows.filter((r) => r.status === "ok" && r.action === "unchanged").length : a.unchanged} />
            <StatTile label="Skipped" value={c.skipped} />
            <StatTile label="Problems" value={c.failed} tone={c.failed ? "warn" : "neutral"} testId="import-failed" />
          </div>

          <div className="card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line p-3">
              <div className="flex flex-wrap gap-1" role="group" aria-label="Show rows">
                {([["all", "All"], ["create", "New"], ["update", "Updates"], ["unchanged", "No change"], ["skipped", "Skipped"], ["failed", "Problems"]] as const).map(([k, l]) => (
                  <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}
                    className={cx("min-h-11 rounded-xl px-3 text-sm font-medium", filter === k ? "bg-primary text-ink" : "hover:bg-soft")}>{l}</button>
                ))}
              </div>
              {step === 5 && (
                <div className="flex flex-wrap gap-2">
                  <a className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-field/60 px-3 text-sm font-semibold hover:bg-soft" href={`/api/import/${job.id}/report?format=xlsx`}><Download className="size-4" aria-hidden /> Results (.xlsx)</a>
                  <a className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-field/60 px-3 text-sm font-semibold hover:bg-soft" href={`/api/import/${job.id}/report?format=csv`}>Results (.csv)</a>
                </div>
              )}
            </div>
            <div className="relative max-h-[480px] overflow-auto">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-mist"><tr className="text-xs uppercase tracking-wide text-muted">
                  <th className="px-3 py-2">Row</th><th className="px-3 py-2">SKU</th><th className="px-3 py-2">Plant · size</th><th className="px-3 py-2">Result</th><th className="px-3 py-2">Details</th><th className="px-3 py-2"><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {shown.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-muted">No rows in this view.</td></tr>}
                  {shown.slice(0, 500).map((r) => (
                    <tr key={r.rowNo} className={cx("border-t border-line align-top", r.status === "failed" && "bg-danger-bg/50")}>
                      <td className="tabular px-3 py-2">{r.rowNo}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.sku || "—"}</td>
                      <td className="px-3 py-2">{r.name || <span className="text-muted">(existing)</span>}{r.size && <span className="text-muted"> · {r.size}</span>}</td>
                      <td className="px-3 py-2">{rowBadge(r)}</td>
                      <td className="px-3 py-2">
                        {r.message && <p className="text-danger">{r.message}</p>}
                        {Object.keys(r.changes).length > 0 && r.status !== "failed" && <p>{describe(r.changes)}</p>}
                        {r.warnings.map((w, i) => <p key={i} className="text-warn">{w}</p>)}
                      </td>
                      <td className="px-3 py-2">{r.status === "failed" && job.status !== "cancelled" && <Button variant="secondary" onClick={() => setEdit(r)}>Correct</Button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {shown.length > 500 && <p className="p-3 text-sm text-muted">Showing the first 500 rows. Download the results report for all rows.</p>}
            </div>
          </div>

          {step === 2 && (
            <div className="card flex flex-col gap-3 p-5">
              <h2 className="font-semibold">Confirm the import</h2>
              <p className="text-sm">{c.pending} row{c.pending === 1 ? "" : "s"} will be imported{options.stock !== "ignore" ? ` and stock will be ${options.stock === "set" ? "replaced with the counted quantities" : "increased by the received quantities"}` : "; stock will not change"}.</p>
              {c.failed > 0 && (
                <label className="flex min-h-11 items-start gap-3 text-sm"><input type="checkbox" className="mt-1 size-5 accent-deep" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                  <span>Import the {c.pending} valid rows now. The {c.failed} row{c.failed === 1 ? "" : "s"} with problems will not be imported — you can correct and retry them afterwards.</span></label>
              )}
              <div className="flex flex-wrap gap-2">
                <Button size="lg" onClick={start} busy={busy === "start"} disabled={c.pending === 0 || (c.failed > 0 && !ack)} data-testid="import-confirm">
                  <CheckCircle2 className="size-5" aria-hidden /> Import {c.pending} row{c.pending === 1 ? "" : "s"}</Button>
                <Button size="lg" variant="secondary" onClick={() => setStep(1)}>Back to column matching</Button>
                <Button size="lg" variant="ghost" onClick={cancel} busy={busy === "cancel"}><XCircle className="size-5" aria-hidden /> Cancel import</Button>
              </div>
            </div>
          )}
          {step === 5 && (
            <div className="flex flex-wrap gap-2">
              {(c.failed > 0 || c.pending > 0) && job.status !== "cancelled" && <Button size="lg" onClick={retry} busy={busy === "retry"} data-testid="import-retry"><RefreshCw className="size-5" aria-hidden /> Retry rows with problems</Button>}
              <Button size="lg" variant="secondary" onClick={reset}>Start a new import</Button>
            </div>
          )}
        </div>
      )}

      {step === 4 && job && (
        <div className="card flex flex-col gap-4 p-6" aria-live="polite">
          <h2 className="font-semibold">Importing {job.fileName}…</h2>
          <div className="h-4 overflow-hidden rounded-full bg-soft" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Import progress">
            <div className="h-full rounded-full bg-deep transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="tabular text-sm">{processed.toLocaleString("en-ZA")} of {job.totalRows.toLocaleString("en-ZA")} rows processed · {job.counts.ok} imported · {job.counts.failed} problems</p>
          <p className="text-sm text-muted">The import runs on the server in batches. You can leave this page — it carries on, and resumes safely if the server restarts.</p>
          <div><Button variant="ghost" onClick={cancel} busy={busy === "cancel"}>Stop the import</Button></div>
        </div>
      )}

      {recent.length > 0 && step === 0 && (
        <section className="card p-5">
          <h2 className="mb-3 font-semibold">Recent imports</h2>
          <ul className="divide-y divide-line text-sm">
            {recent.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0"><span className="font-medium">{r.file_name}</span> <span className="text-muted">· {formatDateTime(r.created_at)} · {r.created_by}</span></span>
                <span className="flex items-center gap-2"><Badge tone={r.status === "completed" ? (r.failed ? "warn" : "green") : r.status === "cancelled" ? "neutral" : "warn"}>{r.status}</Badge>
                  <span className="tabular text-muted">{r.ok}/{r.total_rows}</span><Button variant="ghost" onClick={() => openJob(r.id)}>Open</Button></span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Dialog open={!!edit} onClose={() => setEdit(null)} title={edit ? `Correct row ${edit.rowNo}` : ""} wide>
        {edit && job && <EditRow job={job} row={edit} onSaved={async () => { setEdit(null); const r = await loadRows(job.id); if (r.job.status === "queued" || r.job.status === "running") setStep(4); }} />}
      </Dialog>
    </div>
  );
}

function EditRow({ job, row, onSaved }: { job: Job; row: Row; onSaved: () => Promise<void> }) {
  const mapped = FIELDS.filter((f) => job.mapping[f.key]);
  const [cells, setCells] = useState<Record<string, string>>(() => Object.fromEntries(mapped.map((f) => [job.mapping[f.key]!, row.raw[job.mapping[f.key]!] ?? ""])));
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  return (
    <form className="flex flex-col gap-4" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true); setErr(null);
      try {
        const res = await fetch(`/api/import/${job.id}/rows/${row.rowNo}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cells }) });
        const b = await res.json(); if (!res.ok) throw new Error(b.error?.message ?? "Could not save");
        await onSaved();
      } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
    }}>
      <Alert tone="error">{row.message}</Alert>
      <div className="grid gap-3 sm:grid-cols-2">
        {mapped.map((f) => { const h = job.mapping[f.key]!; return (
          <div key={f.key} className="flex flex-col gap-1">
            <label htmlFor={`edit-${f.key}`} className="text-sm font-medium">{f.label} <span className="text-xs text-muted">({h})</span></label>
            <input id={`edit-${f.key}`} className={inputClass} value={cells[h] ?? ""} onChange={(e) => setCells({ ...cells, [h]: e.target.value })} />
          </div>
        ); })}
      </div>
      {err && <Alert tone="error">{err}</Alert>}
      <p className="text-sm text-muted">{job.status === "validated" ? "Saving re-checks this row. If it passes, it is included when you confirm the import." : "Saving re-checks this row and, if it passes, imports it straight away."}</p>
      <div><Button type="submit" busy={busy}>Save and re-check</Button></div>
    </form>
  );
}
