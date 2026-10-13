"use client";

import { FormEvent, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Panel } from "@/components/Shell";
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

  async function createToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const scopes = ["read", "write", "import"].filter((scope) => form.get(scope) === "on");
    const result = await api<{ data: { token: string } }>("/api/v1/tokens", {
      method: "POST",
      headers: { "idempotency-key": idempotencyKey() },
      body: JSON.stringify({ name: form.get("name"), scopes }),
    });
    setCreated(result.data.token);
    await client.invalidateQueries({ queryKey: ["tokens"] });
  }

  async function revoke(id: string) {
    await api(`/api/v1/tokens/${id}`, { method: "DELETE", headers: { "idempotency-key": idempotencyKey() } });
    await client.invalidateQueries({ queryKey: ["tokens"] });
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <Panel title="Profile">
        {me.data ? <p className="text-sm">{me.data.data.email}. Height {me.data.data.profile?.heightInches ?? "—"} in. Timezone {me.data.data.profile?.timezone ?? "—"}. {me.data.data.profile?.notes}</p> : <p>Loading…</p>}
      </Panel>
      <Panel title="API access">
        <form onSubmit={createToken} className="space-y-2 text-sm">
          <label className="block">Name<input name="name" required className="mt-1 w-full rounded border border-line bg-ink px-3 py-2" /></label>
          <label className="mr-3"><input type="checkbox" name="read" defaultChecked /> read</label>
          <label className="mr-3"><input type="checkbox" name="write" /> write</label>
          <label><input type="checkbox" name="import" /> import</label>
          <button className="mt-2 block rounded bg-accent px-4 py-2 font-semibold text-ink">Create token</button>
        </form>
        {created ? <p className="mt-3 break-all text-sm">Copy this token now. It is not shown again: {created}</p> : null}
        <ul className="mt-3 space-y-2 text-sm">
          {tokens.data?.data.map((token) => (
            <li key={token.id} className="flex items-center justify-between gap-3">
              <span>{token.name} ({token.scopes.join(", ")}) {token.revokedAt ? "revoked" : "active"}</span>
              {token.revokedAt ? null : <button type="button" className="rounded border border-line px-2 py-1" onClick={() => revoke(token.id)}>Revoke</button>}
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="Example ChatGPT commands">
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
          <li>Show my dashboard summary.</li>
          <li>Log a workout today: pull-ups 2, 2, and 1 at 151 lb body weight.</li>
          <li>Record a weigh-in of 151.4 lb this morning.</li>
          <li>What is my pull-up history compared with the previous session?</li>
        </ul>
        <p className="mt-2 text-sm text-muted">Point a GPT Action at the deployed HTTPS OpenAPI file and send the bearer token. The app works with no AI service connected.</p>
      </Panel>
      <Panel title="Audit">
        <ul className="space-y-1 text-sm">
          {audit.data?.data.slice(0, 12).map((row) => <li key={row.id}>{row.createdAt.slice(0, 16).replace("T", " ")} {row.action} {row.entityType}</li>)}
        </ul>
      </Panel>
    </div>
  );
}
