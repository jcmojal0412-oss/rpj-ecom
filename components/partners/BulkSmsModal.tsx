'use client';

import { useState } from 'react';
import { Loader2, Send, CheckCircle2, AlertTriangle } from 'lucide-react';
import Modal from '@/components/ui/Modal';

interface Recipient {
  id: number;
  name: string;
  contact: string | null;
}

interface BulkResult {
  sent: number;
  failed: number;
  noContact: number;
}

export default function BulkSmsModal({
  recipients, onClose, onSent,
}: {
  recipients: Recipient[];
  onClose: () => void;
  onSent: () => void;
}) {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<BulkResult | null>(null);

  const withContact = recipients.filter(r => r.contact?.trim());
  const withoutContact = recipients.filter(r => !r.contact?.trim());

  const handleSend = async () => {
    if (!message.trim() || withContact.length === 0) return;
    setSending(true);
    setError('');
    try {
      const res = await fetch('/api/partners/sms/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: recipients.map(r => r.id), message: message.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to send SMS.');
        return;
      }
      setResult({ sent: data.sent, failed: data.failed, noContact: data.noContact });
      onSent();
    } catch {
      setError('Failed to send SMS.');
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={`Send SMS to ${recipients.length} People`} size="sm">
      {result ? (
        <div className="space-y-4 text-center py-2">
          <CheckCircle2 className="mx-auto text-green-500" size={36} />
          <div className="text-sm text-gray-700 space-y-1">
            <p><span className="font-semibold text-green-700">{result.sent}</span> sent successfully</p>
            {result.failed > 0 && <p><span className="font-semibold text-red-600">{result.failed}</span> failed to send</p>}
            {result.noContact > 0 && <p><span className="font-semibold text-gray-500">{result.noContact}</span> skipped (no mobile number)</p>}
          </div>
          <button onClick={onClose} className="btn-primary mx-auto">Done</button>
        </div>
      ) : (
        <div className="space-y-4">
          {withoutContact.length > 0 && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-xs text-amber-700">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span>{withoutContact.length} of {recipients.length} selected have no mobile number and will be skipped.</span>
            </div>
          )}
          <p className="text-xs text-gray-500">
            Sending to {withContact.length} recipient{withContact.length !== 1 ? 's' : ''}: {withContact.map(r => r.name).join(', ')}
          </p>
          {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>}
          <div>
            <label className="form-label">Message</label>
            <textarea
              className="form-input"
              rows={4}
              maxLength={480}
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder="Type your message..."
              autoFocus
            />
            <p className="text-xs text-gray-400 mt-1">{message.length}/480 characters</p>
          </div>
          <div className="flex justify-end gap-3">
            <button onClick={onClose} className="btn-secondary">Cancel</button>
            <button onClick={handleSend} disabled={sending || !message.trim() || withContact.length === 0} className="btn-primary disabled:opacity-50">
              {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              {sending ? 'Sending...' : `Send to ${withContact.length}`}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
