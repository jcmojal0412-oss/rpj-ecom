'use client';

import { useState, useRef } from 'react';
import { Upload, Loader2, AlertTriangle } from 'lucide-react';
import { EXPENSE_CATEGORIES, PAYMENT_METHODS, type Business } from './constants';

export interface AICapturedFields {
  date: string;
  amount: string;
  paid_to: string;
  reference_number: string;
  payment_method: string;
  suggested_category: string;
  suggested_business_id: number | null;
  receipt_path: string;
  unable_to_detect: string[];
}

interface Props {
  businesses: Business[];
  /** "Edit Details" — populate the form below, let the user finish it manually. */
  onCaptured: (fields: AICapturedFields) => void;
  /** "Confirm & Save" — populate the form AND save immediately. */
  onConfirmSave: (fields: AICapturedFields) => void;
  /** Scan failed but the receipt itself is safely stored — hand its path up so it isn't orphaned. */
  onSkipAI: (receiptPath: string) => void;
}

type Stage = 'idle' | 'uploading' | 'scanning' | 'review' | 'error';

// The prompt asks the model to only ever use these exact names, but LLM
// instruction-following isn't 100% reliable — normalize common variants
// (spacing/casing/synonyms) rather than trust the raw strings, so a field
// that really was undetected still gets flagged even if the model drifts
// slightly from the requested spelling.
const KNOWN_FIELDS = ['date', 'amount', 'paid_to', 'reference_number', 'payment_method', 'suggested_category'];
const FIELD_ALIASES: Record<string, string> = {
  paidto: 'paid_to',
  referencenumber: 'reference_number', reference_no: 'reference_number', reference: 'reference_number',
  paymentmethod: 'payment_method',
  category: 'suggested_category', suggestedcategory: 'suggested_category',
};
function normalizeUnableToDetect(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const key = item.trim().toLowerCase().replace(/\s+/g, '_');
    const mapped = FIELD_ALIASES[key] ?? key;
    if (KNOWN_FIELDS.includes(mapped)) out.add(mapped);
  }
  return [...out];
}

export default function AIReceiptCapture({ businesses, onCaptured, onConfirmSave, onSkipAI }: Props) {
  const [stage, setStage] = useState<Stage>('idle');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [receiptPath, setReceiptPath] = useState('');
  const [uploadedFilename, setUploadedFilename] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [unableToDetect, setUnableToDetect] = useState<string[]>([]);
  const [suggestedBusinessId, setSuggestedBusinessId] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const runScan = async (filename: string) => {
    setError('');
    setStage('scanning');
    try {
      const scanRes = await fetch('/api/expenses/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename }),
      });
      const scanData = await scanRes.json();
      if (!scanRes.ok) throw new Error(scanData.error || 'AI scan failed');

      const ex = scanData.expense || {};
      setFields({
        date: ex.date || '',
        amount: ex.amount != null ? String(ex.amount) : '',
        paid_to: ex.paid_to || '',
        reference_number: ex.reference_number || '',
        payment_method: ex.payment_method || '',
        suggested_category: ex.suggested_category || '',
      });
      setUnableToDetect(normalizeUnableToDetect(ex.unable_to_detect));
      const matchedBusiness = ex.suggested_business
        ? businesses.find(b => b.name.toLowerCase() === String(ex.suggested_business).toLowerCase())
        : null;
      setSuggestedBusinessId(matchedBusiness ? matchedBusiness.id : null);
      setStage('review');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong scanning this image.');
      setStage('error');
    }
  };

  const handleFile = async (file: File) => {
    setError('');
    setStage('uploading');
    setPreview(URL.createObjectURL(file));
    try {
      const form = new FormData();
      form.append('file', file);
      const uploadRes = await fetch('/api/upload/receipt', { method: 'POST', body: form });
      const uploadData = await uploadRes.json();
      if (!uploadRes.ok) throw new Error(uploadData.error || 'Upload failed');
      setReceiptPath(uploadData.path);
      setUploadedFilename(uploadData.filename);
      await runScan(uploadData.filename);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong uploading this image.');
      setStage('error');
    }
  };

  // If the upload already succeeded, retry only re-runs the scan on the
  // same stored file — no need to re-upload, and nothing gets orphaned.
  const retry = () => {
    if (uploadedFilename) runScan(uploadedFilename);
    else reset();
  };

  const buildFields = (): AICapturedFields => ({
    date: fields.date || '', amount: fields.amount || '', paid_to: fields.paid_to || '',
    reference_number: fields.reference_number || '', payment_method: fields.payment_method || '',
    suggested_category: fields.suggested_category || '', suggested_business_id: suggestedBusinessId,
    receipt_path: receiptPath, unable_to_detect: unableToDetect,
  });

  const reset = () => {
    setStage('idle'); setError(''); setPreview(null); setReceiptPath(''); setUploadedFilename('');
    setFields({}); setUnableToDetect([]); setSuggestedBusinessId(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const isUnclear = (key: string) => unableToDetect.includes(key);

  return (
    <div>
      {stage === 'idle' && (
        <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-gray-200 rounded-xl py-10 cursor-pointer hover:border-orange-300 hover:bg-orange-50/30 transition-colors">
          <Upload className="text-gray-300" size={28} />
          <span className="text-sm font-medium text-gray-600">Tap to upload a receipt or payment screenshot</span>
          <span className="text-xs text-gray-400">JPG, PNG, WEBP — from your camera or gallery</span>
          <input
            ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />
        </label>
      )}

      {(stage === 'uploading' || stage === 'scanning') && (
        <div className="flex flex-col items-center justify-center gap-3 py-10">
          {preview && <img src={preview} alt="Receipt preview" className="h-24 rounded-lg object-cover border border-gray-200" />}
          <Loader2 className="animate-spin text-orange-400" size={22} />
          <span className="text-sm text-gray-500">{stage === 'uploading' ? 'Uploading receipt...' : 'AI is reading the receipt...'}</span>
        </div>
      )}

      {stage === 'error' && (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <AlertTriangle className="text-red-400" size={24} />
          <p className="text-sm text-red-600">{error}</p>
          {receiptPath && (
            <p className="text-xs text-gray-400">Your receipt was uploaded successfully — only reading it with AI failed.</p>
          )}
          <div className="flex items-center gap-2">
            <button type="button" onClick={retry} className="btn-secondary text-xs">Try Again</button>
            {receiptPath && (
              <button type="button" onClick={() => { onSkipAI(receiptPath); reset(); }} className="btn-primary text-xs">
                Use This Receipt Without AI
              </button>
            )}
          </div>
        </div>
      )}

      {stage === 'review' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            {preview && <img src={preview} alt="Receipt preview" className="h-16 w-16 rounded-lg object-cover border border-gray-200 shrink-0" />}
            <div>
              <p className="text-sm font-semibold text-gray-800 flex items-center gap-1.5">
                AI Captured Details
                <span className="text-[10px] font-bold uppercase tracking-wide bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded">AI Suggested</span>
              </p>
              <p className="text-xs text-gray-400">Review and correct anything before saving.</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <AIField label="Date" value={fields.date} unclear={isUnclear('date')} type="date"
              onChange={v => setFields(f => ({ ...f, date: v }))} />
            <AIField label="Amount (₱)" value={fields.amount} unclear={isUnclear('amount')} type="number"
              onChange={v => setFields(f => ({ ...f, amount: v }))} />
            <div className="col-span-2">
              <AIField label="Paid To" value={fields.paid_to} unclear={isUnclear('paid_to')}
                onChange={v => setFields(f => ({ ...f, paid_to: v }))} />
            </div>
            <AIField label="Reference Number" value={fields.reference_number} unclear={isUnclear('reference_number')}
              onChange={v => setFields(f => ({ ...f, reference_number: v }))} />
            <div>
              <label className="form-label flex items-center gap-1">
                Payment Method {isUnclear('payment_method') && <NeedsReview />}
              </label>
              <select className="form-input" value={fields.payment_method || ''}
                onChange={e => setFields(f => ({ ...f, payment_method: e.target.value }))}>
                <option value="">— Select —</option>
                {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label flex items-center gap-1">
                Suggested Category {isUnclear('suggested_category') && <NeedsReview />}
              </label>
              <select className="form-input" value={fields.suggested_category || ''}
                onChange={e => setFields(f => ({ ...f, suggested_category: e.target.value }))}>
                <option value="">— Select —</option>
                {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">Suggested Business</label>
              <select className="form-input" value={suggestedBusinessId ?? ''}
                onChange={e => setSuggestedBusinessId(e.target.value ? Number(e.target.value) : null)}>
                <option value="">— Select —</option>
                {businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              {!suggestedBusinessId && <p className="text-[11px] text-gray-400 mt-1">AI couldn&apos;t tell which business — please choose one.</p>}
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={() => onCaptured(buildFields())} className="btn-secondary text-sm">Edit Details</button>
            <button type="button" onClick={() => onConfirmSave(buildFields())} className="btn-primary text-sm">Confirm &amp; Save</button>
          </div>
          <button type="button" onClick={reset} className="text-xs text-gray-400 hover:text-gray-600">Scan a different image</button>
        </div>
      )}
    </div>
  );
}

function NeedsReview() {
  return <span className="text-[10px] font-semibold text-red-500 bg-red-50 px-1.5 py-0.5 rounded">Needs Review</span>;
}

function AIField({ label, value, unclear, onChange, type = 'text' }: {
  label: string; value: string | undefined; unclear: boolean; onChange: (v: string) => void; type?: string;
}) {
  return (
    <div>
      <label className="form-label flex items-center gap-1">{label} {unclear && <NeedsReview />}</label>
      <input
        type={type} step={type === 'number' ? '0.01' : undefined}
        className={`form-input ${unclear && !value ? 'border-red-300 bg-red-50/40' : ''}`}
        value={value || ''} onChange={e => onChange(e.target.value)}
        placeholder={unclear ? 'Enter manually — AI could not detect this' : ''}
      />
    </div>
  );
}
