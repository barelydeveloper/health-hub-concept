"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Button, Notice } from "@/components/ui";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
      });
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">
      <p className="text-xs font-medium uppercase tracking-[0.16em] text-accent">Training record</p>
      <h1 className="font-display text-4xl font-semibold tracking-tight">Fitness Intelligence</h1>
      <p className="mt-2 text-sm text-muted">Records stay in your database. ChatGPT is an optional client, not the system of record.</p>
      <form onSubmit={onSubmit} className="mt-6 space-y-3 rounded-lg border border-line bg-panel p-4 shadow-card">
        <label className="block text-sm">Email
          <input name="email" type="email" autoComplete="username" required className="field" defaultValue="owner@localhost" />
        </label>
        <label className="block text-sm">Password
          <input name="password" type="password" autoComplete="current-password" required className="field" />
        </label>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <Button disabled={pending}>{pending ? "Signing in…" : "Sign in"}</Button>
      </form>
    </main>
  );
}
