// Shared between the client dropdown (StockForm.tsx) and the server-side
// validation (app/api/stock-movements/route.ts) — kept in one place so a
// reason added or renamed in only one of those two spots can't silently
// desync the two (dropdown offers a value the server then rejects, or vice
// versa).
export const IN_REASONS = ['New Purchase / Restock', 'Customer Return', 'RTS (Return to Sender)', 'Transfer In', 'Inventory Adjustment', 'Other'];
export const OUT_REASONS = ['Damaged / Defective', 'Supplier Return', 'Transfer Out', 'Online Order', 'Inventory Adjustment', 'Internal Use', 'Other'];
