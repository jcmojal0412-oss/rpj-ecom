'use client';

import { useState } from 'react';
import { formatCurrency } from '@/lib/utils';
import Modal from '@/components/ui/Modal';
import type { Expense } from './constants';

interface Props {
  expense: Expense;
  onCancel: () => void;
  onDeleted: () => void;
}

export default function DeleteExpenseModal({ expense, onCancel, onDeleted }: Props) {
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await fetch(`/api/expenses/${expense.id}`, { method: 'DELETE' });
      onDeleted();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Modal open onClose={onCancel} title="Delete Expense?" size="sm">
      <div className="space-y-4">
        <p className="text-sm text-gray-600">Are you sure you want to delete this expense? This cannot be undone.</p>
        <div className="bg-gray-50 rounded-xl p-4 space-y-1.5 text-sm">
          <div className="flex justify-between"><span className="text-gray-500">Amount</span><span className="font-bold text-gray-900">{formatCurrency(expense.amount)}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">Paid To</span><span className="font-medium text-gray-900">{expense.paid_to || '—'}</span></div>
        </div>
        <div className="flex justify-end gap-3 pt-1">
          <button onClick={onCancel} className="btn-secondary">Cancel</button>
          <button onClick={handleDelete} disabled={deleting} className="btn-danger disabled:opacity-50">
            {deleting ? 'Deleting...' : 'Delete Expense'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
