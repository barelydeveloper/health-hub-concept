"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { api } from "@/lib/api";
import { Loading } from "@/components/ui";

const links = [
  ["/", "Overview"],
  ["/body", "Body"],
  ["/workouts", "Workouts"],
  ["/nutrition", "Nutrition"],
  ["/recovery", "Recovery"],
  ["/goals", "Goals"],
  ["/imports", "Imports"],
  ["/settings", "Settings"],
];

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const client = useQueryClient();
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api<{ data: { email: string } }>("/api/auth/me"),
  });

  useEffect(() => {
    if (me.error) router.replace("/login");
  }, [me.error, router]);

  async function signOut() {
    await api("/api/auth/logout", { method: "POST" });
    client.clear();
    router.replace("/login");
  }

  if (me.isLoading) return <div className="p-6"><Loading label="Loading account…" /></div>;
  if (me.error) return <p className="p-6 text-sm text-muted">Redirecting to sign in…</p>;

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[15.5rem_minmax(0,1fr)]">
      <aside className="sticky top-0 z-20 border-b border-line bg-panel lg:h-screen lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between gap-3 px-4 py-3 lg:block lg:px-4 lg:pt-6">
          <div>
            <p className="font-display text-xl font-semibold tracking-wide text-text">Field notes</p>
            <p className="text-xs text-muted">{me.data?.data.email}</p>
          </div>
          <button type="button" className="btn-ghost lg:mt-4" onClick={signOut}>Sign out</button>
        </div>
        <nav className="grid grid-cols-4 gap-1 px-3 pb-3 lg:flex lg:flex-col" aria-label="Primary">
          {links.map(([href, label]) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`rounded-md px-2 py-2 text-center text-xs lg:px-3 lg:text-left lg:text-sm ${active ? "bg-ink text-accent" : "text-muted hover:bg-raised hover:text-text"}`}
              >
                {label}
              </Link>
            );
          })}
        </nav>
      </aside>
      <main className="mx-auto w-full min-w-0 max-w-6xl px-4 py-6 sm:px-6 lg:py-8">{children}</main>
    </div>
  );
}

export function Panel({ title, children, note }: { title: string; children: React.ReactNode; note?: string }) {
  return (
    <section className="rounded-lg border border-line bg-panel p-4 shadow-card">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-lg font-semibold tracking-wide text-text">{title}</h2>
        {note ? <p className="text-xs text-muted">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function Stat({ label, value, detail, tone }: { label: string; value: string; detail?: string; tone?: "measured" | "estimate" }) {
  return (
    <div className="rounded-lg border border-line bg-panel p-4 shadow-card">
      <p className="text-xs uppercase tracking-[0.14em] text-muted">{label}</p>
      <p className={`num mt-1 text-3xl font-semibold ${tone === "estimate" ? "text-estimate" : tone === "measured" ? "text-measured" : "text-text"}`}>{value}</p>
      {detail ? <p className="mt-1 text-sm text-muted">{detail}</p> : null}
    </div>
  );
}
