"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { api } from "@/lib/api";

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
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api<{ data: { email: string } }>("/api/auth/me"),
  });

  useEffect(() => {
    if (me.error) router.replace("/login");
  }, [me.error, router]);

  if (me.isLoading) return <p className="p-6 text-muted">Loading account…</p>;
  if (me.error) return <p className="p-6 text-muted">Redirecting to sign in…</p>;

  return (
    <div className="min-h-screen md:pl-56">
      <aside className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-panel md:inset-y-0 md:left-0 md:w-56 md:border-r md:border-t-0">
        <p className="hidden px-4 pt-5 text-sm font-semibold text-accent md:block">Fitness Intelligence</p>
        <nav className="grid grid-cols-4 gap-1 p-2 md:grid-cols-1 md:px-3 md:py-4" aria-label="Primary">
          {links.map(([href, label]) => {
            const active = pathname === href;
            return (
              <Link key={href} href={href} className={`rounded px-2 py-2 text-center text-xs md:text-left md:text-sm ${active ? "bg-ink text-accent" : "text-muted"}`}>
                {label}
              </Link>
            );
          })}
        </nav>
      </aside>
      <main className="mx-auto max-w-5xl px-4 pb-24 pt-6 md:pb-10">{children}</main>
    </div>
  );
}

export function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-panel p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">{title}</h2>
      {children}
    </section>
  );
}

export function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-lg border border-line bg-panel p-4">
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {detail ? <p className="mt-1 text-sm text-muted">{detail}</p> : null}
    </div>
  );
}
