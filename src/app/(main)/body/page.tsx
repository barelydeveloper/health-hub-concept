"use client";

import { FormEvent, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Panel } from "@/components/Shell";
import { TrendChart } from "@/components/TrendChart";
import { Button, Empty, Loading, Notice, PageHeader } from "@/components/ui";
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

  if (trends.error || measurements.error) return <p role="alert" className="text-sm text-danger">{(trends.error ?? measurements.error)?.message}</p>;
  if (trends.isLoading || measurements.isLoading || !trends.data || !measurements.data) return <Loading label="Loading body composition…" />;
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
    <div className="space-y-5">
      <PageHeader title="Body composition" lede={analysis.normalization.status === "ok" ? `Water baseline ${formatNumber(analysis.baselineBodyWaterLb)} lb. Normalized body fat is an estimate and is drawn dashed.` : analysis.normalization.reason} />
      <ul className="space-y-1 text-sm text-muted">
        {analysis.limitations.map((item) => <li key={item} className="border-l-2 border-estimate pl-3">{item}</li>)}
      </ul>
      <Panel title="Weight" note="Measured">
        <TrendChart data={chart} lines={[{ key: "weight", name: "Weight (lb)", color: "#6fbf9a" }]} />
      </Panel>
      <Panel title="Body fat, raw and normalized" note="Solid is measured. Dashed is the hydration estimate.">
        {labeled ? <p className="mb-2 text-sm">Latest paired reading {labeled.recordedAt.slice(0, 10)}: raw {formatNumber(labeled.rawBodyFatPercent)}%, normalized {formatNumber(labeled.hydrationContext?.bodyFatPercent)}% (estimate).</p> : <p className="mb-2 text-sm text-muted">No paired reading has both a raw percentage and a normalized estimate.</p>}
        <TrendChart data={chart} lines={[{ key: "rawFat", name: "Raw %", color: "#d6e36a" }, { key: "normalizedFat", name: "Normalized %", color: "#e0a15c", dashed: true }]} />
      </Panel>
      <Panel title="Fat mass and fat-free mass" note="Fat-free mass is not muscle">
        <TrendChart data={chart} lines={[{ key: "fatMass", name: "Fat mass", color: "#e0a15c" }, { key: "fatFree", name: "Fat-free mass", color: "#6fbf9a" }]} />
      </Panel>
      <Panel title="Body water">
        <TrendChart data={chart} lines={[{ key: "water", name: "Body water (lb)", color: "#8eb4d4" }]} />
      </Panel>
      <Panel title="Tape">
        {[...tapeBySite.entries()].length === 0 ? <Empty>No tape measurements.</Empty> : [...tapeBySite.entries()].map(([site, rows]) => (
          <p key={site} className="text-sm">{site.replaceAll("_", " ")}: {rows.map((row) => `${row.date} ${formatNumber(row.value)} in`).join(", ")}</p>
        ))}
      </Panel>
      <Panel title="Readings">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] text-left text-sm">
            <thead><tr className="text-xs uppercase tracking-wide text-muted"><th className="py-2 pr-3">Date</th><th className="py-2 pr-3">Kind</th><th className="py-2 pr-3">Value</th><th className="py-2">Origin</th></tr></thead>
            <tbody>
              {measurements.data.data.map((row) => (
                <tr key={row.id} className="border-t border-line"><td className="py-2 pr-3">{row.recordedAt.slice(0, 10)}</td><td className="py-2 pr-3">{row.kind.replaceAll("_", " ")}</td><td className="num py-2 pr-3">{formatNumber(row.value)}</td><td className="py-2"><span className="badge">{row.valueOrigin}</span></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title="Add a reading">
        <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm">Date<input name="date" type="date" required className="field" /></label>
          <label className="text-sm">Weight (lb)<input name="weightLb" type="number" step="0.1" min="1" required className="field" /></label>
          <label className="text-sm">Body fat %<input name="bodyFatPercent" type="number" step="0.1" min="0" max="100" className="field" /></label>
          <Button className="sm:col-span-3 sm:w-fit">Save</Button>
        </form>
        {formError ? <Notice tone="danger">{formError}</Notice> : null}
        {message ? <Notice tone="ok">{message}</Notice> : null}
      </Panel>
    </div>
  );
}
