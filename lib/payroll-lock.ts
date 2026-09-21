// Once payroll is approved its amounts are frozen: no adjustments, no
// statutory edits. A period that was approved by mistake has to be REOPENED
// (see /api/payroll/periods/[id]/workflow) — that is the only way back to
// editing. Returns the message to show, or null when editing is allowed.
export function payrollEditBlockedMessage(periodStatus: string): string | null {
  if (periodStatus === 'locked') return 'This payroll period is locked and can no longer be edited.';
  if (periodStatus === 'approved' || periodStatus === 'paid') {
    return 'This payroll is already approved, so its amounts are locked. Ask the owner to reopen it before making changes.';
  }
  return null;
}
