"use client";

import { FormEvent, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Panel } from "@/components/Shell";
import { TrendChart } from "@/components/TrendChart";
import { api, formatNumber, idempotencyKey } from "@/lib/api";

interface Trends {
  data: {
    analysis: {
      normalization: { status: string; reason?: string };
      limitations: string[];
      baselineBodyWaterLb: number | null;
      points: Array<{
        recordedAt: string;
        weightLb: number | null;
        rawBodyFatPercent: number | null;
        rawFatMassLb: number | null;
        rawFatFreeMassLb: number | null;
        bodyWaterLb: number | null;
        hydrationContext: { bodyFatPercent: number | null; fatMassLb: number | null; adjustedWeightLb: number } | null;
        unusualHydration: boolean;
      }>;
    };
  };
}

interface Measurements {
  data: Array<{ id: string; kind: string; value: number | null; recordedAt: string; valueOrigin: string }>;
  tape: Array<{ id: string; site: string; valueInches: number | null; recordedAt: string }>;
}

export default function BodyPage() {
  const client = useQueryClient();
  const trends = useQuery({ queryKey: ["trends"], queryFn: () => api<Trends>("/api/v1/body-composition/trends") });
  const measurements = useQuery({ queryKey: ["measurements"], queryFn: () => api<Measurements>("/api/v1/measurements") });
  const [message, setMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    const weight = Number(form.get("weightLb"));
    const bodyFat = form.get("bodyFatPercent");
    setFormError(null);
    try {
      await api("/api/v1/measurements", {
        method: "POST",
        headers: { "idempotency-key": idempotencyKey() },
        body: JSON.stringify({
          recordedAt: new Date(`${form.get("date")}T11:00:00.000Z`).toISOString(),
          weightLb: weight,
          bodyFatPercent: bodyFat ? Number(bodyFat) : undefined,
        }),
      });
      setMessage("Measurement saved.");
      formEl.reset();
      await client.invalidateQueries({ queryKey: ["trends"] });
      await client.invalidateQueries({ queryKey: ["measurements"] });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Request failed");
    }
  }

  if (trends.error || measurements.error) return <p role="alert">{(trends.error ?? measurements.error)?.message}</p>;
  if (trends.isLoading || measurements.isLoading || !trends.data || !measurements.data) return <p>Loading body composition…</p>;
  const analysis = trends.data.data.analysis;
  const labeled = [...analysis.points].reverse().find((point) => point.rawBodyFatPercent != null && point.hydrationContext?.bodyFatPercent != null);
  const chart = analysis.points.map((point) => ({
    date: point.recordedAt.slice(0, 10),
    weight: point.weightLb,
    rawFat: point.rawBodyFatPercent,
    normalizedFat: point.hydrationContext?.bodyFatPercent ?? null,
    water: point.bodyWaterLb,
    fatMass: point.rawFatMassLb,
    fatFree: point.rawFatFreeMassLb,
  }));
  const tapeBySite = new Map<string, Array<{ date: string; value: number | null }>>();
  for (const row of measurements.data.tape) {
    const list = tapeBySite.get(row.site) ?? [];
    list.push({ date: row.recordedAt.slice(0, 10), value: row.valueInches });
    tapeBySite.set(row.site, list);
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Body composition</h1>
      <p className="text-sm text-muted">{analysis.normalization.status === "ok" ? `Water baseline ${formatNumber(analysis.baselineBodyWaterLb)} lb.` : analysis.normalization.reason}</p>
      <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
        {analysis.limitations.map((item) => <li key={item}>{item}</li>)}
      </ul>
      <Panel title="Weight">
        <TrendChart data={chart} lines={[{ key: "weight", name: "Weight (lb)", color: "#7dd3c7" }]} />
      </Panel>
      <Panel title="Body fat, raw and normalized">
        {labeled ? <p className="mb-2 text-sm">Latest paired reading {labeled.recordedAt.slice(0, 10)}: raw {formatNumber(labeled.rawBodyFatPercent)}%, normalized {formatNumber(labeled.hydrationContext?.bodyFatPercent)}% (estimate).</p> : null}
        <TrendChart data={chart} lines={[{ key: "rawFat", name: "Raw %", color: "#f0b429" }, { key: "normalizedFat", name: "Normalized %", color: "#7dd3c7" }]} />
      </Panel>
      <Panel title="Fat mass and fat-free mass">
        <TrendChart data={chart} lines={[{ key: "fatMass", name: "Fat mass", color: "#f0b429" }, { key: "fatFree", name: "Fat-free mass", color: "#8eb6ff" }]} />
      </Panel>
      <Panel title="Body water">
        <TrendChart data={chart} lines={[{ key: "water", name: "Body water (lb)", color: "#8eb6ff" }]} />
      </Panel>
      <Panel title="Tape">
        {[...tapeBySite.entries()].length === 0 ? <p className="text-sm text-muted">No tape measurements.</p> : [...tapeBySite.entries()].map(([site, rows]) => (
          <p key={site} className="text-sm">{site.replaceAll("_", " ")}: {rows.map((row) => `${row.date} ${formatNumber(row.value)} in`).join(", ")}</p>
        ))}
      </Panel>
      <Panel title="Readings">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead><tr className="text-muted"><th>Date</th><th>Kind</th><th>Value</th><th>Origin</th></tr></thead>
            <tbody>
              {measurements.data.data.map((row) => (
                <tr key={row.id} className="border-t border-line"><td>{row.recordedAt.slice(0, 10)}</td><td>{row.kind}</td><td>{formatNumber(row.value)}</td><td>{row.valueOrigin}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title="Add a reading">
        <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm">Date<input name="date" type="date" required className="mt-1 w-full rounded border border-line bg-ink px-3 py-2" /></label>
          <label className="text-sm">Weight (lb)<input name="weightLb" type="number" step="0.1" min="1" required className="mt-1 w-full rounded border border-line bg-ink px-3 py-2" /></label>
          <label className="text-sm">Body fat %<input name="bodyFatPercent" type="number" step="0.1" min="0" max="100" className="mt-1 w-full rounded border border-line bg-ink px-3 py-2" /></label>
          <button className="rounded bg-accent px-4 py-2 font-semibold text-ink sm:col-span-3">Save</button>
        </form>
        {formError ? <p role="alert" className="mt-2 text-sm">{formError}</p> : null}
        {message ? <p className="mt-2 text-sm">{message}</p> : null}
      </Panel>
    </div>
  );
}
