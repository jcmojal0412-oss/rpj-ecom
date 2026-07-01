'use client';

import { useState, useEffect, useRef } from 'react';
import { Sparkles, AlertCircle } from 'lucide-react';
import Spinner from '@/components/ui/Spinner';
import { Toast, useToast } from '@/components/ui/Toast';
import ProductHunterForm, { HunterCriteria } from './ProductHunterForm';
import ProductCard from './ProductCard';
import type { ProductRecommendation, ProductDetails, ResearchCriteria } from '@/lib/ai-research';

function toResearchCriteria(c: HunterCriteria): ResearchCriteria {
  return {
    season: c.season,
    cogs: Number(c.cogs) || 0,
    srp: Number(c.srp) || 0,
    category: c.category,
    market: c.market,
    margin: Number(c.margin) || 0,
    notes: c.notes,
  };
}

export default function ProductHunterClient() {
  const [results, setResults] = useState<ProductRecommendation[]>([]);
  const [criteria, setCriteria] = useState<HunterCriteria | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingIndex, setSavingIndex] = useState<number | null>(null);
  const [savedIndexes, setSavedIndexes] = useState<Set<number>>(new Set());
  const [cardImages, setCardImages] = useState<(string | null)[]>([]);
  const fetchingRef = useRef(false);
  const { toast, showToast, clearToast } = useToast();

  useEffect(() => {
    if (!results.length || fetchingRef.current) return;
    fetchingRef.current = true;
    setCardImages(new Array(results.length).fill(null));
    results.forEach((product, i) => {
      fetch('/api/ai-research/image', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ product_name: product.product_name }),
      })
        .then(r => r.json())
        .then(data => {
          if (data.url) {
            setCardImages(prev => {
              const next = [...prev];
              next[i] = `/api/proxy-image?url=${encodeURIComponent(data.url)}`;
              return next;
            });
          }
        })
        .catch(() => {});
    });
  }, [results]);

  const handleSearch = async (c: HunterCriteria) => {
    setLoading(true);
    setError(null);
    setResults([]);
    setSavedIndexes(new Set());
    setCardImages([]);
    fetchingRef.current = false;
    setCriteria(c);
    try {
      const res = await fetch('/api/ai-research', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(c),
      });
      let data: any;
      try {
        data = await res.json();
      } catch {
        throw new Error(
          res.status === 504 || res.status === 502
            ? 'The AI took too long to respond (timeout). Try again — it usually works on a retry.'
            : `Server returned an unexpected response (status ${res.status}).`
        );
      }
      if (!res.ok) throw new Error(data.error || 'Failed to generate recommendations.');
      setResults(data.recommendations || []);
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (product: ProductRecommendation, index: number, details: ProductDetails | null) => {
    setSavingIndex(index);
    try {
      let productToSave: any = product;
      if (details) {
        const cogs = details.shopee_price ?? product.estimated_cogs;
        const margin = product.suggested_srp > 0
          ? Math.round(((product.suggested_srp - cogs) / product.suggested_srp) * 100)
          : product.margin_percent;
        productToSave = { ...product, ...details, estimated_cogs: cogs, margin_percent: margin };
      }
      const res = await fetch('/api/ai-research/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          product: productToSave,
          category: criteria?.category,
          season: criteria?.season,
        }),
      });
      if (!res.ok) throw new Error('Failed to save.');
      setSavedIndexes(prev => new Set(prev).add(index));
      showToast(`${product.product_name} saved to Product Vault`, 'success');
    } catch (e: any) {
      showToast(e.message || 'Failed to save product.', 'error');
    } finally {
      setSavingIndex(null);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-orange-100 rounded-xl">
          <Sparkles className="text-orange-500" size={22} />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">AI Product Researcher</h1>
          <p className="text-sm text-gray-500 mt-0.5">Product Hunter — discover potential winning products using AI</p>
        </div>
      </div>

      <ProductHunterForm onSearch={handleSearch} loading={loading} />

      {error && (
        <div className="card border-red-200 bg-red-50 flex items-start gap-3">
          <AlertCircle className="text-red-500 shrink-0 mt-0.5" size={18} />
          <div>
            <p className="text-sm font-semibold text-red-700">Couldn't generate recommendations</p>
            <p className="text-xs text-red-600 mt-0.5">{error}</p>
          </div>
        </div>
      )}

      {loading && (
        <div className="card flex flex-col items-center justify-center py-16 gap-3">
          <Spinner size={32} />
          <p className="text-sm text-gray-500">Analyzing market criteria and generating product recommendations...</p>
        </div>
      )}

      {!loading && results.length > 0 && (
        <div>
          <h2 className="text-base font-semibold text-gray-900 mb-3">
            {results.length} Recommendations
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {results.map((product, i) => (
              <ProductCard
                key={i}
                product={product}
                criteria={toResearchCriteria(criteria!)}
                onSave={(details) => handleSave(product, i, details)}
                saving={savingIndex === i}
                saved={savedIndexes.has(i)}
                imageUrl={cardImages[i] ?? null}
              />
            ))}
          </div>
        </div>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={clearToast} />}
    </div>
  );
}
