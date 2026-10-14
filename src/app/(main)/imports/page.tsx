"use client";

import { FormEvent, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Panel } from "@/components/Shell";
import { Button, Empty, Loading, Notice, PageHeader } from "@/components/ui";
import { api, idempotencyKey } from "@/lib/api";
import { BUFFERED_ZIP_MAX_BYTES } from "@/lib/import-limits";

interface ImportSummary {
  added?: number;
  skipped?: number;
  revised?: number;
  keptCorrections?: number;
  errors?: number;
  unsupported?: string[];
}

interface ImportBatchView {
  id: string;
  status: string;
  label: string | null;
  startedAt: string;
  progress: { stage?: string } | null;
  lastError: string | null;
  summary: ImportSummary | null;
  errors: Array<{ file: string; message: string }>;
}

interface Imports {
  data: ImportBatchView[];
}

function summaryText(summary: ImportSummary): string {
  return `Added ${summary.added ?? 0}, skipped ${summary.skipped ?? 0}, revised ${summary.revised ?? 0}, kept corrections ${summary.keptCorrections ?? 0}, errors ${summary.errors ?? 0}. Unsupported: ${(summary.unsupported ?? []).join(", ") || "none"}.`;
}

async function readJson(response: Response): Promise<{ data?: ImportBatchView & { batchId?: string; uploadUrl?: string; summary?: ImportSummary }; error?: { message?: string } }> {
  return response.json();
}

async function pollImport(batchId: string): Promise<ImportBatchView> {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const response = await fetch(`/api/v1/imports/${batchId}`);
    const payload = await readJson(response);
    if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? "Import status could not be read.");
    if (payload.data.status === "completed" || payload.data.status === "completed_with_errors" || payload.data.status === "failed") {
      return payload.data;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error("Import is still processing.");
}

async function uploadLargeZip(file: File): Promise<ImportBatchView> {
  const init = await fetch("/api/v1/imports/uploads", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": idempotencyKey() },
    body: JSON.stringify({ filename: file.name, byteSize: file.size }),
  });
  const started = await readJson(init);
  if (!init.ok || !started.data?.batchId || !started.data.uploadUrl) {
    throw new Error(started.error?.message ?? "The upload could not be started.");
  }
  const put = await fetch(started.data.uploadUrl, {
    method: "PUT",
    headers: { "content-type": "application/zip" },
    body: file,
  });
  if (!put.ok) throw new Error("The archive could not be uploaded. Storage may be blocking browser uploads until bucket CORS allows PUT.");
  const complete = await fetch(`/api/v1/imports/uploads/${started.data.batchId}/complete`, {
    method: "POST",
    headers: { "idempotency-key": idempotencyKey() },
  });
  const queued = await readJson(complete);
  if (!complete.ok) throw new Error(queued.error?.message ?? "The upload could not be queued.");
  return pollImport(started.data.batchId);
}

export default function ImportsPage() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["imports"], queryFn: () => api<Imports>("/api/v1/imports") });
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = event.currentTarget.elements.namedItem("files");
    if (!(input instanceof HTMLInputElement) || !input.files?.length) return;
    setPending(true);
    setMessage(null);
    try {
      const files = [...input.files];
      const zip = files.find((file) => file.name.toLowerCase().endsWith(".zip"));
      if (zip && zip.size > BUFFERED_ZIP_MAX_BYTES) {
        const batch = await uploadLargeZip(zip);
        if (batch.status === "failed") throw new Error(batch.lastError ?? "Import failed");
        setMessage(batch.summary ? summaryText(batch.summary) : `Import ${batch.status}.`);
      } else {
        const response = zip
          ? await fetch("/api/v1/imports", { method: "POST", headers: { "content-type": "application/zip", "idempotency-key": idempotencyKey() }, body: await zip.arrayBuffer() })
          : await fetch("/api/v1/imports", {
              method: "POST",
              headers: { "content-type": "application/json", "idempotency-key": idempotencyKey() },
              body: JSON.stringify({ files: await Promise.all(files.map(async (file) => ({ name: file.name, text: await file.text() }))) }),
            });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.error?.message ?? "Import failed");
        setMessage(summaryText(payload.data.summary ?? {}));
      }
      await client.invalidateQueries({ queryKey: ["imports"] });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Import failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Imports" lede="Unknown files are reported and not parsed. A repeated export skips unchanged rows and will not overwrite a corrected record. ZIP files over 4 MB upload directly and finish in the background." />
      <Panel title="Samsung Health ZIP or CSV">
        <form onSubmit={onSubmit} className="space-y-3">
          <label className="block text-sm">Files
            <input name="files" type="file" multiple accept=".csv,.zip,text/csv,application/zip" className="field file:mr-3 file:rounded file:border-0 file:bg-raised file:px-2 file:py-1 file:text-text" />
          </label>
          <Button disabled={pending}>{pending ? "Importing…" : "Import"}</Button>
        </form>
        {message ? <Notice>{message}</Notice> : null}
      </Panel>
      <Panel title="Recent batches">
        {query.error ? <p role="alert" className="text-sm text-danger">{query.error.message}</p> : query.isLoading || !query.data ? <Loading label="Loading imports…" /> : query.data.data.length === 0 ? <Empty>No imports yet.</Empty> : query.data.data.map((batch) => (
          <article key={batch.id} className="border-t border-line py-3 text-sm first:border-t-0">
            <p><span className="num">{batch.startedAt.slice(0, 16).replace("T", " ")}</span> — <span className="badge">{batch.status}</span></p>
            {batch.summary == null ? <p>Status {batch.progress?.stage ?? batch.status}{batch.lastError ? `: ${batch.lastError}` : ""}.</p> : <p>Added {batch.summary.added ?? 0}, skipped {batch.summary.skipped ?? 0}, revised {batch.summary.revised ?? 0}, kept {batch.summary.keptCorrections ?? 0}, errors {batch.summary.errors ?? 0}.</p>}
            {(batch.errors ?? []).slice(0, 5).map((error) => <p key={`${error.file}${error.message}`} className="text-danger">{error.file}: {error.message}</p>)}
          </article>
        ))}
      </Panel>
    </div>
  );
}
