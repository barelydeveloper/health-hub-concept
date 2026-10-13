"use client";

import { FormEvent, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Panel } from "@/components/Shell";
import { TrendChart } from "@/components/TrendChart";
import { Button, Empty, Loading, Notice, PageHeader } from "@/components/ui";
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
  const [formError, setFormError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setFormError(null);
    try {
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
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Request failed");
    }
  }

  if (query.error) return <p role="alert" className="text-sm text-danger">{query.error.message}</p>;
  if (query.isLoading || !query.data) return <Loading label="Loading nutrition…" />;
  const latest = query.data.data.daily[0];

  return (
    <div className="space-y-5">
      <PageHeader title="Nutrition" lede="Daily totals are recomputed from the food entries you store." />
      <Panel title="Latest daily totals">
        {latest ? <p className="text-sm"><span className="num">{latest.date}</span>: <span className="num">{formatNumber(latest.calories, 0)}</span> kcal, protein <span className="num">{formatNumber(latest.proteinG)}</span> g, carbs <span className="num">{formatNumber(latest.carbG)}</span> g, fat <span className="num">{formatNumber(latest.fatG)}</span> g.</p> : <Empty>No daily summaries yet.</Empty>}
      </Panel>
      <Panel title="Calories and protein">
        <div className="space-y-4">
          <TrendChart zeroBaseline data={[...query.data.data.daily].reverse().map((day) => ({ date: day.date, calories: day.calories }))} lines={[{ key: "calories", name: "Calories", color: "#e0a15c" }]} />
          <TrendChart zeroBaseline data={[...query.data.data.daily].reverse().map((day) => ({ date: day.date, protein: day.proteinG }))} lines={[{ key: "protein", name: "Protein (g)", color: "#6fbf9a" }]} />
        </div>
      </Panel>
      <Panel title="Add food">
        <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">Date<input name="date" type="date" required className="field" /></label>
          <label className="text-sm">Name<input name="name" required className="field" /></label>
          <label className="text-sm">Calories<input name="calories" type="number" min="0" required className="field" /></label>
          <label className="text-sm">Protein (g)<input name="protein" type="number" min="0" step="0.1" required className="field" /></label>
          <label className="text-sm">Carbs (g)<input name="carbs" type="number" min="0" step="0.1" required className="field" /></label>
          <label className="text-sm">Fat (g)<input name="fat" type="number" min="0" step="0.1" required className="field" /></label>
          <Button>Save</Button>
        </form>
        {formError ? <Notice tone="danger">{formError}</Notice> : null}
        {message ? <Notice tone="ok">{message}</Notice> : null}
      </Panel>
      <Panel title="History">
        {query.data.data.entries.length === 0 ? <Empty>No food entries yet.</Empty> : (
          <ul className="space-y-1 text-sm">
            {query.data.data.entries.map((entry) => <li key={entry.id} className="border-t border-line py-2 first:border-t-0">{entry.recordedAt.slice(0, 10)} {entry.name}: <span className="num">{formatNumber(entry.calories, 0)}</span> kcal, <span className="num">{formatNumber(entry.proteinG)}</span> g protein <span className="badge">{entry.valueOrigin}</span></li>)}
          </ul>
        )}
      </Panel>
    </div>
  );
}
