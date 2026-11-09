"use client";
import { useEffect, useRef, useState } from "react";

/** Renders the actual label PDF (first pages) onto canvases with pdf.js, so the preview works on phones and tablets too. */
export function PdfPreview({ url, maxPages = 6 }: { url: string; maxPages?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ status: "loading" | "ready" | "error"; pages?: number }>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setState({ status: "loading" });
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const doc = await pdfjs.getDocument({ url, withCredentials: true }).promise;
        const el = box.current;
        if (!el || cancelled) return;
        el.replaceChildren();
        const n = Math.min(doc.numPages, maxPages);
        for (let i = 1; i <= n; i++) {
          const page = await doc.getPage(i);
          const base = page.getViewport({ scale: 1 });
          const cssWidth = Math.min(el.clientWidth - 2, base.width * 3);
          const scale = (cssWidth / base.width) * (window.devicePixelRatio || 1);
          const vp = page.getViewport({ scale });
          const canvas = document.createElement("canvas");
          canvas.width = vp.width; canvas.height = vp.height;
          canvas.style.width = `${cssWidth}px`;
          canvas.className = "mx-auto mb-3 block bg-white shadow ring-1 ring-line";
          canvas.setAttribute("aria-label", `Label page ${i} of ${doc.numPages}`);
          canvas.setAttribute("role", "img");
          el.appendChild(canvas);
          await page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport: vp }).promise;
          if (cancelled) return;
        }
        setState({ status: "ready", pages: doc.numPages });
      } catch {
        if (!cancelled) setState({ status: "error" });
      }
    })();
    return () => { cancelled = true; };
  }, [url, maxPages]);

  return (
    <div>
      <div ref={box} className="max-h-[70vh] overflow-y-auto rounded-lg border border-line bg-mist p-3" data-testid="label-preview" />
      <p className="mt-2 text-xs text-muted" role="status">
        {state.status === "loading" && "Rendering preview…"}
        {state.status === "error" && "Preview could not be drawn here — open the PDF to check it."}
        {state.status === "ready" && (state.pages! > maxPages ? `Showing the first ${maxPages} of ${state.pages} pages.` : `${state.pages} page${state.pages === 1 ? "" : "s"}.`)}
      </p>
    </div>
  );
}
