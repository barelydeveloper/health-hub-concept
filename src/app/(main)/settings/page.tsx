"use client";

import { FormEvent, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Panel } from "@/components/Shell";
import { Button, Empty, Loading, Notice, PageHeader } from "@/components/ui";
import { api, idempotencyKey } from "@/lib/api";

interface Me { data: { email: string; profile: { heightInches: number | null; timezone: string; notes: string | null } | null } }
interface Tokens { data: Array<{ id: string; name: string; scopes: string[]; revokedAt: string | null; lastUsedAt: string | null }> }
interface Audit { data: Array<{ id: string; action: string; entityType: string; createdAt: string }> }

export default function SettingsPage() {
  const client = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/api/v1/profile") });
  const tokens = useQuery({ queryKey: ["tokens"], queryFn: () => api<Tokens>("/api/v1/tokens") });
  const audit = useQuery({ queryKey: ["audit"], queryFn: () => api<Audit>("/api/v1/audit") });
  const [created, setCreated] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function createToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const scopes = ["read", "write", "import"].filter((scope) => form.get(scope) === "on");
    setActionError(null);
    try {
      const result = await api<{ data: { token: string } }>("/api/v1/tokens", {
        method: "POST",
        headers: { "idempotency-key": idempotencyKey() },
        body: JSON.stringify({ name: form.get("name"), scopes }),
      });
      setCreated(result.data.token);
      await client.invalidateQueries({ queryKey: ["tokens"] });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Request failed");
    }
  }

  async function revoke(id: string) {
    setActionError(null);
    try {
      await api(`/api/v1/tokens/${id}`, { method: "DELETE", headers: { "idempotency-key": idempotencyKey() } });
      await client.invalidateQueries({ queryKey: ["tokens"] });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Request failed");
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Settings" lede="The app works with no AI service connected. A bearer token is only for an external client you choose." />
      <Panel title="Profile">
        {me.error ? <p role="alert" className="text-sm text-danger">{me.error.message}</p> : me.data ? <p className="text-sm">{me.data.data.email}. Height <span className="num">{me.data.data.profile?.heightInches ?? "—"}</span> in. Timezone {me.data.data.profile?.timezone ?? "—"}. {me.data.data.profile?.notes}</p> : <Loading label="Loading profile…" />}
      </Panel>
      <Panel title="API access">
        <form onSubmit={createToken} className="space-y-3 text-sm">
          <label className="block">Name<input name="name" required className="field" /></label>
          <div className="flex flex-wrap gap-4">
            <label className="inline-flex items-center gap-2"><input type="checkbox" name="read" defaultChecked className="h-4 w-4 accent-accent" /> read</label>
            <label className="inline-flex items-center gap-2"><input type="checkbox" name="write" className="h-4 w-4 accent-accent" /> write</label>
            <label className="inline-flex items-center gap-2"><input type="checkbox" name="import" className="h-4 w-4 accent-accent" /> import</label>
          </div>
          <Button>Create token</Button>
        </form>
        {created ? <p className="mt-3 break-all rounded-md border border-estimate/40 bg-ink px-3 py-2 text-sm">Copy this token now. It is not shown again: <span className="num">{created}</span></p> : null}
        {actionError ? <Notice tone="danger">{actionError}</Notice> : null}
        {tokens.error ? <p role="alert" className="mt-3 text-sm text-danger">{tokens.error.message}</p> : tokens.isLoading || !tokens.data ? <Loading label="Loading tokens…" /> : (
          <ul className="mt-3 space-y-2 text-sm">
            {tokens.data.data.length === 0 ? <li><Empty>No tokens yet.</Empty></li> : tokens.data.data.map((token) => (
              <li key={token.id} className="flex items-center justify-between gap-3 border-t border-line py-2">
                <span>{token.name} <span className="text-muted">({token.scopes.join(", ")})</span> <span className="badge">{token.revokedAt ? "revoked" : "active"}</span></span>
                {token.revokedAt ? null : <button type="button" className="btn-ghost" onClick={() => revoke(token.id)}>Revoke</button>}
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel title="Example ChatGPT commands">
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
          <li>Show my dashboard summary.</li>
          <li>Log a workout today: pull-ups 2, 2, and 1 at 151 lb body weight.</li>
          <li>Record a weigh-in of 151.4 lb this morning.</li>
          <li>What is my pull-up history compared with the previous session?</li>
        </ul>
        <p className="mt-2 text-sm text-muted">Point a GPT Action at the deployed HTTPS OpenAPI file and send the bearer token.</p>
      </Panel>
      <Panel title="Audit">
        {audit.error ? <p role="alert" className="text-sm text-danger">{audit.error.message}</p> : audit.isLoading || !audit.data ? <Loading label="Loading audit…" /> : audit.data.data.length === 0 ? <Empty>No audit events yet.</Empty> : (
          <ul className="space-y-1 text-sm">
            {audit.data.data.slice(0, 12).map((row) => <li key={row.id} className="border-t border-line py-2 first:border-t-0"><span className="num text-muted">{row.createdAt.slice(0, 16).replace("T", " ")}</span> {row.action} {row.entityType}</li>)}
          </ul>
        )}
      </Panel>
    </div>
  );
}
