'use client';

import { useState } from 'react';
import {
  ChevronDown, ChevronUp, Save, TrendingUp, Shield, AlertTriangle,
  Facebook, Music2, Tag, Users, DollarSign, Loader2, AlertCircle,
  ShoppingBag, ExternalLink,
} from 'lucide-react';
import type { ProductRecommendation, ProductDetails, ResearchCriteria } from '@/lib/ai-research';

const DECISION_STYLE: Record<string, { border: string; badge: string; bg: string }> = {
  SCALE:  { border: 'border-green-300',  badge: 'bg-green-100 text-green-800',  bg: 'bg-green-50/40' },
  TEST:   { border: 'border-amber-300',  badge: 'bg-amber-100 text-amber-800',  bg: 'bg-amber-50/40' },
  REJECT: { border: 'border-red-300',    badge: 'bg-red-100 text-red-800',      bg: 'bg-red-50/40' },
};

function ScoreBar({ label, value, icon: Icon }: { label: string; value: number; icon: any }) {
  const color = value >= 70 ? 'bg-green-500' : value >= 50 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div>
      <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
        <span className="flex items-center gap-1"><Icon size={12} />{label}</span>
        <span className="font-semibold text-gray-700">{value}</span>
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
      </div>
    </div>
  );
}

export default function ProductCard({
  product, criteria, onSave, saving, saved,
}: {
  product: ProductRecommendation;
  criteria: ResearchCriteria;
  onSave: (details: ProductDetails | null) => void;
  saving: boolean;
  saved: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [details, setDetails] = useState<ProductDetails | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const style = DECISION_STYLE[product.decision] ?? DECISION_STYLE.TEST;

  const toggleExpand = async () => {
    setExpanded(v => !v);
    if (details || loadingDetails) return;
    setLoadingDetails(true);
    setDetailsError(null);
    try {
      const res = await fetch('/api/ai-research/details', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ product, criteria }),
      });
      let data: any;
      try { data = await res.json(); } catch {
        throw new Error('Server returned an unexpected response.');
      }
      if (!res.ok) throw new Error(data.error || 'Failed to generate details.');
      setDetails(data.details);
    } catch (e: any) {
      setDetailsError(e.message || String(e));
    } finally {
      setLoadingDetails(false);
    }
  };

  return (
    <div className={`card border-2 ${style.border} ${style.bg} flex flex-col gap-3`}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-bold text-gray-900 leading-snug">{product.product_name}</h3>
        <span className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-bold ${style.badge}`}>
          {product.decision}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="bg-white rounded-lg p-2 border border-gray-100">
          <p className="text-gray-400">COGS</p>
          <p className="font-bold text-gray-800">₱{product.estimated_cogs}</p>
        </div>
        <div className="bg-white rounded-lg p-2 border border-gray-100">
          <p className="text-gray-400">SRP</p>
          <p className="font-bold text-gray-800">₱{product.suggested_srp}</p>
        </div>
        <div className="bg-white rounded-lg p-2 border border-gray-100">
          <p className="text-gray-400">Margin</p>
          <p className="font-bold text-gray-800">{product.margin_percent}%</p>
        </div>
      </div>

      <div className="text-xs text-gray-600 space-y-1">
        <p><span className="font-semibold text-gray-700">Problem solved:</span> {product.problem_solved}</p>
        <p><span className="font-semibold text-gray-700">Target market:</span> {product.target_market}</p>
        <p><span className="font-semibold text-gray-700">Why it sells now:</span> {product.why_it_sells_now}</p>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-2 pt-1">
        <ScoreBar label="Perceived Value" value={product.perceived_value_score} icon={DollarSign} />
        <ScoreBar label="Demand"          value={product.demand_score}          icon={TrendingUp} />
        <ScoreBar label="Competition"     value={product.competition_score}     icon={Users} />
        <ScoreBar label="FB Ads"          value={product.facebook_ads_potential} icon={Facebook} />
        <ScoreBar label="TikTok"          value={product.tiktok_potential}       icon={Music2} />
        <ScoreBar label="Overall Score"   value={product.overall_score}          icon={Tag} />
      </div>

      <div className="flex items-center gap-3 text-xs pt-1">
        <span className="flex items-center gap-1 text-gray-500">
          <Shield size={12} /> Compliance: <b className="text-gray-700">{product.compliance_risk}</b>
        </span>
        <span className="flex items-center gap-1 text-gray-500">
          <AlertTriangle size={12} /> RTS Risk: <b className="text-gray-700">{product.rts_risk}</b>
        </span>
      </div>

      <button
        onClick={toggleExpand}
        className="flex items-center justify-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-800 py-1"
      >
        {expanded ? <>Hide Details <ChevronUp size={14} /></> : <>Expand Details <ChevronDown size={14} /></>}
      </button>

      {expanded && loadingDetails && (
        <div className="flex items-center justify-center gap-2 text-xs text-gray-500 py-4 border-t border-gray-200">
          <Loader2 size={14} className="animate-spin" /> Generating hooks &amp; ad concepts...
        </div>
      )}

      {expanded && detailsError && (
        <div className="flex items-start gap-2 text-xs text-red-600 py-2 border-t border-gray-200">
          <AlertCircle size={14} className="shrink-0 mt-0.5" /> {detailsError}
        </div>
      )}

      {expanded && details && (
        <div className="space-y-3 text-xs border-t border-gray-200 pt-3">
          {details.product_image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={details.product_image_url}
              alt={product.product_name}
              className="w-full h-40 object-cover rounded-lg border border-gray-100"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          ) : (
            <div className="w-full h-24 flex items-center justify-center rounded-lg border border-dashed border-gray-200 text-gray-400">
              No product image found
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div className="bg-white rounded-lg p-2 border border-gray-100">
              <p className="font-semibold text-gray-700 mb-1 flex items-center gap-1"><ShoppingBag size={12} /> Shopee Link</p>
              {details.shopee_link ? (
                <a href={details.shopee_link} target="_blank" rel="noopener noreferrer"
                   className="text-blue-600 hover:underline flex items-center gap-1 break-all">
                  View listing <ExternalLink size={10} className="shrink-0" />
                </a>
              ) : <p className="text-gray-400">No confident match found</p>}
            </div>
            <div className="bg-white rounded-lg p-2 border border-gray-100">
              <p className="font-semibold text-gray-700 mb-1 flex items-center gap-1"><Music2 size={12} /> TikTok Link</p>
              {details.tiktok_link ? (
                <a href={details.tiktok_link} target="_blank" rel="noopener noreferrer"
                   className="text-blue-600 hover:underline flex items-center gap-1 break-all">
                  View video <ExternalLink size={10} className="shrink-0" />
                </a>
              ) : <p className="text-gray-400">No confident match found</p>}
            </div>
          </div>

          <div>
            <p className="font-semibold text-gray-700 mb-1 flex items-center gap-1"><Facebook size={12} /> Facebook Hooks</p>
            <ul className="list-disc list-inside text-gray-600 space-y-0.5">
              {details.facebook_hooks?.map((h, i) => <li key={i}>{h}</li>)}
            </ul>
          </div>
        </div>
      )}

      <button
        onClick={() => onSave(details)}
        disabled={saving || saved}
        className="btn-primary justify-center mt-1 disabled:opacity-60 disabled:cursor-not-allowed"
      >
        <Save size={14} />
        {saved ? 'Saved to Vault' : saving ? 'Saving...' : 'Save to Product Vault'}
      </button>
    </div>
  );
}
