'use client';

import { useState } from 'react';
import { Loader2, Send } from 'lucide-react';
import Modal from '@/components/ui/Modal';

interface Recipient {
  id: number;
  name: string;
  contact: string | null;
}

export default function SendSmsModal({
  recipient, onClose, onSent,
}: {
  recipient: Recipient;
  onClose: () => void;
  onSent: () => void;
}) {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const handleSend = async () => {
    if (!message.trim()) return;
    setSending(true);
    setError('');
    try {
      const res = await fetch(`/api/partners/${recipient.id}/sms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: message.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to send SMS.');
        return;
      }
      onSent();
    } catch {
      setError('Failed to send SMS.');
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={`Send SMS to ${recipient.name}`} size="sm">
      <div className="space-y-4">
        {!recipient.contact?.trim() ? (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
            No mobile number on file for {recipient.name}.
          </p>
        ) : (
          <>
            <p className="text-xs text-gray-500">To: {recipient.contact}</p>
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
              <button onClick={handleSend} disabled={sending || !message.trim()} className="btn-primary disabled:opacity-50">
                {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                {sending ? 'Sending...' : 'Send SMS'}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
