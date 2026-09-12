'use client';

import { useEffect, useState } from 'react';
import { Wallet, Loader2 } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';

interface DaySummary {
  date: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostPhp: number;
  calls: number;
}

interface FeatureSummary {
  feature: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostPhp: number;
  calls: number;
}

const FEATURE_LABELS: Record<string, string> = {
  photo_autofill: 'Photo Auto-fill',
  text_ad_content: 'Ad Copy — Ad Content',
  text_bot_content: 'Ad Copy — BotCake Prompts',
  video_analysis: 'Video Ad Copy — Analysis',
  video_copy: 'Video Ad Copy — Copywriting',
};

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function formatDateLabel(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
}

export default function AiUsageClient() {
  const [loading, setLoading] = useState(true);
  const [daily, setDaily] = useState<DaySummary[]>([]);
  const [byFeature, setByFeature] = useState<FeatureSummary[]>([]);

  useEffect(() => {
    fetch('/api/ai-usage')
      .then(r => r.json())
      .then(data => {
        setDaily(Array.isArray(data.daily) ? data.daily : []);
        setByFeature(Array.isArray(data.byFeature) ? data.byFeature : []);
      })
      .finally(() => setLoading(false));
  }, []);

  const today = daily[daily.length - 1];
  const last7 = daily.slice(-7);
  const last30Cost = daily.reduce((s, d) => s + d.estimatedCostPhp, 0);
  const last7Cost = last7.reduce((s, d) => s + d.estimatedCostPhp, 0);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Wallet size={22} className="text-orange-500" /> AI Usage</h1>
        <p className="text-sm text-gray-500 mt-1">Estimated Claude API cost across all AI features (Ad Copy Generator text/photo/video, autofill). Owner-only.</p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-gray-400 py-12 justify-center">
          <Loader2 size={20} className="animate-spin" /> Loading...
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="card">
              <p className="text-xs text-gray-400 font-medium">Today</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{formatCurrency(today?.estimatedCostPhp ?? 0)}</p>
              <p className="text-xs text-gray-400 mt-1">{today?.calls ?? 0} generation{today?.calls === 1 ? '' : 's'} · {formatTokens((today?.inputTokens ?? 0) + (today?.outputTokens ?? 0))} tokens</p>
            </div>
            <div className="card">
              <p className="text-xs text-gray-400 font-medium">Last 7 Days</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{formatCurrency(last7Cost)}</p>
              <p className="text-xs text-gray-400 mt-1">{last7.reduce((s, d) => s + d.calls, 0)} generations</p>
            </div>
            <div className="card">
              <p className="text-xs text-gray-400 font-medium">Last 30 Days</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{formatCurrency(last30Cost)}</p>
              <p className="text-xs text-gray-400 mt-1">{daily.reduce((s, d) => s + d.calls, 0)} generations</p>
            </div>
          </div>

          <div className="card">
            <p className="text-sm font-semibold text-gray-700 mb-3">Daily Breakdown — Last 30 Days</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                    <th className="py-2 pr-3 font-medium">Date</th>
                    <th className="py-2 pr-3 font-medium">Generations</th>
                    <th className="py-2 pr-3 font-medium">Input Tokens</th>
                    <th className="py-2 pr-3 font-medium">Output Tokens</th>
                    <th className="py-2 pr-3 font-medium">Est. Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {[...daily].reverse().map(d => (
                    <tr key={d.date} className={`border-b border-gray-50 ${d.calls === 0 ? 'text-gray-300' : 'text-gray-700'}`}>
                      <td className="py-1.5 pr-3">{formatDateLabel(d.date)}</td>
                      <td className="py-1.5 pr-3">{d.calls}</td>
                      <td className="py-1.5 pr-3">{formatTokens(d.inputTokens)}</td>
                      <td className="py-1.5 pr-3">{formatTokens(d.outputTokens)}</td>
                      <td className="py-1.5 pr-3 font-medium">{formatCurrency(d.estimatedCostPhp)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {byFeature.length > 0 && (
            <div className="card">
              <p className="text-sm font-semibold text-gray-700 mb-3">By Feature — Last 30 Days</p>
              <div className="space-y-2">
                {byFeature.map(f => (
                  <div key={f.feature} className="flex items-center justify-between text-sm border-b border-gray-50 pb-2 last:border-0">
                    <span className="text-gray-700">{FEATURE_LABELS[f.feature] || f.feature}</span>
                    <span className="text-gray-400 text-xs">{f.calls} calls · {formatTokens(f.inputTokens + f.outputTokens)} tokens</span>
                    <span className="font-medium text-gray-900">{formatCurrency(f.estimatedCostPhp)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="text-[10px] text-gray-400">Estimates use Claude Sonnet 5 pricing ($2/$10 per 1M input/output tokens) and a fixed ₱58/$1 rate — not live FX, for reference only. Check console.anthropic.com for actual billing.</p>
        </>
      )}
    </div>
  );
}
