import { type ReactNode, useEffect, useState } from 'react';
import { apiClient } from '../../api/client';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface QualityMonitorProps {
  workspaceId?: string;
  faithfulnessThreshold?: number;
}

interface TrendData {
  dates: string[];
  faithfulness: number[];
}

interface HeatmapDoc {
  doc_id: string;
  filename: string;
  avg_faithfulness: number;
  avg_relevancy: number;
  avg_hallucination: number;
}

interface HeatmapData {
  documents: HeatmapDoc[];
}

interface LowScoreMessage {
  message_id: string;
  session_id: string;
  content_preview: string;
  faithfulness_score: number;
  evaluated_at: string;
}

interface LowScoresData {
  messages: LowScoreMessage[];
}

interface DistributionData {
  faithfulness: number[];
  answer_relevancy: number[];
  contextual_precision: number[];
  contextual_recall: number[];
  hallucination: number[];
}

// ── Mock data fallbacks ────────────────────────────────────────────────────────

function mockTrend(): TrendData {
  const dates: string[] = [];
  const faithfulness: number[] = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().slice(0, 10));
    faithfulness.push(0.72 + Math.random() * 0.22);
  }
  return { dates, faithfulness };
}

function mockHeatmap(): HeatmapData {
  return {
    documents: [
      { doc_id: '1', filename: 'Contract_v3.pdf', avg_faithfulness: 0.91, avg_relevancy: 0.88, avg_hallucination: 0.05 },
      { doc_id: '2', filename: 'Annual_Report.pdf', avg_faithfulness: 0.74, avg_relevancy: 0.79, avg_hallucination: 0.18 },
      { doc_id: '3', filename: 'HR_Policy.docx', avg_faithfulness: 0.62, avg_relevancy: 0.65, avg_hallucination: 0.28 },
      { doc_id: '4', filename: 'Technical_Spec.md', avg_faithfulness: 0.88, avg_relevancy: 0.92, avg_hallucination: 0.08 },
    ],
  };
}

function mockLowScores(): LowScoresData {
  return {
    messages: [
      { message_id: 'm1', session_id: 's1', content_preview: 'What are the termination clauses?', faithfulness_score: 0.61, evaluated_at: new Date(Date.now() - 3600000).toISOString() },
      { message_id: 'm2', session_id: 's2', content_preview: 'Summarize the financial highlights.', faithfulness_score: 0.58, evaluated_at: new Date(Date.now() - 7200000).toISOString() },
      { message_id: 'm3', session_id: 's1', content_preview: 'Who are the key stakeholders?', faithfulness_score: 0.72, evaluated_at: new Date(Date.now() - 10800000).toISOString() },
    ],
  };
}

function mockDistribution(): DistributionData {
  const gen = (mean: number) =>
    Array.from({ length: 40 }, () => Math.max(0, Math.min(1, mean + (Math.random() - 0.5) * 0.4)));
  return {
    faithfulness: gen(0.82),
    answer_relevancy: gen(0.78),
    contextual_precision: gen(0.75),
    contextual_recall: gen(0.73),
    hallucination: gen(0.12),
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function scoreColor(score: number, invert = false): string {
  const v = invert ? 1 - score : score;
  if (v >= 0.85) return '#22c55e';
  if (v >= 0.70) return '#f59e0b';
  return '#ef4444';
}

function scoreToHeatColor(score: number, invert = false): string {
  const v = invert ? 1 - score : score;
  if (v >= 0.85) return '#bbf7d0';
  if (v >= 0.70) return '#fef08a';
  return '#fecaca';
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ── Skeleton ───────────────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="space-y-6 animate-pulse" aria-busy="true" aria-label="Loading quality monitor">
      <div className="h-8 w-64 rounded bg-slate-200" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
            <div className="h-5 w-40 rounded bg-slate-200" />
            <div className="h-40 rounded bg-slate-100" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Alert Banner ───────────────────────────────────────────────────────────────

function AlertBanner({ dates, faithfulness, threshold }: { dates: string[]; faithfulness: number[]; threshold: number }) {
  const dailyCounts: Record<string, number> = {};
  dates.forEach((date, i) => {
    if (faithfulness[i] < threshold) {
      dailyCounts[date] = (dailyCounts[date] ?? 0) + 1;
    }
  });
  const alertDates = Object.entries(dailyCounts).filter(([, c]) => c >= 3).map(([d]) => d);
  if (!alertDates.length) return null;

  return (
    <div role="alert" className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
      <span className="text-lg leading-none mt-0.5" aria-hidden="true">⚠️</span>
      <div>
        <p className="font-semibold">Quality Alert</p>
        <p className="text-amber-700 mt-0.5">
          3 or more responses fell below the faithfulness threshold on:{' '}
          <span className="font-medium">{alertDates.map(formatDate).join(', ')}</span>.
        </p>
      </div>
    </div>
  );
}

// ── Line Chart (SVG) ───────────────────────────────────────────────────────────

function LineChart({ dates, values, threshold }: { dates: string[]; values: number[]; threshold: number }) {
  const W = 480; const H = 140;
  const PAD = { top: 16, right: 20, bottom: 32, left: 40 };
  const cW = W - PAD.left - PAD.right;
  const cH = H - PAD.top - PAD.bottom;
  if (!values.length) return <div className="h-36 flex items-center justify-center text-slate-400 text-sm">No data</div>;

  const xS = (i: number) => PAD.left + (i / Math.max(values.length - 1, 1)) * cW;
  const yS = (v: number) => PAD.top + (1 - v) * cH;
  const thY = yS(threshold);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="7-day faithfulness trend">
      {[0, 0.25, 0.5, 0.75, 1].map((t) => (
        <g key={t}>
          <line x1={PAD.left} y1={yS(t)} x2={W - PAD.right} y2={yS(t)} stroke="#e2e8f0" strokeWidth="1" />
          <text x={PAD.left - 6} y={yS(t) + 4} textAnchor="end" fontSize="10" fill="#94a3b8">{t.toFixed(2)}</text>
        </g>
      ))}
      <line x1={PAD.left} y1={thY} x2={W - PAD.right} y2={thY} stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="4 3" />
      <text x={W - PAD.right + 2} y={thY + 4} fontSize="9" fill="#f59e0b">{threshold.toFixed(2)}</text>
      <polygon
        points={[`${xS(0)},${PAD.top + cH}`, ...values.map((v, i) => `${xS(i)},${yS(v)}`), `${xS(values.length - 1)},${PAD.top + cH}`].join(' ')}
        fill="var(--dm-primary)" fillOpacity="0.08"
      />
      <polyline points={values.map((v, i) => `${xS(i)},${yS(v)}`).join(' ')} fill="none" stroke="var(--dm-primary)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {values.map((v, i) => (
        <circle key={i} cx={xS(i)} cy={yS(v)} r="4" fill={v < threshold ? '#ef4444' : 'var(--dm-primary)'} stroke="white" strokeWidth="1.5">
          <title>{`${formatDate(dates[i])}: ${v.toFixed(3)}`}</title>
        </circle>
      ))}
      {dates.map((d, i) => (
        <text key={i} x={xS(i)} y={H - 4} textAnchor="middle" fontSize="10" fill="#94a3b8">{formatDate(d)}</text>
      ))}
    </svg>
  );
}

// ── Heatmap ────────────────────────────────────────────────────────────────────

const HEATMAP_METRICS: { key: keyof HeatmapDoc; label: string; invert?: boolean }[] = [
  { key: 'avg_faithfulness', label: 'Faithfulness' },
  { key: 'avg_relevancy', label: 'Relevancy' },
  { key: 'avg_hallucination', label: 'Hallucination', invert: true },
];

function Heatmap({ documents }: { documents: HeatmapDoc[] }) {
  if (!documents.length) return <p className="text-sm text-slate-400 py-4">No document data available.</p>;
  return (
    <div className="overflow-x-auto" role="table" aria-label="Per-document quality heatmap">
      <div className="grid gap-px text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1" style={{ gridTemplateColumns: `1fr repeat(${HEATMAP_METRICS.length}, 100px)` }} role="row">
        <div role="columnheader" className="px-2 py-1">Document</div>
        {HEATMAP_METRICS.map((m) => <div key={String(m.key)} role="columnheader" className="px-2 py-1 text-center">{m.label}</div>)}
      </div>
      <div className="space-y-1">
        {documents.map((doc) => (
          <div key={doc.doc_id} className="grid gap-px items-center" style={{ gridTemplateColumns: `1fr repeat(${HEATMAP_METRICS.length}, 100px)` }} role="row">
            <div role="cell" className="px-2 py-2 text-sm text-slate-700 truncate" title={doc.filename}>{doc.filename}</div>
            {HEATMAP_METRICS.map((m) => {
              const val = doc[m.key] as number;
              return (
                <div key={String(m.key)} role="cell" className="px-2 py-2 rounded text-center text-xs font-semibold tabular-nums" style={{ background: scoreToHeatColor(val, m.invert), color: scoreColor(val, m.invert) }} title={`${m.label}: ${val.toFixed(3)}`}>
                  {val.toFixed(2)}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-4 mt-3 text-xs text-slate-500">
        {[['#bbf7d0', 'Good (≥0.85)'], ['#fef08a', 'Fair (0.70–0.84)'], ['#fecaca', 'Poor (<0.70)']].map(([bg, label]) => (
          <span key={label} className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded" style={{ background: bg }} />{label}</span>
        ))}
      </div>
    </div>
  );
}

// ── Low Score List ─────────────────────────────────────────────────────────────

function LowScoreList({ messages, threshold }: { messages: LowScoreMessage[]; threshold: number }) {
  if (!messages.length) return <p className="text-sm text-slate-400 py-4">No messages below the faithfulness threshold.</p>;
  return (
    <ul className="space-y-2" aria-label="Low-score messages">
      {messages.map((msg) => {
        const color = scoreColor(msg.faithfulness_score);
        return (
          <li key={msg.message_id} className="flex items-start gap-3 rounded-lg border border-slate-100 bg-slate-50 px-4 py-3">
            <span className="shrink-0 mt-0.5 inline-flex items-center justify-center w-12 h-6 rounded-full text-xs font-bold tabular-nums" style={{ background: `${color}20`, color }} aria-label={`Faithfulness: ${msg.faithfulness_score.toFixed(2)}`}>
              {msg.faithfulness_score.toFixed(2)}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-slate-700 truncate">{msg.content_preview}</p>
              <p className="text-xs text-slate-400 mt-0.5">Session {msg.session_id.slice(0, 8)}… · {formatTime(msg.evaluated_at)}</p>
            </div>
            {msg.faithfulness_score < threshold && (
              <span className="shrink-0 text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: '#fecaca', color: '#b91c1c' }}>Below threshold</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ── Histogram (SVG) ────────────────────────────────────────────────────────────

function Histogram({ scores, label, invert = false }: { scores: number[]; label: string; invert?: boolean }) {
  const BINS = 10; const W = 220; const H = 100;
  const PAD = { top: 8, right: 8, bottom: 24, left: 28 };
  const cW = W - PAD.left - PAD.right; const cH = H - PAD.top - PAD.bottom;
  if (!scores.length) return null;
  const counts = Array(BINS).fill(0);
  scores.forEach((s) => { counts[Math.min(Math.floor(s * BINS), BINS - 1)]++; });
  const maxCount = Math.max(...counts, 1);
  const barW = cW / BINS;

  return (
    <div>
      <p className="text-xs font-semibold text-slate-600 mb-1 truncate">{label}</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${label} distribution`}>
        {counts.map((count, i) => {
          const bH = (count / maxCount) * cH;
          const binMid = (i + 0.5) / BINS;
          return (
            <rect key={i} x={PAD.left + i * barW + 1} y={PAD.top + cH - bH} width={barW - 2} height={bH} fill={scoreColor(invert ? 1 - binMid : binMid)} fillOpacity="0.75" rx="1">
              <title>{`${(i / BINS).toFixed(1)}–${((i + 1) / BINS).toFixed(1)}: ${count}`}</title>
            </rect>
          );
        })}
        {[0, 0.5, 1].map((t) => (
          <text key={t} x={PAD.left + t * cW} y={H - 4} textAnchor="middle" fontSize="9" fill="#94a3b8">{t.toFixed(1)}</text>
        ))}
        <line x1={PAD.left} y1={PAD.top + cH} x2={PAD.left + cW} y2={PAD.top + cH} stroke="#e2e8f0" strokeWidth="1" />
      </svg>
    </div>
  );
}

// ── Section Card ───────────────────────────────────────────────────────────────

function SectionCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100" style={{ background: 'var(--dm-surface)' }}>
        <h3 className="text-sm font-semibold text-slate-700" style={{ fontFamily: "'Playfair Display', serif" }}>{title}</h3>
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}

// ── QualityMonitor (main) ──────────────────────────────────────────────────────

const METRIC_LABELS: { key: keyof DistributionData; label: string; invert?: boolean }[] = [
  { key: 'faithfulness', label: 'Faithfulness' },
  { key: 'answer_relevancy', label: 'Answer Relevancy' },
  { key: 'contextual_precision', label: 'Contextual Precision' },
  { key: 'contextual_recall', label: 'Contextual Recall' },
  { key: 'hallucination', label: 'Hallucination', invert: true },
];

export function QualityMonitor({ workspaceId: _workspaceId, faithfulnessThreshold = 0.85 }: QualityMonitorProps) {
  const [trend, setTrend] = useState<TrendData | null>(null);
  const [heatmap, setHeatmap] = useState<HeatmapData | null>(null);
  const [lowScores, setLowScores] = useState<LowScoresData | null>(null);
  const [distribution, setDistribution] = useState<DistributionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchAll() {
      setLoading(true); setError(null);
      try {
        const [trendRes, heatmapRes, lowRes, distRes] = await Promise.allSettled([
          apiClient.get<TrendData>('/eval/analytics/trend?days=7'),
          apiClient.get<HeatmapData>('/eval/analytics/heatmap'),
          apiClient.get<LowScoresData>('/eval/analytics/low-scores?limit=10'),
          apiClient.get<DistributionData>('/eval/analytics/distribution'),
        ]);
        if (cancelled) return;
        setTrend(trendRes.status === 'fulfilled' ? trendRes.value.data : mockTrend());
        setHeatmap(heatmapRes.status === 'fulfilled' ? heatmapRes.value.data : mockHeatmap());
        setLowScores(lowRes.status === 'fulfilled' ? lowRes.value.data : mockLowScores());
        setDistribution(distRes.status === 'fulfilled' ? distRes.value.data : mockDistribution());
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load quality data.');
          setTrend(mockTrend()); setHeatmap(mockHeatmap()); setLowScores(mockLowScores()); setDistribution(mockDistribution());
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchAll();
    return () => { cancelled = true; };
  }, []);

  if (loading) return <Skeleton />;

  return (
    <div className="space-y-5" style={{ fontFamily: "'DM Sans', sans-serif" }} aria-label="Quality Monitor">
      <div>
        <h2 className="text-xl font-semibold text-slate-800" style={{ fontFamily: "'Playfair Display', serif" }}>Quality Monitor</h2>
        <p className="text-sm text-slate-500 mt-0.5">Faithfulness threshold: <span className="font-medium text-slate-700">{faithfulnessThreshold.toFixed(2)}</span></p>
      </div>

      {error && (
        <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-700">
          API unavailable — showing sample data. ({error})
        </div>
      )}

      {trend && <AlertBanner dates={trend.dates} faithfulness={trend.faithfulness} threshold={faithfulnessThreshold} />}

      {trend && (
        <SectionCard title="7-Day Faithfulness Trend">
          <LineChart dates={trend.dates} values={trend.faithfulness} threshold={faithfulnessThreshold} />
          <p className="text-xs text-slate-400 mt-2">Dashed line = threshold ({faithfulnessThreshold.toFixed(2)}). Red dots = below threshold.</p>
        </SectionCard>
      )}

      {heatmap && (
        <SectionCard title="Per-Document Quality Heatmap">
          <Heatmap documents={heatmap.documents} />
        </SectionCard>
      )}

      {lowScores && (
        <SectionCard title="Low-Score Messages">
          <LowScoreList messages={lowScores.messages} threshold={faithfulnessThreshold} />
        </SectionCard>
      )}

      {distribution && (
        <SectionCard title="Metric Distributions">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            {METRIC_LABELS.map((m) => (
              <Histogram key={m.key} scores={distribution[m.key]} label={m.label} invert={m.invert} />
            ))}
          </div>
          <p className="text-xs text-slate-400 mt-3">Bar color reflects quality. Hallucination bars are inverted — lower is better.</p>
        </SectionCard>
      )}
    </div>
  );
}
