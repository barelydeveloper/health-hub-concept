"use client";

import { FormEvent, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Panel } from "@/components/Shell";
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
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Imports</h1>
      <Panel title="Samsung Health ZIP or CSV">
        <form onSubmit={onSubmit} className="space-y-3">
          <input name="files" type="file" multiple accept=".csv,.zip,text/csv,application/zip" className="block w-full text-sm" />
          <button className="rounded bg-accent px-4 py-2 font-semibold text-ink" disabled={pending}>{pending ? "Importing…" : "Import"}</button>
        </form>
        {message ? <p className="mt-3 text-sm">{message}</p> : null}
        <p className="mt-3 text-sm text-muted">Unknown files are reported and not parsed. A repeated export skips unchanged rows and will not overwrite a corrected record.</p>
      </Panel>
      <Panel title="Recent batches">
        {query.error ? <p>{query.error.message}</p> : query.isLoading || !query.data ? <p>Loading…</p> : query.data.data.length === 0 ? <p className="text-sm text-muted">No imports yet.</p> : query.data.data.map((batch) => (
          <article key={batch.id} className="border-t border-line py-3 text-sm">
            <p>{batch.startedAt.slice(0, 16).replace("T", " ")} — {batch.status}</p>
            <p>Added {batch.summary?.added ?? 0}, skipped {batch.summary?.skipped ?? 0}, revised {batch.summary?.revised ?? 0}, kept {batch.summary?.keptCorrections ?? 0}.</p>
            {batch.errors.slice(0, 5).map((error) => <p key={`${error.file}${error.message}`} className="text-muted">{error.file}: {error.message}</p>)}
          </article>
        ))}
      </Panel>
    </div>
  );
}
