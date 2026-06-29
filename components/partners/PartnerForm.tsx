'use client';

import { useState } from 'react';
import type { Partner } from './PartnersClient';

const SUBSCRIPTIONS = ['STARTER WV', 'ELITE WV', 'OLD PARTNER STARTER'];
const STATUSES = ['PENDING', 'DONE', 'NO SHOW'];
const STAGES  = ['PENDING', 'DONE'];
const ADS_STAGES = ['PENDING', 'START'];

interface Props { initial?: Partner; onSuccess: () => void; onCancel: () => void; }

export default function PartnerForm({ initial, onSuccess, onCancel }: Props) {
  const [name,             setName]            = useState(initial?.name ?? '');
  const [contact,          setContact]         = useState(initial?.contact ?? '');
  const [schedule,         setSchedule]        = useState(initial?.schedule?.slice(0,16) ?? '');
  const [remarks,          setRemarks]         = useState(initial?.remarks ?? 'PENDING');
  const [subscription,     setSubscription]    = useState(initial?.subscription ?? '');
  const [price,            setPrice]           = useState(initial?.price ? String(initial.price) : '');
  const [assistBy,         setAssistBy]        = useState(initial?.assist_by ?? '');
  const [commission,       setCommission]      = useState(initial?.commission ?? '');
  const [referredBy,       setReferredBy]      = useState(initial?.referred_by ?? '');
  const [contractSigning,  setContractSigning] = useState(initial?.contract_signing ?? '');
  const [onboarding,       setOnboarding]      = useState(initial?.onboarding ?? '');
  const [startAds,         setStartAds]        = useState(initial?.start_ads ?? '');
  const [companyName,      setCompanyName]     = useState(initial?.company_name ?? '');
  const [email,            setEmail]           = useState(initial?.email ?? '');
  const [bank,             setBank]            = useState(initial?.bank ?? '');
  const [acctName,         setAcctName]        = useState(initial?.acct_name ?? '');
  const [acctNumber,       setAcctNumber]      = useState(initial?.acct_number ?? '');
  const [notes,            setNotes]           = useState(initial?.notes ?? '');
  const [submitting,       setSubmitting]      = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    const body = {
      name, contact: contact || null, schedule: schedule || null, remarks,
      subscription: subscription || null, price: parseFloat(price) || 0,
      assist_by: assistBy || null, commission: commission || null,
      referred_by: referredBy || null, contract_signing: contractSigning || null,
      onboarding: onboarding || null, start_ads: startAds || null,
      company_name: companyName || null, email: email || null,
      bank: bank || null, acct_name: acctName || null, acct_number: acctNumber || null,
      notes: notes || null,
    };
    try {
      const url    = initial ? `/api/partners/${initial.id}` : '/api/partners';
      const method = initial ? 'PUT' : 'POST';
      await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      onSuccess();
    } finally { setSubmitting(false); }
  };

  const F = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div><label className="form-label">{label}</label>{children}</div>
  );
  const S = ({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) => (
    <select className="form-input" value={value} onChange={e => onChange(e.target.value)}>
      <option value="">— Select —</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Basic Info */}
      <div>
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Basic Information</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <F label="Full Name *"><input className="form-input" value={name} onChange={e => setName(e.target.value)} required placeholder="Juan dela Cruz" /></F>
          </div>
          <F label="Contact No."><input className="form-input" value={contact} onChange={e => setContact(e.target.value)} placeholder="09XX XXX XXXX" /></F>
          <F label="Schedule"><input type="datetime-local" className="form-input" value={schedule} onChange={e => setSchedule(e.target.value)} /></F>
          <F label="Company Name"><input className="form-input" value={companyName} onChange={e => setCompanyName(e.target.value)} /></F>
          <F label="Email"><input type="email" className="form-input" value={email} onChange={e => setEmail(e.target.value)} /></F>
        </div>
      </div>

      {/* Discovery Call */}
      <div>
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Discovery Call & Subscription</p>
        <div className="grid grid-cols-2 gap-3">
          <F label="Call Status"><S value={remarks} onChange={setRemarks} options={STATUSES} /></F>
          <F label="Subscription"><S value={subscription} onChange={setSubscription} options={SUBSCRIPTIONS} /></F>
          <F label="Price (₱)"><input type="number" className="form-input" value={price} onChange={e => setPrice(e.target.value)} placeholder="999" /></F>
          <F label="Referred By"><input className="form-input" value={referredBy} onChange={e => setReferredBy(e.target.value)} placeholder="NEW / OLD / Name" /></F>
          <F label="Assisted By"><input className="form-input" value={assistBy} onChange={e => setAssistBy(e.target.value)} placeholder="LHEN" /></F>
          <F label="Commission"><input className="form-input" value={commission} onChange={e => setCommission(e.target.value)} placeholder="RECEIVED 06/16/26 / NONE" /></F>
        </div>
      </div>

      {/* Onboarding Stages */}
      <div>
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Onboarding Progress</p>
        <div className="grid grid-cols-3 gap-3">
          <F label="Contract Signing"><S value={contractSigning} onChange={setContractSigning} options={STAGES} /></F>
          <F label="Onboarding"><S value={onboarding} onChange={setOnboarding} options={STAGES} /></F>
          <F label="Start Ads"><S value={startAds} onChange={setStartAds} options={ADS_STAGES} /></F>
        </div>
      </div>

      {/* Banking */}
      <div>
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Banking Details</p>
        <div className="grid grid-cols-3 gap-3">
          <F label="Bank"><input className="form-input" value={bank} onChange={e => setBank(e.target.value)} placeholder="BDO, GCash..." /></F>
          <F label="Account Name"><input className="form-input" value={acctName} onChange={e => setAcctName(e.target.value)} /></F>
          <F label="Account Number"><input className="form-input" value={acctNumber} onChange={e => setAcctNumber(e.target.value)} /></F>
        </div>
      </div>

      {/* Notes */}
      <F label="Notes"><textarea className="form-input" rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Additional notes..." /></F>

      <div className="flex justify-end gap-3 pt-2">
        <button type="button" onClick={onCancel} className="btn-secondary">Cancel</button>
        <button type="submit" disabled={submitting} className="btn-primary disabled:opacity-50">
          {submitting ? 'Saving...' : initial ? 'Update Partner' : 'Add Partner'}
        </button>
      </div>
    </form>
  );
}
