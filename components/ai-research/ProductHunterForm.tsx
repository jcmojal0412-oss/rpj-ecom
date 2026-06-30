'use client';

import { useState } from 'react';
import { Sparkles, Loader2 } from 'lucide-react';

export interface HunterCriteria {
  season: string;
  cogs: string;
  srp: string;
  category: string;
  market: string;
  margin: string;
  notes: string;
}

export default function ProductHunterForm({
  onSearch, loading,
}: {
  onSearch: (criteria: HunterCriteria) => void;
  loading: boolean;
}) {
  const [criteria, setCriteria] = useState<HunterCriteria>({
    season: 'Rainy Season',
    cogs: '40',
    srp: '399',
    category: 'Home',
    market: 'Philippines COD',
    margin: '50',
    notes: '',
  });

  const set = (field: keyof HunterCriteria) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setCriteria(c => ({ ...c, [field]: e.target.value }));

  return (
    <div className="card space-y-4">
      <h2 className="text-base font-semibold text-gray-900">Research Criteria</h2>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div>
          <label className="form-label">Season</label>
          <input className="form-input" value={criteria.season} onChange={set('season')} placeholder="e.g. Rainy Season" />
        </div>
        <div>
          <label className="form-label">Target COGS (₱)</label>
          <input type="number" className="form-input" value={criteria.cogs} onChange={set('cogs')} />
        </div>
        <div>
          <label className="form-label">Target SRP (₱)</label>
          <input type="number" className="form-input" value={criteria.srp} onChange={set('srp')} />
        </div>
        <div>
          <label className="form-label">Category</label>
          <input className="form-input" value={criteria.category} onChange={set('category')} placeholder="e.g. Home" />
        </div>
        <div>
          <label className="form-label">Market</label>
          <input className="form-input" value={criteria.market} onChange={set('market')} />
        </div>
        <div>
          <label className="form-label">Desired Margin %</label>
          <input type="number" className="form-input" value={criteria.margin} onChange={set('margin')} />
        </div>
        <div className="col-span-2 md:col-span-3">
          <label className="form-label">Notes</label>
          <textarea className="form-input" rows={2} value={criteria.notes} onChange={set('notes')} placeholder="Optional notes / constraints..." />
        </div>
      </div>
      <button
        onClick={() => onSearch(criteria)}
        disabled={loading}
        className="btn-primary justify-center w-full md:w-auto disabled:opacity-60"
      >
        {loading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
        {loading ? 'Analyzing...' : 'Find Winning Products'}
      </button>
    </div>
  );
}
