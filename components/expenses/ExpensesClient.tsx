'use client';

import { useState } from 'react';
import ExpenseDashboardTab from './ExpenseDashboardTab';
import TransactionsTab from './TransactionsTab';
import AddExpenseTab from './AddExpenseTab';

const TABS = ['Dashboard', 'Transactions', 'Add Expense'] as const;
type Tab = typeof TABS[number];

export default function ExpensesClient() {
  const [tab, setTab] = useState<Tab>('Dashboard');

  return (
    <div className="p-3 sm:p-4 lg:p-6 space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Expenses</h1>
        <p className="text-sm text-gray-500 mt-0.5">Track company spending across Bodega ni Suki and RPJ ECOM</p>
      </div>

      <div className="flex items-center bg-gray-100 rounded-lg p-1 gap-0.5 w-fit max-w-full overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`shrink-0 whitespace-nowrap px-3 sm:px-4 py-2.5 sm:py-2 rounded-md text-sm font-semibold transition-all ${
              tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'Dashboard' && <ExpenseDashboardTab onViewAll={() => setTab('Transactions')} />}
      {tab === 'Transactions' && <TransactionsTab />}
      {tab === 'Add Expense' && <AddExpenseTab onSaved={() => setTab('Transactions')} />}
    </div>
  );
}
