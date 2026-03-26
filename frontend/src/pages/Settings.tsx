import { type FormEvent, useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import { getEvalConfig, updateEvalConfig } from '../api/eval';
import type { EvalConfig } from '../types';

// In a real app this would come from the auth store
const IS_ADMIN = true;

// ── Analytics types ────────────────────────────────────────────────────────────

interface TopQuery {
  kb_id: string;
  kb_name: string;
  query_text: string;
  count: number;
}

interface ConfidenceBucket {
  range: string;
  count: number;
}

interface LowConfidenceQuery {
  message_id: string;
  session_id: string;
  query_text: string;
  confidence_score: number;
  kb_name: string;
  created_at: string;
}

interface AnalyticsData {
  topQueries: TopQuery[];
  confidenceBuckets: ConfidenceBucket[];
  lowConfidenceQueries: LowConfidenceQuery[];
}

// ── Mock data fallbacks ────────────────────────────────────────────────────────

function mockAnalytics(): AnalyticsData {
  return {
    topQueries: [
      { kb_id: 'kb1', kb_name: 'HR Policy', query_text: 'What is the vacation policy?', count: 42 },
      { kb_id: 'kb1', kb_name: 'HR Policy', query_text: 'How do I request time off?', count: 38 },
      { kb_id: 'kb2', kb_name: 'Technical Docs', query_text: 'How to set up the dev environment?', count: 31 },
      { kb_id: 'kb2', kb_name: 'Technical Docs', query_text: 'What are the API rate limits?', count: 27 },
      { kb_id: 'kb3', kb_name: 'Legal', query_text: 'What are the termination clauses?', count: 24 },
      { kb_id: 'kb1', kb_name: 'HR Policy', query_text: 'What is the parental leave policy?', count: 19 },
      { kb_id: 'kb3', kb_name: 'Legal', query_text: 'Summarize the NDA requirements', count: 17 },
      { kb_id: 'kb2', kb_name: 'Technical Docs', query_text: 'How to deploy to production?', count: 15 },
      { kb_id: 'kb4', kb_name: 'Finance', query_text: 'What is the expense reimbursement process?', count: 12 },
      { kb_id: 'kb4', kb_name: 'Finance', query_text: 'How to submit a budget request?', count: 9 },
    ],
    confidenceBuckets: [
      { range: '0.0-0.2', count: 3 },
      { range: '0.2-0.4', count: 8 },
      { range: '0.4-0.6', count: 14 },
      { range: '0.6-0.8', count: 31 },
      { range: '0.8-1.0', count: 52 },
    ],
    lowConfidenceQueries: [
      { message_id: 'm1', session_id: 's1', query_text: 'What are the termination clauses in section 4b?', confidence_score: 0.18, kb_name: 'Legal', created_at: new Date(Date.now() - 3600000).toISOString() },
      { message_id: 'm2', session_id: 's2', query_text: 'Explain the indemnification provisions', confidence_score: 0.22, kb_name: 'Legal', created_at: new Date(Date.now() - 7200000).toISOString() },
      { message_id: 'm3', session_id: 's3', query_text: 'What is the arbitration process?', confidence_score: 0.31, kb_name: 'Legal', created_at: new Date(Date.now() - 10800000).toISOString() },
      { message_id: 'm4', session_id: 's4', query_text: 'How are bonuses calculated for part-time employees?', confidence_score: 0.35, kb_name: 'HR Policy', created_at: new Date(Date.now() - 14400000).toISOString() },
      { message_id: 'm5', session_id: 's5', query_text: 'What is the rollover policy for unused PTO?', confidence_score: 0.38, kb_name: 'HR Policy', created_at: new Date(Date.now() - 18000000).toISOString() },
    ],
  };
}

// ── Confidence Bar Chart (pure SVG) ───────────────────────────────────────────

function ConfidenceBarChart({ buckets }: { buckets: ConfidenceBucket[] }) {
  if (!buckets.length) return <p className="text-sm text-slate-400 py-4">No data available.</p>;

  const W = 480; const H = 160;
  const PAD = { top: 16, right: 20, bottom: 40, left: 44 };
  const cW = W - PAD.left - PAD.right;
  const cH = H - PAD.top - PAD.bottom;
  const maxCount = Math.max(...buckets.map((b) => b.count), 1);
  const barW = cW / buckets.length;

  // Color bars by confidence range (low = red, high = green)
  const barColors = ['#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e'];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Answer confidence distribution">
      {/* Y-axis gridlines */}
      {[0, 0.25, 0.5, 0.75, 1].map((t) => {
        const y = PAD.top + (1 - t) * cH;
        return (
          <g key={t}>
            <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} stroke="#e2e8f0" strokeWidth="1" />
            <text x={PAD.left - 6} y={y + 4} textAnchor="end" fontSize="10" fill="#94a3b8">
              {Math.round(t * maxCount)}
            </text>
          </g>
        );
      })}
      {/* Bars */}
      {buckets.map((bucket, i) => {
        const bH = (bucket.count / maxCount) * cH;
        const x = PAD.left + i * barW;
        const y = PAD.top + cH - bH;
        return (
          <g key={bucket.range}>
            <rect x={x + 4} y={y} width={barW - 8} height={bH} fill={barColors[i] ?? 'var(--dm-primary)'} fillOpacity="0.85" rx="3">
              <title>{`${bucket.range}: ${bucket.count} queries`}</title>
            </rect>
            {/* Count label on top of bar */}
            {bH > 14 && (
              <text x={x + barW / 2} y={y + 12} textAnchor="middle" fontSize="10" fill="white" fontWeight="600">
                {bucket.count}
              </text>
            )}
            {/* X-axis label */}
            <text x={x + barW / 2} y={H - 8} textAnchor="middle" fontSize="10" fill="#64748b">
              {bucket.range}
            </text>
          </g>
        );
      })}
      {/* Axes */}
      <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={PAD.top + cH} stroke="#cbd5e1" strokeWidth="1" />
      <line x1={PAD.left} y1={PAD.top + cH} x2={W - PAD.right} y2={PAD.top + cH} stroke="#cbd5e1" strokeWidth="1" />
      {/* Y-axis label */}
      <text x={10} y={PAD.top + cH / 2} textAnchor="middle" fontSize="10" fill="#94a3b8" transform={`rotate(-90, 10, ${PAD.top + cH / 2})`}>
        Queries
      </text>
    </svg>
  );
}

// ── Chat Analytics Section ─────────────────────────────────────────────────────

function ChatAnalytics() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [usingMock, setUsingMock] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function fetchAnalytics() {
      setLoading(true);
      try {
        const [topRes, distRes, lowRes] = await Promise.allSettled([
          apiClient.get<{ queries: TopQuery[] }>('/eval/analytics/top-queries?limit=10'),
          apiClient.get<{ buckets: ConfidenceBucket[] }>('/eval/analytics/confidence-distribution'),
          apiClient.get<{ queries: LowConfidenceQuery[] }>('/eval/analytics/low-confidence?limit=10'),
        ]);
        if (cancelled) return;

        const allFailed = [topRes, distRes, lowRes].every((r) => r.status === 'rejected');
        if (allFailed) {
          setData(mockAnalytics());
          setUsingMock(true);
        } else {
          const mock = mockAnalytics();
          setData({
            topQueries: topRes.status === 'fulfilled' ? topRes.value.data.queries : mock.topQueries,
            confidenceBuckets: distRes.status === 'fulfilled' ? distRes.value.data.buckets : mock.confidenceBuckets,
            lowConfidenceQueries: lowRes.status === 'fulfilled' ? lowRes.value.data.queries : mock.lowConfidenceQueries,
          });
        }
      } catch {
        if (!cancelled) {
          setData(mockAnalytics());
          setUsingMock(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchAnalytics();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-6 animate-pulse" aria-busy="true" aria-label="Loading chat analytics">
        <div className="h-6 w-48 rounded bg-slate-200 mb-6" />
        <div className="space-y-3">
          <div className="h-4 w-full rounded bg-slate-100" />
          <div className="h-4 w-5/6 rounded bg-slate-100" />
          <div className="h-4 w-4/6 rounded bg-slate-100" />
        </div>
      </section>
    );
  }

  if (!data) return null;

  const maxCount = Math.max(...data.topQueries.map((q) => q.count), 1);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h3 className="font-heading text-lg font-semibold text-slate-700">Chat Analytics</h3>
        {usingMock && (
          <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
            Sample data
          </span>
        )}
      </div>

      {/* Top 10 Queries per KB */}
      <div>
        <h4 className="text-sm font-semibold text-slate-600 mb-3">Top 10 Queries by Knowledge Base</h4>
        <div className="overflow-x-auto rounded-lg border border-slate-100">
          <table className="w-full text-sm" aria-label="Top queries per knowledge base">
            <thead>
              <tr className="bg-[var(--dm-surface)] text-left">
                <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">#</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Knowledge Base</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Query</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide text-right">Count</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.topQueries.map((q, i) => (
                <tr key={`${q.kb_id}-${i}`} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-2.5 text-slate-400 tabular-nums">{i + 1}</td>
                  <td className="px-4 py-2.5">
                    <span className="inline-block rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: 'var(--dm-primary-light)', color: 'var(--dm-primary-dark)' }}>
                      {q.kb_name}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-700 max-w-xs truncate" title={q.query_text}>{q.query_text}</td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="h-1.5 rounded-full bg-slate-100 w-16 overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${(q.count / maxCount) * 100}%`, background: 'var(--dm-primary)' }}
                        />
                      </div>
                      <span className="tabular-nums font-medium text-slate-700 w-6 text-right">{q.count}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Confidence Distribution Chart */}
      <div>
        <h4 className="text-sm font-semibold text-slate-600 mb-3">Answer Confidence Distribution</h4>
        <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
          <ConfidenceBarChart buckets={data.confidenceBuckets} />
          <p className="text-xs text-slate-400 mt-2 text-center">Confidence score ranges (0 = low, 1 = high)</p>
        </div>
      </div>

      {/* Low-Confidence Query List */}
      <div>
        <h4 className="text-sm font-semibold text-slate-600 mb-3">Low-Confidence Queries</h4>
        {data.lowConfidenceQueries.length === 0 ? (
          <p className="text-sm text-slate-400 py-2">No low-confidence queries found.</p>
        ) : (
          <ul className="space-y-2" aria-label="Low-confidence queries">
            {data.lowConfidenceQueries.map((q) => {
              const pct = Math.round(q.confidence_score * 100);
              const color = pct < 30 ? '#ef4444' : pct < 50 ? '#f97316' : '#f59e0b';
              return (
                <li key={q.message_id} className="flex items-start gap-3 rounded-lg border border-slate-100 bg-slate-50 px-4 py-3">
                  <span
                    className="shrink-0 mt-0.5 inline-flex items-center justify-center w-12 h-6 rounded-full text-xs font-bold"
                    style={{ background: `${color}20`, color }}
                    aria-label={`Confidence: ${pct}%`}
                  >
                    {pct}%
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-700 truncate" title={q.query_text}>{q.query_text}</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {q.kb_name} · {new Date(q.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

export function Settings() {
  const [config, setConfig] = useState<EvalConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!IS_ADMIN) return;
    getEvalConfig().then(setConfig).catch(() => {});
  }, []);

  const handleChange = (key: keyof EvalConfig, value: number | boolean) => {
    setConfig((prev) => prev ? { ...prev, [key]: value } : prev);
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!config) return;
    setSaving(true);
    try {
      const updated = await updateEvalConfig(config);
      setConfig(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 max-w-3xl flex flex-col gap-8">
      <h2 className="font-heading text-2xl font-semibold text-slate-800">Settings</h2>

      {/* Workspace config placeholder */}
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h3 className="font-heading text-lg font-semibold text-slate-700 mb-4">Workspace</h3>
        <p className="text-sm text-slate-500">Workspace configuration options will appear here.</p>
      </section>

      {/* Eval thresholds — Admin only */}
      {IS_ADMIN && config && (
        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h3 className="font-heading text-lg font-semibold text-slate-700 mb-4">Evaluation Thresholds</h3>
          <form onSubmit={handleSave} className="flex flex-col gap-4">
            <ThresholdField
              label="Faithfulness threshold"
              value={config.faithfulness_threshold}
              onChange={(v) => handleChange('faithfulness_threshold', v)}
            />
            <ThresholdField
              label="Answer relevancy threshold"
              value={config.answer_relevancy_threshold}
              onChange={(v) => handleChange('answer_relevancy_threshold', v)}
            />
            <ThresholdField
              label="Contextual precision threshold"
              value={config.contextual_precision_threshold}
              onChange={(v) => handleChange('contextual_precision_threshold', v)}
            />
            <ThresholdField
              label="Contextual recall threshold"
              value={config.contextual_recall_threshold}
              onChange={(v) => handleChange('contextual_recall_threshold', v)}
            />
            <ThresholdField
              label="Hallucination threshold (max)"
              value={config.hallucination_threshold}
              onChange={(v) => handleChange('hallucination_threshold', v)}
            />
            <div className="flex items-center gap-3 pt-1">
              <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={config.multi_turn_enabled}
                  onChange={(e) => handleChange('multi_turn_enabled', e.target.checked)}
                  className="rounded border-slate-300 text-[var(--dm-primary)] focus:ring-[var(--dm-primary)]"
                />
                Enable multi-turn evaluation
              </label>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-[var(--dm-primary)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--dm-primary-dark)] disabled:opacity-50 transition-colors"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              {saved && <span className="text-sm text-green-600">Saved</span>}
            </div>
          </form>
        </section>
      )}

      {/* Chat Analytics — Admin only */}
      {IS_ADMIN && <ChatAnalytics />}
    </div>
  );
}

function ThresholdField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <label className="text-sm text-slate-700">{label}</label>
      <input
        type="number"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-24 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-right outline-none focus:ring-2 focus:ring-[var(--dm-primary)]"
      />
    </div>
  );
}
