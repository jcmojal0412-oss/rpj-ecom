'use client';

import { Fragment, useEffect, useState } from 'react';
import { Vault, ChevronDown, ChevronUp } from 'lucide-react';
import Spinner from '@/components/ui/Spinner';

interface VaultProduct {
  id: number;
  sku: string;
  name: string;
  category: string | null;
  cogs: number | null;
  srp: number | null;
  ai_score: number | null;
  season: string | null;
  research_notes: string | null;
  decision: string | null;
  perceived_value_score: number | null;
  ai_research_json: string | null;
  created_at: string;
}

const DECISION_BADGE: Record<string, string> = {
  SCALE:  'badge-green',
  TEST:   'badge-amber',
  REJECT: 'badge-red',
};

export default function ProductVaultClient() {
  const [products, setProducts] = useState<VaultProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  useEffect(() => {
    fetch('/api/ai-research/vault')
      .then(r => r.json())
      .then(data => setProducts(Array.isArray(data) ? data : []))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-orange-100 rounded-xl">
          <Vault className="text-orange-500" size={22} />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Product Vault</h1>
          <p className="text-sm text-gray-500 mt-0.5">AI-researched products saved from Product Hunter</p>
        </div>
      </div>

      {loading && (
        <div className="card flex justify-center py-16"><Spinner size={28} /></div>
      )}

      {!loading && products.length === 0 && (
        <div className="card text-center py-16 text-sm text-gray-500">
          No saved products yet. Go to Product Hunter and click "Save to Product Vault" on a recommendation.
        </div>
      )}

      {!loading && products.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="table-header">Product</th>
                <th className="table-header">Category</th>
                <th className="table-header">Season</th>
                <th className="table-header text-right">COGS</th>
                <th className="table-header text-right">SRP</th>
                <th className="table-header text-right">AI Score</th>
                <th className="table-header">Decision</th>
                <th className="table-header"></th>
              </tr>
            </thead>
            <tbody>
              {products.map((p, i) => {
                let parsed: any = null;
                try { parsed = p.ai_research_json ? JSON.parse(p.ai_research_json) : null; } catch {}
                const isExpanded = expandedId === p.id;
                return (
                  <Fragment key={p.id}>
                    <tr className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="table-cell font-semibold text-gray-900">{p.name}</td>
                      <td className="table-cell text-gray-600">{p.category ?? '-'}</td>
                      <td className="table-cell text-gray-600">{p.season ?? '-'}</td>
                      <td className="table-cell text-right text-gray-600">₱{p.cogs ?? '-'}</td>
                      <td className="table-cell text-right text-gray-600">₱{p.srp ?? '-'}</td>
                      <td className="table-cell text-right font-bold text-gray-800">{p.ai_score ?? '-'}</td>
                      <td className="table-cell">
                        {p.decision && <span className={DECISION_BADGE[p.decision] ?? 'badge-gray'}>{p.decision}</span>}
                      </td>
                      <td className="table-cell">
                        <button
                          onClick={() => setExpandedId(isExpanded ? null : p.id)}
                          className="text-blue-600 hover:text-blue-800"
                        >
                          {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </button>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-blue-50/40">
                        <td colSpan={8} className="px-4 py-4 text-xs text-gray-700 space-y-2">
                          <p className="whitespace-pre-line">{p.research_notes}</p>
                          {parsed && (
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 pt-2">
                              <p><b>Target Market:</b> {parsed.target_market}</p>
                              <p><b>Suggested Offer:</b> {parsed.suggested_offer}</p>
                              <p><b>Suggested Audience:</b> {parsed.suggested_audience}</p>
                              <p><b>Compliance Risk:</b> {parsed.compliance_risk}</p>
                              <p><b>RTS Risk:</b> {parsed.rts_risk}</p>
                              <p><b>Perceived Value Score:</b> {p.perceived_value_score}</p>
                              <p>
                                <b>Shopee Link:</b>{' '}
                                {parsed.shopee_link
                                  ? <a href={parsed.shopee_link} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">View</a>
                                  : 'Not found'}
                              </p>
                              <p>
                                <b>TikTok Link:</b>{' '}
                                {parsed.tiktok_link
                                  ? <a href={parsed.tiktok_link} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">View</a>
                                  : 'Not found'}
                              </p>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
