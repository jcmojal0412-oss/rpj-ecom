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

  return (
    <div className="card overflow-x-auto">
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
              <td className="table-cell">
                <div className="flex items-center gap-1">
                  <button onClick={() => onEdit(item)}
                    className="p-1.5 rounded hover:bg-blue-50 text-gray-400 hover:text-blue-600">
                    <Pencil size={14} />
                  </button>
                  <button onClick={() => { if (confirm('Delete this product?')) onDelete(item.id); }}
                    className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-600">
                    <Trash2 size={14} />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
