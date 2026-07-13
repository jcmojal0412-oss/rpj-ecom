'use client';

import { useState } from 'react';
import type { ResearchItem, ResearchStatus } from './ProductResearchClient';
import type { ResearchStatusRecord } from './StatusManager';

const OBJECTIVES = ['Webcake', 'Messaging', 'Both', 'Other'];

interface Props {
  initial?: ResearchItem;
  defaultStatus?: ResearchStatus;
  statuses: ResearchStatusRecord[];
  onSuccess: () => void;
  onCancel: () => void;
}

export default function ResearchForm({ initial, defaultStatus, statuses, onSuccess, onCancel }: Props) {
  const [name,             setName]            = useState(initial?.product_name ?? '');
  const [imageReady,       setImageReady]       = useState(!!initial?.image_ready);
  const [googleLink,       setGoogleLink]       = useState(initial?.google_link ?? '');
  const [driveLink,        setDriveLink]        = useState(initial?.drive_link ?? '');
  const [cogs,             setCogs]             = useState(initial?.cogs ? String(initial.cogs) : '');
  const [srp,              setSrp]              = useState(initial?.srp ? String(initial.srp) : '');
  const [fbPage,           setFbPage]           = useState(initial?.fb_page_name ?? '');
  const [fbAdmin,          setFbAdmin]          = useState(initial?.fb_page_admin ?? '');
  const [supplierDetails,  setSupplierDetails]  = useState(initial?.supplier_details ?? '');
  const [objectives,        setObjectives]        = useState(initial?.objectives ?? '');
  const [promo,             setPromo]             = useState(initial?.promo ?? '');
  const [webcakeWarehouse,  setWebcakeWarehouse]  = useState(!!initial?.webcake_warehouse);
  const [addToWarehouse,    setAddToWarehouse]    = useState(!!initial?.add_to_warehouse);
  const [gsheetMonitoring,  setGsheetMonitoring]  = useState(!!initial?.gsheet_monitoring);
  const [doneBotcake,      setDoneBotcake]      = useState(!!initial?.done_botcake);
  const [doneWebcake,      setDoneWebcake]      = useState(!!initial?.done_webcake);
  const [status,            setStatus]            = useState<ResearchStatus>(initial?.status ?? defaultStatus ?? 'For Research');
  const [shippingFee,      setShippingFee]      = useState(initial?.shipping_fee ? String(initial.shipping_fee) : '');
  const [adsCost,          setAdsCost]          = useState(initial?.ads_cost ? String(initial.ads_cost) : '');
  const [rtsPercent,       setRtsPercent]       = useState(initial?.rts_percent ? String(initial.rts_percent) : '');
  const [bundlePrice,      setBundlePrice]      = useState(initial?.bundle_price ? String(initial.bundle_price) : '');
  const [submitting,       setSubmitting]       = useState(false);

  const cogsNum     = parseFloat(cogs) || 0;
  const srpNum      = parseFloat(srp)  || 0;
  const shippingNum = parseFloat(shippingFee) || 0;
  const adsNum      = parseFloat(adsCost) || 0;
  const rtsNum      = (parseFloat(rtsPercent) || 0) / 100;

  const totalCost   = cogsNum + shippingNum + adsNum;
  const successRate = 1 - rtsNum;
  const netRevenue   = srpNum * successRate;
  const profit       = netRevenue - totalCost;
  const margin        = srpNum > 0 ? (profit / srpNum * 100) : 0;
  const breakEven      = successRate > 0 ? totalCost / successRate : 0;
  const hasValues       = cogs !== '' && srp !== '';

  // Buy 1 Take 1 / Bundle of 2 — COGS doubles (2 units), but shipping and
  // ads stay the same since it's still one order/one shipment.
  const bundlePriceNum = parseFloat(bundlePrice) || 0;
  const bundleTotalCost = (cogsNum * 2) + shippingNum + adsNum;
  const bundleNetRevenue = bundlePriceNum * successRate;
  const bundleProfit = bundleNetRevenue - bundleTotalCost;
  const bundleMargin = bundlePriceNum > 0 ? (bundleProfit / bundlePriceNum * 100) : 0;
  const bundleBreakEven = successRate > 0 ? bundleTotalCost / successRate : 0;
  const hasBundleValues = cogs !== '' && bundlePrice !== '';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    const body = {
      product_name:     name,
      image_ready:      imageReady,
      google_link:      googleLink || null,
      drive_link:       driveLink || null,
      cogs:             cogs ? parseFloat(cogs) : null,
      srp:              srp ? parseFloat(srp) : null,
      fb_page_name:     fbPage || null,
      fb_page_admin:    fbAdmin || null,
      supplier_details:  supplierDetails || null,
      objectives:        objectives || null,
      promo:             promo || null,
      shipping_fee:      shippingFee ? parseFloat(shippingFee) : 0,
      ads_cost:          adsCost ? parseFloat(adsCost) : 0,
      rts_percent:       rtsPercent ? parseFloat(rtsPercent) : 0,
      bundle_price:      bundlePrice ? parseFloat(bundlePrice) : null,
      webcake_warehouse: webcakeWarehouse,
      add_to_warehouse:  addToWarehouse,
      gsheet_monitoring: gsheetMonitoring,
      done_botcake:      doneBotcake,
      done_webcake:      doneWebcake,
      status,
    };
    try {
      if (initial) {
        await fetch(`/api/product-research/${initial.id}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
      } else {
        await fetch('/api/product-research', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
      }
      onSuccess();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">

        {/* Product Name */}
        <div className="col-span-2">
          <label className="form-label">Product Name *</label>
          <input className="form-input" value={name} onChange={e => setName(e.target.value)}
            required placeholder="e.g. LED Strip Lights RGB" />
        </div>

        {/* Cost & Pricing Breakdown */}
        <div className="col-span-2">
          <p className="form-label mb-2">Cost & Pricing</p>
          <div className="bg-gray-50 rounded-xl p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-500">COGS (₱)</label>
                <input type="number" step="0.01" className="form-input" value={cogs}
                  onChange={e => setCogs(e.target.value)} placeholder="0.00" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500">SRP / Selling Price (₱)</label>
                <input type="number" step="0.01" className="form-input" value={srp}
                  onChange={e => setSrp(e.target.value)} placeholder="0.00" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500">Shipping Fee (₱)</label>
                <input type="number" step="0.01" className="form-input" value={shippingFee}
                  onChange={e => setShippingFee(e.target.value)} placeholder="0.00" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500">Ads Cost (₱)</label>
                <input type="number" step="0.01" className="form-input" value={adsCost}
                  onChange={e => setAdsCost(e.target.value)} placeholder="0.00" />
              </div>
              <div className="col-span-2">
                <label className="text-xs font-medium text-gray-500">RTS Rate (%)</label>
                <input type="number" step="0.1" className="form-input" value={rtsPercent}
                  onChange={e => setRtsPercent(e.target.value)} placeholder="0" />
              </div>
            </div>

            {/* Auto-computed Profit */}
            <div className={`rounded-xl px-4 py-3 transition-colors ${
              !hasValues ? 'bg-white' : profit > 0 ? 'bg-green-50 border border-green-200' : profit < 0 ? 'bg-red-50 border border-red-200' : 'bg-white'
            }`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-700">💰 Profit per Unit</span>
                  {hasValues && (
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      margin >= 30 ? 'bg-green-100 text-green-700' : margin >= 15 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
                    }`}>
                      {margin.toFixed(1)}% margin
                    </span>
                  )}
                </div>
                <span className={`text-xl font-black ${
                  !hasValues ? 'text-gray-300' : profit > 0 ? 'text-green-700' : profit < 0 ? 'text-red-600' : 'text-gray-400'
                }`}>
                  {hasValues ? `₱${profit.toLocaleString('en-PH', { minimumFractionDigits: 2 })}` : '—'}
                </span>
              </div>
              {hasValues && (
                <p className="text-xs text-gray-400 mt-1.5">
                  Break-even: ₱{breakEven.toLocaleString('en-PH', { minimumFractionDigits: 2 })} · Total Cost: ₱{totalCost.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                </p>
              )}
            </div>

            {/* Buy 1 Take 1 / Bundle of 2 */}
            <div className="pt-1">
              <label className="text-xs font-medium text-gray-500">Bundle Price — Buy 1 Take 1 / Bundle of 2 (₱)</label>
              <input type="number" step="0.01" className="form-input" value={bundlePrice}
                onChange={e => setBundlePrice(e.target.value)} placeholder="e.g. 999 for 2 units (optional)" />
              <p className="text-[11px] text-gray-400 mt-1">Assumes COGS ×2 but same shipping &amp; ads cost (one order, one shipment).</p>
            </div>

            {bundlePrice !== '' && (
              <div className={`rounded-xl px-4 py-3 transition-colors ${
                !hasBundleValues ? 'bg-white' : bundleProfit > 0 ? 'bg-green-50 border border-green-200' : bundleProfit < 0 ? 'bg-red-50 border border-red-200' : 'bg-white'
              }`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-gray-700">🎁 Bundle Profit (2 units)</span>
                    {hasBundleValues && (
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        bundleMargin >= 30 ? 'bg-green-100 text-green-700' : bundleMargin >= 15 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
                      }`}>
                        {bundleMargin.toFixed(1)}% margin
                      </span>
                    )}
                  </div>
                  <span className={`text-xl font-black ${
                    !hasBundleValues ? 'text-gray-300' : bundleProfit > 0 ? 'text-green-700' : bundleProfit < 0 ? 'text-red-600' : 'text-gray-400'
                  }`}>
                    {hasBundleValues ? `₱${bundleProfit.toLocaleString('en-PH', { minimumFractionDigits: 2 })}` : '—'}
                  </span>
                </div>
                {hasBundleValues && (
                  <p className="text-xs text-gray-400 mt-1.5">
                    Break-even: ₱{bundleBreakEven.toLocaleString('en-PH', { minimumFractionDigits: 2 })} · Total Cost: ₱{bundleTotalCost.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="col-span-2">
          <label className="form-label">Promo</label>
          <input
            className="form-input"
            placeholder="e.g. BUY 1 - 399, B1T1 - 499"
            value={promo}
            onChange={e => setPromo(e.target.value)}
          />
        </div>

        {/* Google Drive Link */}
        <div className="col-span-2">
          <label className="form-label">Google Drive Link</label>
          <input type="url" className="form-input" value={driveLink}
            onChange={e => setDriveLink(e.target.value)} placeholder="https://drive.google.com/..." />
        </div>

        {/* Google Research Link (keep for backward compat) */}
        <div className="col-span-2">
          <label className="form-label">Google Research Link</label>
          <input type="url" className="form-input" value={googleLink}
            onChange={e => setGoogleLink(e.target.value)} placeholder="https://google.com/search?q=..." />
        </div>

        {/* Supplier Details */}
        <div className="col-span-2">
          <label className="form-label">Supplier Link / Details</label>
          <textarea className="form-input" rows={2} value={supplierDetails}
            onChange={e => setSupplierDetails(e.target.value)}
            placeholder="Supplier name, contact, link, or notes..." />
        </div>

        {/* Objectives */}
        <div>
          <label className="form-label">Objectives</label>
          <select className="form-input" value={objectives} onChange={e => setObjectives(e.target.value)}>
            <option value="">— Select —</option>
            {OBJECTIVES.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>


        {/* Status */}
        <div>
          <label className="form-label">Status</label>
          <select className="form-input" value={status} onChange={e => setStatus(e.target.value)}>
            {statuses.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
          </select>
        </div>

        {/* FB Page */}
        <div>
          <label className="form-label">FB Page Name</label>
          <input className="form-input" value={fbPage} onChange={e => setFbPage(e.target.value)}
            placeholder="Page name" />
        </div>
        <div>
          <label className="form-label">FB Page Admin</label>
          <input className="form-input" value={fbAdmin} onChange={e => setFbAdmin(e.target.value)}
            placeholder="Admin name" />
        </div>

        {/* Checklist section */}
        <div className="col-span-2">
          <p className="form-label mb-2">Checklist</p>
          <div className="bg-gray-50 rounded-xl p-4 space-y-3">
            {[
              { id: 'imageReady',       label: 'Image Ready',               checked: imageReady,       onChange: setImageReady },
              { id: 'webcakeWarehouse', label: 'Change Webcake Warehouse',   checked: webcakeWarehouse, onChange: setWebcakeWarehouse },
              { id: 'addToWarehouse',   label: 'Add to Warehouse',           checked: addToWarehouse,   onChange: setAddToWarehouse },
              { id: 'gsheetMonitor',    label: 'Add to GSheet Monitoring',   checked: gsheetMonitoring, onChange: setGsheetMonitoring },
              { id: 'doneBotcake',      label: 'Done Botcake',               checked: doneBotcake,      onChange: setDoneBotcake },
              { id: 'doneWebcake',      label: 'Done Webcake',               checked: doneWebcake,      onChange: setDoneWebcake },
            ].map(item => (
              <div key={item.id} className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id={item.id}
                  checked={item.checked}
                  onChange={e => item.onChange(e.target.checked)}
                  className="w-4 h-4 text-orange-500 rounded border-gray-300 focus:ring-orange-400"
                />
                <label htmlFor={item.id} className={`text-sm font-medium transition-colors ${item.checked ? 'text-green-600 line-through' : 'text-gray-700'}`}>
                  {item.checked ? '✓ ' : ''}{item.label}
                </label>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <button type="button" onClick={onCancel} className="btn-secondary">Cancel</button>
        <button type="submit" disabled={submitting} className="btn-primary disabled:opacity-50">
          {submitting ? 'Saving...' : initial ? 'Update Product' : 'Add Product'}
        </button>
      </div>
    </form>
  );
}
