'use client';

import { CheckCircle, XCircle, ExternalLink, Pencil, Trash2 } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import type { ResearchItem, ResearchStatus } from './ProductResearchClient';
import type { ResearchStatusRecord } from './StatusManager';

interface Props {
  items: ResearchItem[];
  statuses: ResearchStatusRecord[];
  onEdit: (item: ResearchItem) => void;
  onDelete: (id: number) => void;
  onStatusChange: (id: number, status: ResearchStatus) => void;
}

export default function ResearchTable({ items, statuses, onEdit, onDelete, onStatusChange }: Props) {
  if (items.length === 0) {
    return (
      <div className="card text-center py-12">
        <p className="text-gray-400 text-sm">No products in research yet.</p>
      </div>
    );
  }

  // One actions renderer shared by the desktop table and the phone cards.
  const rowActions = (item: ResearchItem, big: boolean) => (
    <div className="flex items-center gap-1">
      <button onClick={() => onEdit(item)}
        className={`${big ? 'p-3' : 'p-1.5'} rounded hover:bg-blue-50 text-gray-400 hover:text-blue-600`}>
        <Pencil size={14} />
      </button>
      <button onClick={() => { if (confirm('Delete this product?')) onDelete(item.id); }}
        className={`${big ? 'p-3' : 'p-1.5'} rounded hover:bg-red-50 text-gray-400 hover:text-red-600`}>
        <Trash2 size={14} />
      </button>
    </div>
  );

  return (
    <>
    <div className="card overflow-x-auto hidden md:block">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100">
            {['Product Name','Image','Google Link','COGS','SRP','FB Page','Admin','Status','Actions'].map(h => (
              <th key={h} className="table-header">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => (
            <tr key={item.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
              <td className="table-cell font-medium">{item.product_name}</td>
              <td className="table-cell text-center">
                {item.image_ready
                  ? <CheckCircle size={15} className="text-green-600 mx-auto" />
                  : <XCircle size={15} className="text-gray-300 mx-auto" />}
              </td>
              <td className="table-cell">
                {item.google_link ? (
                  <a href={item.google_link} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 text-xs">
                    <ExternalLink size={12} /> Link
                  </a>
                ) : '—'}
              </td>
              <td className="table-cell">{item.cogs ? formatCurrency(item.cogs) : '—'}</td>
              <td className="table-cell">{item.srp ? formatCurrency(item.srp) : '—'}</td>
              <td className="table-cell text-gray-600">{item.fb_page_name ?? '—'}</td>
              <td className="table-cell text-gray-600">{item.fb_page_admin ?? '—'}</td>
              <td className="table-cell">
                <select
                  className="form-input py-1 text-xs w-36"
                  value={item.status}
                  onChange={e => onStatusChange(item.id, e.target.value)}
                >
                  {statuses.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                </select>
              </td>
              <td className="table-cell">{rowActions(item, false)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>

    {/* Phone: the 9-column table can't fit, so each product becomes a card. */}
    <div className="md:hidden space-y-2.5">
      {items.map(item => (
        <div key={item.id} className="rounded-xl border border-gray-200 bg-white p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-1.5 min-w-0">
              {item.image_ready
                ? <CheckCircle size={15} className="text-green-600 shrink-0 mt-0.5" />
                : <XCircle size={15} className="text-gray-300 shrink-0 mt-0.5" />}
              <p className="text-sm font-bold text-gray-900 break-words">{item.product_name}</p>
            </div>
            <div className="shrink-0 -mt-1 -mr-1">{rowActions(item, true)}</div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-600">
            {item.cogs ? <span>COGS: <span className="font-medium">{formatCurrency(item.cogs)}</span></span> : null}
            {item.srp ? <span>SRP: <span className="font-medium text-green-700">{formatCurrency(item.srp)}</span></span> : null}
            {item.google_link && (
              <a href={item.google_link} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 py-1">
                <ExternalLink size={12} /> Link
              </a>
            )}
            {item.fb_page_name && <span>FB: {item.fb_page_name}</span>}
            {item.fb_page_admin && <span>Admin: {item.fb_page_admin}</span>}
          </div>
          <select
            className="form-input py-2.5 text-sm w-full mt-2"
            value={item.status}
            onChange={e => onStatusChange(item.id, e.target.value)}
          >
            {statuses.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
          </select>
        </div>
      ))}
    </div>
    </>
  );
}
