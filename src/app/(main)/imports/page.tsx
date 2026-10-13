"use client";

import { FormEvent, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Panel } from "@/components/Shell";
import { Button, Empty, Loading, Notice, PageHeader } from "@/components/ui";
import { api, idempotencyKey } from "@/lib/api";

interface Imports {
  data: Array<{ id: string; status: string; label: string | null; startedAt: string; summary: { added?: number; skipped?: number; revised?: number; keptCorrections?: number; errors?: number; unsupported?: string[] } | null; errors: Array<{ file: string; message: string }> }>;
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
      const response = zip
        ? await fetch("/api/v1/imports", { method: "POST", headers: { "content-type": "application/zip", "idempotency-key": idempotencyKey() }, body: await zip.arrayBuffer() })
        : await fetch("/api/v1/imports", {
            method: "POST",
            headers: { "content-type": "application/json", "idempotency-key": idempotencyKey() },
            body: JSON.stringify({ files: await Promise.all(files.map(async (file) => ({ name: file.name, text: await file.text() }))) }),
          });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message ?? "Import failed");
      const summary = payload.data.summary;
      setMessage(`Added ${summary.added}, skipped ${summary.skipped}, revised ${summary.revised}, kept corrections ${summary.keptCorrections}, errors ${summary.errors}. Unsupported: ${(summary.unsupported ?? []).join(", ") || "none"}.`);
      await client.invalidateQueries({ queryKey: ["imports"] });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Import failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Imports" lede="Unknown files are reported and not parsed. A repeated export skips unchanged rows and will not overwrite a corrected record." />
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
            {batch.summary == null ? <p>Summary unavailable ({batch.status}).</p> : <p>Added {batch.summary.added ?? 0}, skipped {batch.summary.skipped ?? 0}, revised {batch.summary.revised ?? 0}, kept {batch.summary.keptCorrections ?? 0}.</p>}
            {(batch.errors ?? []).slice(0, 5).map((error) => <p key={`${error.file}${error.message}`} className="text-danger">{error.file}: {error.message}</p>)}
          </article>
        ))}
      </Panel>
    </div>
  );
}
