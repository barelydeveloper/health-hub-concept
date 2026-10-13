"use client";

import { FormEvent, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Panel } from "@/components/Shell";
import { TrendChart } from "@/components/TrendChart";
import { api, formatNumber, idempotencyKey } from "@/lib/api";

interface Nutrition {
  data: {
    entries: Array<{ id: string; recordedAt: string; name: string; calories: number | null; proteinG: number | null; carbG: number | null; fatG: number | null; valueOrigin: string }>;
    daily: Array<{ date: string; calories: number | null; proteinG: number | null; carbG: number | null; fatG: number | null }>;
  };
}

export default function NutritionPage() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["nutrition"], queryFn: () => api<Nutrition>("/api/v1/nutrition") });
  const [message, setMessage] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await api("/api/v1/nutrition", {
      method: "POST",
      headers: { "idempotency-key": idempotencyKey() },
      body: JSON.stringify({
        recordedAt: new Date(`${form.get("date")}T18:00:00.000Z`).toISOString(),
        name: form.get("name"),
        calories: Number(form.get("calories")),
        proteinG: Number(form.get("protein")),
        carbG: Number(form.get("carbs")),
        fatG: Number(form.get("fat")),
      }),
    });
    setMessage("Food entry saved.");
    await client.invalidateQueries({ queryKey: ["nutrition"] });
  }

  if (query.error) return <p role="alert">{query.error.message}</p>;
  if (query.isLoading || !query.data) return <p>Loading nutrition…</p>;
  const latest = query.data.data.daily[0];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Nutrition</h1>
      <Panel title="Latest daily totals">
        {latest ? <p className="text-sm">{latest.date}: {formatNumber(latest.calories, 0)} kcal, protein {formatNumber(latest.proteinG)} g, carbs {formatNumber(latest.carbG)} g, fat {formatNumber(latest.fatG)} g.</p> : <p className="text-sm text-muted">No daily summaries yet.</p>}
      </Panel>
      <Panel title="Calorie trend">
        <TrendChart data={[...query.data.data.daily].reverse().map((day) => ({ date: day.date, calories: day.calories, protein: day.proteinG }))} lines={[{ key: "calories", name: "Calories", color: "#f0b429" }, { key: "protein", name: "Protein (g)", color: "#7dd3c7" }]} />
      </Panel>
      <Panel title="Add food">
        <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">Date<input name="date" type="date" required className="mt-1 w-full rounded border border-line bg-ink px-3 py-2" /></label>
          <label className="text-sm">Name<input name="name" required className="mt-1 w-full rounded border border-line bg-ink px-3 py-2" /></label>
          <label className="text-sm">Calories<input name="calories" type="number" min="0" required className="mt-1 w-full rounded border border-line bg-ink px-3 py-2" /></label>
          <label className="text-sm">Protein (g)<input name="protein" type="number" min="0" step="0.1" required className="mt-1 w-full rounded border border-line bg-ink px-3 py-2" /></label>
          <label className="text-sm">Carbs (g)<input name="carbs" type="number" min="0" step="0.1" required className="mt-1 w-full rounded border border-line bg-ink px-3 py-2" /></label>
          <label className="text-sm">Fat (g)<input name="fat" type="number" min="0" step="0.1" required className="mt-1 w-full rounded border border-line bg-ink px-3 py-2" /></label>
          <button className="rounded bg-accent px-4 py-2 font-semibold text-ink">Save</button>
        </form>
        {message ? <p className="mt-2 text-sm">{message}</p> : null}
      </Panel>
      <Panel title="History">
        <ul className="space-y-1 text-sm">
          {query.data.data.entries.map((entry) => <li key={entry.id}>{entry.recordedAt.slice(0, 10)} {entry.name}: {formatNumber(entry.calories, 0)} kcal, {formatNumber(entry.proteinG)} g protein ({entry.valueOrigin})</li>)}
        </ul>
      </Panel>
    </div>
  );
}
