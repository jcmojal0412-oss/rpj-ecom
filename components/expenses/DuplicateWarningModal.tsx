'use client';

import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';
import Modal from '@/components/ui/Modal';
import ExpenseDetailsModal from './ExpenseDetailsModal';
import type { Business, Expense } from './constants';

interface Props {
  existing: Expense;
  businesses: Business[];
  onCancel: () => void;
  onContinue: () => void;
}

export default function DuplicateWarningModal({ existing, businesses, onCancel, onContinue }: Props) {
  const [viewingExisting, setViewingExisting] = useState(false);

  if (viewingExisting) {
    return (
      <ExpenseDetailsModal
        expense={existing}
        businesses={businesses}
        onClose={() => setViewingExisting(false)}
        onChanged={() => setViewingExisting(false)}
      />
    );
  }

  return (
    <Modal open onClose={onCancel} title="Possible Duplicate Expense" size="sm">
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-full bg-amber-50 shrink-0"><AlertTriangle className="text-amber-500" size={18} /></div>
          <p className="text-sm text-gray-600">This transaction may have already been recorded.</p>
        </div>
        <div className="bg-gray-50 rounded-xl p-4 space-y-1.5 text-sm">
          <div className="flex justify-between"><span className="text-gray-500">Date</span><span className="font-medium text-gray-900">{formatDate(existing.date)}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">Business</span><span className="font-medium text-gray-900">{existing.business_name || '—'}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">Paid To</span><span className="font-medium text-gray-900">{existing.paid_to || '—'}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">Amount</span><span className="font-bold text-gray-900">{formatCurrency(existing.amount)}</span></div>
        </div>
        <div className="flex flex-col gap-2 pt-1">
          <button onClick={() => setViewingExisting(true)} className="btn-secondary w-full justify-center">View Existing Expense</button>
          <button onClick={onContinue} className="btn-secondary w-full justify-center">Continue Anyway</button>
          <button onClick={onCancel} className="btn-primary w-full justify-center">Cancel</button>
        </div>
      </div>
    </Modal>
  );
}
