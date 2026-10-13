import type { ButtonHTMLAttributes, ReactNode } from "react";

export function PageHeader({ title, lede }: { title: string; lede?: string }) {
  return (
    <header className="space-y-1">
      <p className="text-xs font-medium uppercase tracking-[0.16em] text-accent">Training record</p>
      <h1 className="font-display text-3xl font-semibold tracking-tight">{title}</h1>
      {lede ? <p className="max-w-2xl text-sm text-muted">{lede}</p> : null}
    </header>
  );
}

export function Button({ children, className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`btn ${className}`} {...props}>{children}</button>;
}

export function Notice({ tone = "info", children }: { tone?: "info" | "ok" | "danger"; children: ReactNode }) {
  const color = tone === "danger" ? "text-danger" : tone === "ok" ? "text-measured" : "text-muted";
  return <p role={tone === "danger" ? "alert" : "status"} className={`text-sm ${color}`}>{children}</p>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-md border border-dashed border-line px-3 py-4 text-sm text-muted">{children}</p>;
}

export function Loading({ label }: { label: string }) {
  return (
    <div className="space-y-3" role="status">
      <p className="text-sm text-muted">{label}</p>
      <div className="h-16 animate-pulse rounded-lg bg-panel" />
      <div className="h-28 animate-pulse rounded-lg bg-panel" />
    </div>
  );
}

export function Delta({ value, unit }: { value: number | null; unit: string }) {
  if (value == null) return <span className="text-muted">—</span>;
  const tone = value > 0 ? "text-measured" : value < 0 ? "text-estimate" : "text-muted";
  const sign = value > 0 ? "+" : "";
  return <span className={`num text-lg ${tone}`}>{sign}{value} {unit}</span>;
}
