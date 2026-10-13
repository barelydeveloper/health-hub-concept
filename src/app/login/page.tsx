"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

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
      <h1 className="text-2xl font-semibold">Fitness Intelligence</h1>
      <p className="mt-2 text-sm text-muted">Records stay in your database. ChatGPT is an optional client, not the system of record.</p>
      <form onSubmit={onSubmit} className="mt-6 space-y-3">
        <label className="block text-sm">Email
          <input name="email" type="email" autoComplete="username" required className="mt-1 w-full rounded border border-line bg-ink px-3 py-2" defaultValue="owner@localhost" />
        </label>
        <label className="block text-sm">Password
          <input name="password" type="password" autoComplete="current-password" required className="mt-1 w-full rounded border border-line bg-ink px-3 py-2" />
        </label>
        {error ? <p role="alert" className="text-sm text-red-300">{error}</p> : null}
        <button className="rounded bg-accent px-4 py-2 font-semibold text-ink" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
      </form>
    </main>
  );
}
