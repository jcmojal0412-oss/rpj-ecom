// A dotted leader between a label and its value is the classic receipt
// look — one small building block shared by every receipt-style component
// (sale receipts, return/exchange confirmation slips) so they all read as
// one consistent system.
export default function ReceiptRow({ label, value, bold, small, muted, colorClass }: {
  label: string; value: string; bold?: boolean; small?: boolean; muted?: boolean; colorClass?: string;
}) {
  return (
    <div className={`flex items-baseline gap-1.5 ${bold ? 'font-bold' : 'font-medium'} ${small ? 'text-xs' : 'text-sm'} ${colorClass ?? (muted ? 'text-gray-500' : 'text-gray-900')}`}>
      <span className="shrink-0">{label}</span>
      <span className="flex-1 border-b border-dotted border-gray-300 translate-y-[-3px]" />
      <span className="shrink-0 tabular-nums">{value}</span>
    </div>
  );
}
