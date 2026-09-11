'use client';

import { useState } from 'react';
import { PenTool, Loader2, Copy, Check, Plus, X, MessageSquareText, Bot, Headset, Megaphone, MessageCircle } from 'lucide-react';
import { Toast, useToast } from '@/components/ui/Toast';
import type { AdCopyResult } from '@/lib/ad-copy-generator';

const LANGUAGES = ['Taglish', 'English', 'Filipino'] as const;
const FOLLOW_UP_OPTIONS = [0, 5, 10] as const;

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5 shrink-0"
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
      {copied ? 'Copied' : label}
    </button>
  );
}

function SectionHeader({ icon: Icon, title, subtitle }: { icon: React.ElementType; title: string; subtitle?: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon size={14} className="text-orange-500" />
      <p className="text-xs font-semibold text-gray-700">{title}</p>
      {subtitle && <span className="text-[10px] text-gray-400 font-normal">— {subtitle}</span>}
    </div>
  );
}

export default function AdCopyGeneratorClient() {
  const { toast, showToast, clearToast } = useToast();

  const [productName, setProductName] = useState('');
  const [description, setDescription] = useState('');
  const [keyFeatures, setKeyFeatures] = useState(['', '', '']);
  const [targetAudience, setTargetAudience] = useState('');
  const [language, setLanguage] = useState<typeof LANGUAGES[number]>('Taglish');
  const [tone, setTone] = useState('Friendly at persuasive');
  const [creativity, setCreativity] = useState(0.7);
  const [variants, setVariants] = useState(1);
  const [followUpCount, setFollowUpCount] = useState<typeof FOLLOW_UP_OPTIONS[number]>(0);

  const [shopName, setShopName] = useState('');
  const [price, setPrice] = useState('');
  const [promoOffer, setPromoOffer] = useState('');
  const [deliveryTime, setDeliveryTime] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('COD');
  const [legitimacyInfo, setLegitimacyInfo] = useState('');
  const [additionalInstructions, setAdditionalInstructions] = useState('');

  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<AdCopyResult | null>(null);

  const setFeature = (i: number, value: string) => setKeyFeatures(f => f.map((v, idx) => idx === i ? value : v));
  const addFeature = () => keyFeatures.length < 5 && setKeyFeatures(f => [...f, '']);
  const removeFeature = (i: number) => setKeyFeatures(f => f.filter((_, idx) => idx !== i));

  const generate = async () => {
    setError('');
    if (!productName.trim()) { setError('Product/Service name is required.'); return; }
    if (!shopName.trim()) { setError('Shop name is required.'); return; }
    if (!price.trim()) { setError('Price is required.'); return; }
    if (!promoOffer.trim()) { setError('Promo/Offer is required.'); return; }

    setGenerating(true);
    setResult(null);
    try {
      const res = await fetch('/api/ad-copy-generator/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_name: productName.trim(),
          description: description || undefined,
          key_features: keyFeatures.filter(Boolean),
          target_audience: targetAudience || undefined,
          language,
          tone,
          creativity,
          variants,
          follow_up_count: followUpCount,
          shop_name: shopName.trim(),
          price: price.trim(),
          promo_offer: promoOffer.trim(),
          delivery_time: deliveryTime || undefined,
          payment_method: paymentMethod || undefined,
          legitimacy_info: legitimacyInfo || undefined,
          additional_instructions: additionalInstructions || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Ad copy generation failed. Please try again.'); return; }
      setResult(data);
      showToast('Ad copy generated!');
    } catch (e: any) {
      setError('Ad copy generation failed. Please try again.');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      {toast && <Toast message={toast.message} type={toast.type} onClose={clearToast} />}

      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><PenTool size={22} className="text-orange-500" /> Ad Copy Generator</h1>
        <p className="text-sm text-gray-500 mt-1">Generate FB ad creatives, BotCake chatbot prompts, and Messenger follow-up sequences for your products.</p>
      </div>

      <div className="grid lg:grid-cols-2 gap-6 items-start">
        {/* LEFT: Inputs */}
        <div className="card space-y-5">
          <p className="text-sm font-semibold text-gray-700">Product Details</p>

          <div>
            <label className="form-label">Product / Service Name</label>
            <input type="text" className="form-input" value={productName} onChange={e => setProductName(e.target.value)} placeholder="e.g. GlowUp Vitamin C Serum" />
          </div>

          <div>
            <label className="form-label">Description <span className="text-gray-400 font-normal">— optional</span></label>
            <textarea className="form-input" rows={3} value={description} onChange={e => setDescription(e.target.value)} placeholder="What is the product, benefits, price, offer..." />
          </div>

          <div>
            <label className="form-label">Key Features <span className="text-gray-400 font-normal">— up to 5</span></label>
            <div className="space-y-1.5">
              {keyFeatures.map((f, i) => (
                <div key={i} className="flex gap-1.5">
                  <input type="text" className="form-input" value={f} onChange={e => setFeature(i, e.target.value)} placeholder={`Feature ${i + 1}`} />
                  {keyFeatures.length > 1 && (
                    <button onClick={() => removeFeature(i)} className="btn-secondary px-2.5 shrink-0"><X size={14} /></button>
                  )}
                </div>
              ))}
            </div>
            {keyFeatures.length < 5 && (
              <button onClick={addFeature} className="text-xs text-orange-600 font-medium mt-1.5 flex items-center gap-1"><Plus size={13} /> Add feature</button>
            )}
          </div>

          <div>
            <label className="form-label">Target Audience <span className="text-gray-400 font-normal">— optional</span></label>
            <input type="text" className="form-input" value={targetAudience} onChange={e => setTargetAudience(e.target.value)} placeholder="e.g. Moms 25-40, budget-conscious" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">Language</label>
              <select className="form-input" value={language} onChange={e => setLanguage(e.target.value as typeof LANGUAGES[number])}>
                {LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">Ad Creative Variants</label>
              <select className="form-input" value={variants} onChange={e => setVariants(Number(e.target.value))}>
                {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="form-label">Tone</label>
            <input type="text" className="form-input" value={tone} onChange={e => setTone(e.target.value)} placeholder="Friendly at persuasive" />
          </div>

          <div>
            <label className="form-label">Creativity <span className="text-gray-400 font-normal">({creativity.toFixed(1)})</span></label>
            <input type="range" min={0} max={1} step={0.1} value={creativity} onChange={e => setCreativity(Number(e.target.value))} className="w-full accent-orange-500" />
          </div>

          <div>
            <label className="form-label">Follow-up Messages <span className="text-gray-400 font-normal">— BotCake broadcast sequence</span></label>
            <select className="form-input" value={followUpCount} onChange={e => setFollowUpCount(Number(e.target.value) as typeof FOLLOW_UP_OPTIONS[number])}>
              <option value={0}>None</option>
              <option value={5}>5 messages</option>
              <option value={10}>10 messages</option>
            </select>
          </div>

          <div className="border-t border-gray-100 pt-4 space-y-4">
            <p className="text-sm font-semibold text-gray-700">Shop Info</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="form-label">Shop Name</label>
                <input type="text" className="form-input" value={shopName} onChange={e => setShopName(e.target.value)} placeholder="e.g. Bodega ni Suki" />
              </div>
              <div>
                <label className="form-label">Price (₱)</label>
                <input type="text" className="form-input" value={price} onChange={e => setPrice(e.target.value)} placeholder="e.g. 499" />
              </div>
            </div>
            <div>
              <label className="form-label">Promo / Offer</label>
              <input type="text" className="form-input" value={promoOffer} onChange={e => setPromoOffer(e.target.value)} placeholder="e.g. BUY 1 TAKE 1, FREE SHIPPING" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="form-label">Delivery Time <span className="text-gray-400 font-normal">— optional</span></label>
                <input type="text" className="form-input" value={deliveryTime} onChange={e => setDeliveryTime(e.target.value)} placeholder="3 to 6 days Luzon" />
              </div>
              <div>
                <label className="form-label">Payment Method <span className="text-gray-400 font-normal">— optional</span></label>
                <input type="text" className="form-input" value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)} placeholder="COD" />
              </div>
            </div>
            <div>
              <label className="form-label">Legitimacy Info <span className="text-gray-400 font-normal">— optional, e.g. reviews, years in business</span></label>
              <textarea className="form-input" rows={2} value={legitimacyInfo} onChange={e => setLegitimacyInfo(e.target.value)} placeholder="e.g. 5000+ satisfied customers, DTI registered" />
            </div>
            <div>
              <label className="form-label">Additional Instructions <span className="text-gray-400 font-normal">— optional</span></label>
              <textarea className="form-input" rows={2} value={additionalInstructions} onChange={e => setAdditionalInstructions(e.target.value)} placeholder="Any other instructions for the AI..." />
            </div>
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          <button onClick={generate} disabled={generating} className="btn-primary w-full text-base py-3 disabled:opacity-50 flex items-center justify-center gap-2">
            {generating ? <Loader2 size={16} className="animate-spin" /> : <PenTool size={16} />}
            {generating ? 'Generating...' : 'GENERATE AD COPY'}
          </button>
        </div>

        {/* RIGHT: Output */}
        <div className="card space-y-6 lg:sticky lg:top-6">
          <p className="text-sm font-semibold text-gray-700">Generated Content</p>

          {generating ? (
            <div className="flex flex-col items-center gap-2 text-gray-400 py-12">
              <Loader2 size={28} className="animate-spin" />
              <p className="text-xs">Writing your ad copy and chatbot prompts...</p>
            </div>
          ) : result ? (
            <div className="space-y-6">
              {/* Main Flow first auto-reply */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <SectionHeader icon={MessageCircle} title="Main Flow" subtitle="first auto-reply" />
                  <CopyButton text={result.mainFlowReply} />
                </div>
                <div className="rounded-lg bg-gray-50 border border-gray-100 p-3">
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{result.mainFlowReply}</p>
                </div>
              </div>

              {/* Ad Creatives */}
              <div className="space-y-2">
                <SectionHeader icon={Megaphone} title="Ad Creatives" subtitle="FB Ads Manager" />
                <div className="space-y-3">
                  {result.adCreatives.map((v, i) => (
                    <div key={i} className="rounded-lg border border-gray-200 p-3 space-y-2.5">
                      {result.adCreatives.length > 1 && <p className="text-xs font-semibold text-orange-600">Variant {i + 1}</p>}

                      <div>
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-semibold text-gray-400 uppercase">Headline</span>
                          <CopyButton text={v.headline} />
                        </div>
                        <p className="text-sm font-bold text-gray-900">{v.headline}</p>
                      </div>

                      <div>
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-semibold text-gray-400 uppercase">Primary Text</span>
                          <CopyButton text={v.primaryText} />
                        </div>
                        <p className="text-sm text-gray-700 whitespace-pre-wrap">{v.primaryText}</p>
                      </div>

                      <div>
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-semibold text-gray-400 uppercase">Messaging Template</span>
                          <CopyButton text={v.messagingTemplate} />
                        </div>
                        <p className="text-sm text-gray-700 whitespace-pre-wrap">{v.messagingTemplate}</p>
                      </div>

                      {v.quickReplies.length > 0 && (
                        <div>
                          <span className="text-[10px] font-semibold text-gray-400 uppercase">Quick Replies</span>
                          <div className="flex flex-wrap gap-1.5 mt-1">
                            {v.quickReplies.map((q, qi) => (
                              <span key={qi} className="text-xs bg-orange-50 text-orange-700 border border-orange-200 rounded-full px-2.5 py-1">{q}</span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* BotCake Sales Prompt */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <SectionHeader icon={Bot} title="BotCake Sales Prompt" subtitle="paste into BotCake AI" />
                  <CopyButton text={result.salesPrompt} />
                </div>
                <div className="rounded-lg bg-gray-50 border border-gray-100 p-3 max-h-56 overflow-y-auto">
                  <p className="text-xs text-gray-700 whitespace-pre-wrap font-mono">{result.salesPrompt}</p>
                </div>
              </div>

              {/* BotCake After-Sales Prompt */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <SectionHeader icon={Headset} title="BotCake After-Sales Prompt" subtitle="paste into BotCake AI" />
                  <CopyButton text={result.afterSalesPrompt} />
                </div>
                <div className="rounded-lg bg-gray-50 border border-gray-100 p-3 max-h-56 overflow-y-auto">
                  <p className="text-xs text-gray-700 whitespace-pre-wrap font-mono">{result.afterSalesPrompt}</p>
                </div>
              </div>

              {/* Follow-up Sequence */}
              {result.followUpMessages.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <SectionHeader icon={MessageSquareText} title="Follow-up Sequence" subtitle={`${result.followUpMessages.length} msg · uses {{first_name}} / {{PRICING}}`} />
                    <CopyButton text={result.followUpMessages.map((m, i) => `${i + 1}. ${m}`).join('\n\n')} label="Copy all" />
                  </div>
                  <div className="space-y-2">
                    {result.followUpMessages.map((m, i) => (
                      <div key={i} className="flex items-start gap-2 rounded-lg bg-gray-50 border border-gray-100 p-3">
                        <span className="text-xs font-semibold text-gray-400 mt-0.5 shrink-0">#{i + 1}</span>
                        <p className="text-sm text-gray-700 whitespace-pre-wrap flex-1">{m}</p>
                        <CopyButton text={m} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 text-gray-300 py-12">
              <PenTool size={32} />
              <p className="text-xs text-gray-400">Your generated ad copy will appear here</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
