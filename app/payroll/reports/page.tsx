import { redirect } from 'next/navigation';

// "Payroll Reports" opens on its first (and main) report.
export default function PayrollReportsPage() {
  redirect('/payroll/reports/monthly-expense');
}
