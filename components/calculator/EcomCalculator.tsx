'use client';

import { useState, useMemo } from 'react';
import { Calculator, TrendingUp, Package, Truck, Megaphone, RotateCcw } from 'lucide-react';

function fmt(n: number) {
  return n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function ProfitBadge({ profit, breakEven }: { profit: number; breakEven: number }) {
  if (profit < 0)                    return <span className="badge-red">❌ Loss</span>;
  if (profit < breakEven * 0.1)      return <span className="badge-amber">⚠️ Manipis</span>;
  if (profit < breakEven * 0.3)      return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">✅ Okay</span>;
  return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">🔥 Scale</span>;
}

export default function EcomCalculator() {
  const [cogs,     setCogs]     = useState('220');
  const [shipping, setShipping] = useState('80');
  const [ads,      setAds]      = useState('100');
  const [rts,      setRts]      = useState('20');
  const [platform, setPlatform] = useState('0');
  const [customSrp, setCustomSrp] = useState('');

  const calc = useMemo(() => {
    const c   = parseFloat(cogs)     || 0;
    const sh  = parseFloat(shipping) || 0;
    const ad  = parseFloat(ads)      || 0;
    const r   = parseFloat(rts)      / 100 || 0;
    const pf  = parseFloat(platform) / 100 || 0;

    const totalCost   = c + sh + ad;
    const successRate = 1 - r;
    const breakEven   = successRate > 0 ? totalCost / successRate : 0;

    const profitAt = (srp: number) => {
      const revenue      = srp * successRate;
      const platformFee  = srp * pf;
      return revenue - totalCost - platformFee;
    };

    // Round to nearest 100 ending in 9 (e.g. 299, 399, 499, 699)
    const to9 = (n: number) => Math.ceil(n / 100) * 100 - 1;
    const testPrice  = to9(breakEven * 1.15);
    const sweetSpot  = to9(breakEven * 1.40);
    const scalePrice = to9(breakEven * 1.65);

    return { totalCost, breakEven, profitAt, testPrice, sweetSpot, scalePrice };
  }, [cogs, shipping, ads, rts, platform]);

  const srpPoints = useMemo(() => {
    const base = Math.ceil(calc.breakEven / 100) * 100 - 1;
    const points = [];
    for (let i = -200; i <= 700; i += 100) {
      const srp = base + i;
      if (srp > 0 && srp % 100 === 99) points.push(srp);
      else if (srp > 0) points.push(Math.ceil(srp / 100) * 100 - 1);
    }
    return [...new Set(points)].sort((a, b) => a - b);
    return points;
  }, [calc.breakEven]);

  const customProfit = customSrp ? calc.profitAt(parseFloat(customSrp)) : null;

  const InputCard = ({ label, value, onChange, icon: Icon, color, suffix }: {
    label: string; value: string; onChange: (v: string) => void;
    icon: any; color: string; suffix?: string;
  }) => (
    <div className="card">
      <div className="flex items-center gap-2 mb-2">
        <Icon size={16} className={color} />
        <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">{label}</label>
      </div>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-medium">₱</span>
        <input
          type="number"
          value={value}
          onChange={e => onChange(e.target.value)}
          className="form-input pl-7 text-lg font-bold"
          placeholder="0"
        />
        {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">{suffix}</span>}
      </div>
    </div>
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-orange-100 rounded-xl">
          <Calculator className="text-orange-500" size={22} />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Ecom Profit Calculator</h1>
          <p className="text-sm text-gray-500 mt-0.5">Break-even, profit per order, and pricing recommendations</p>
        </div>
      </div>

      {/* Inputs */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
        <InputCard label="COGS"     value={cogs}     onChange={setCogs}     icon={Package}    color="text-blue-500"   />
        <InputCard label="Shipping" value={shipping} onChange={setShipping} icon={Truck}      color="text-purple-500" />
        <InputCard label="Ads Cost" value={ads}      onChange={setAds}      icon={Megaphone}  color="text-orange-500" />
        <div className="card">
          <div className="flex items-center gap-2 mb-2">
            <RotateCcw size={16} className="text-red-500" />
            <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">RTS Rate</label>
          </div>
          <div className="relative">
            <input type="number" value={rts} onChange={e => setRts(e.target.value)}
              className="form-input text-lg font-bold pr-7" placeholder="0" />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">%</span>
          </div>
        </div>
        <div className="card">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp size={16} className="text-green-500" />
            <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Platform Fee</label>
          </div>
          <div className="relative">
            <input type="number" value={platform} onChange={e => setPlatform(e.target.value)}
              className="form-input text-lg font-bold pr-7" placeholder="0" />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">%</span>
          </div>
        </div>
      </div>

      {/* Summary Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card bg-blue-50 border border-blue-200">
          <p className="text-xs text-blue-600 font-semibold mb-1">Total Cost / Order</p>
          <p className="text-2xl font-black text-blue-700">₱{fmt(calc.totalCost)}</p>
          <p className="text-xs text-blue-500 mt-1">COGS + Shipping + Ads</p>
        </div>
        <div className="card bg-red-50 border border-red-200">
          <p className="text-xs text-red-600 font-semibold mb-1">Break-even Price</p>
          <p className="text-2xl font-black text-red-700">₱{fmt(calc.breakEven)}</p>
          <p className="text-xs text-red-500 mt-1">Min SRP to not lose money</p>
        </div>
        <div className="card bg-green-50 border border-green-200">
          <p className="text-xs text-green-600 font-semibold mb-1">✅ Sweet Spot (recommended)</p>
          <p className="text-2xl font-black text-green-700">₱{fmt(calc.sweetSpot)}</p>
          <p className="text-xs text-green-500 mt-1">
            Profit: ₱{fmt(calc.profitAt(calc.sweetSpot))} / order
          </p>
        </div>
        <div className="card bg-orange-50 border border-orange-200">
          <p className="text-xs text-orange-600 font-semibold mb-1">🔥 Scale Price</p>
          <p className="text-2xl font-black text-orange-700">₱{fmt(calc.scalePrice)}</p>
          <p className="text-xs text-orange-500 mt-1">
            Profit: ₱{fmt(calc.profitAt(calc.scalePrice))} / order
          </p>
        </div>
      </div>

      {/* Recommended Pricing */}
      <div className="card">
        <h2 className="text-base font-semibold text-gray-900 mb-4">🎯 Recommended Pricing</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { label: '🥉 Test Price', srp: calc.testPrice, desc: 'Para sa volume / testing' },
            { label: '🥈 Sweet Spot', srp: calc.sweetSpot, desc: 'Best balance ng conversion at profit' },
            { label: '🥇 Scale Price', srp: calc.scalePrice, desc: 'Para sa premium / influencer' },
          ].map(({ label, srp, desc }) => {
            const profit = calc.profitAt(srp);
            const margin = srp > 0 ? (profit / srp * 100) : 0;
            return (
              <div key={label} className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                <p className="text-sm font-semibold text-gray-600 mb-2">{label}</p>
                <p className="text-3xl font-black text-gray-900 mb-1">₱{fmt(srp)}</p>
                <p className="text-xs text-gray-500 mb-3">{desc}</p>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Profit / order</span>
                    <span className={`font-bold ${profit > 0 ? 'text-green-700' : 'text-red-600'}`}>₱{fmt(profit)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Margin</span>
                    <span className="font-bold text-gray-700">{margin.toFixed(1)}%</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Bundle Pricing */}
      <div className="card">
        <h2 className="text-base font-semibold text-gray-900 mb-4">📦 Bundle Pricing (based on Sweet Spot)</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { label: 'Buy 1',  multiplier: 1,    discount: 0    },
            { label: 'Buy 2',  multiplier: 2,    discount: 0.05 },
            { label: 'Buy 3',  multiplier: 3,    discount: 0.10 },
          ].map(({ label, multiplier, discount }) => {
            const base        = calc.sweetSpot;
            const bundlePrice = Math.ceil(base * multiplier * (1 - discount) / 100) * 100 - 1;
            const bundleCost  = calc.totalCost * multiplier;
            const successRate = 1 - (parseFloat(rts) / 100 || 0);
            const bundleRevenue = bundlePrice * successRate;
            const bundleProfit  = bundleRevenue - bundleCost;
            return (
              <div key={label} className="border-2 border-orange-200 rounded-xl p-4 text-center bg-orange-50/50">
                <p className="text-sm font-bold text-orange-700 mb-1">{label}</p>
                <p className="text-2xl font-black text-gray-900">₱{fmt(bundlePrice)}</p>
                {discount > 0 && (
                  <p className="text-xs text-green-600 font-medium mt-0.5">{(discount * 100).toFixed(0)}% off</p>
                )}
                <p className="text-xs text-gray-500 mt-2">
                  Profit: <span className="text-green-700 font-bold">₱{fmt(bundleProfit)}</span>
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Profit Table */}
      <div className="card">
        <h2 className="text-base font-semibold text-gray-900 mb-4">📊 Profit at Different Prices</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="table-header">SRP</th>
                <th className="table-header">Revenue (after RTS)</th>
                <th className="table-header">Total Cost</th>
                <th className="table-header text-right">Profit / Order</th>
                <th className="table-header text-right">Margin</th>
                <th className="table-header">Status</th>
              </tr>
            </thead>
            <tbody>
              {srpPoints.map((srp, i) => {
                const successRate = 1 - (parseFloat(rts) / 100 || 0);
                const revenue     = srp * successRate;
                const profit      = calc.profitAt(srp);
                const margin      = srp > 0 ? (profit / srp * 100) : 0;
                const isSweet     = srp === calc.sweetSpot || (srp >= calc.sweetSpot - 50 && srp <= calc.sweetSpot + 50);
                return (
                  <tr key={srp} className={`${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'} ${isSweet ? 'ring-2 ring-orange-400 ring-inset' : ''}`}>
                    <td className="table-cell font-bold text-gray-900">₱{fmt(srp)}</td>
                    <td className="table-cell text-gray-600">₱{fmt(revenue)}</td>
                    <td className="table-cell text-gray-600">₱{fmt(calc.totalCost)}</td>
                    <td className={`table-cell text-right font-bold ${profit > 0 ? 'text-green-700' : 'text-red-600'}`}>
                      ₱{fmt(profit)}
                    </td>
                    <td className={`table-cell text-right font-semibold ${margin > 20 ? 'text-green-700' : margin > 0 ? 'text-amber-600' : 'text-red-600'}`}>
                      {margin.toFixed(1)}%
                    </td>
                    <td className="table-cell">
                      <ProfitBadge profit={profit} breakEven={calc.breakEven} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Custom Price Check */}
      <div className="card">
        <h2 className="text-base font-semibold text-gray-900 mb-3">🔍 Check Custom SRP</h2>
        <div className="flex items-center gap-4">
          <div className="relative flex-1 max-w-xs">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-medium">₱</span>
            <input
              type="number"
              placeholder="Enter your SRP..."
              value={customSrp}
              onChange={e => setCustomSrp(e.target.value)}
              className="form-input pl-7 text-lg font-bold"
            />
          </div>
          {customProfit !== null && (
            <div className="flex items-center gap-6">
              <div>
                <p className="text-xs text-gray-500">Profit / order</p>
                <p className={`text-xl font-black ${customProfit > 0 ? 'text-green-700' : 'text-red-600'}`}>
                  ₱{fmt(customProfit)}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Margin</p>
                <p className="text-xl font-black text-gray-800">
                  {(customProfit / parseFloat(customSrp) * 100).toFixed(1)}%
                </p>
              </div>
              <ProfitBadge profit={customProfit} breakEven={calc.breakEven} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
