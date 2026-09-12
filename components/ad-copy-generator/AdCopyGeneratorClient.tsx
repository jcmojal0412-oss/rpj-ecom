'use client';

import { useRef, useState } from 'react';
import { PenTool, Loader2, Copy, Check, Plus, X, MessageSquareText, Bot, Headset, Megaphone, MessageCircle, Upload, Sparkles, RefreshCw } from 'lucide-react';
import { Toast, useToast } from '@/components/ui/Toast';
import type { AdCopyResult } from '@/lib/ad-copy-generator';

const LANGUAGES = ['Taglish', 'English', 'Filipino'] as const;
const FOLLOW_UP_OPTIONS = [0, 5, 10] as const;
const AD_OBJECTIVES = ['Messages', 'Comment Automation', 'Website Sales', 'Engagement'] as const;
const COPY_LENGTHS = ['Short', 'Standard', 'Long'] as const;
// Only add these if genuinely true for the shop — they're suggestions the
// seller opts into, not auto-asserted claims (a false "100% Business
// Registered" claim would be the seller's own legal exposure, not just a
// copy-quality issue).
const LEGITIMACY_SUGGESTIONS = ['Money-Back Guarantee', '100% Original and Legit', '100% Business Registered with Permit'];

/** Resize to max 1200px + compress to JPEG — keeps upload/token size down. */
function compressToBase64(file: File): Promise<{ base64: string; mediaType: string }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX = 1200;
      let w = img.naturalWidth || img.width;
      let h = img.naturalHeight || img.height;
      if (w > MAX || h > MAX) {
        const r = Math.min(MAX / w, MAX / h);
        w = Math.round(w * r);
        h = Math.round(h * r);
      }
      const canvas = document.createElement('canvas');
      canvas.width = w || 1;
      canvas.height = h || 1;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Canvas unavailable')); return; }
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(blob => {
        if (!blob) { reject(new Error('Compression failed')); return; }
        const reader = new FileReader();
        reader.onload = () => resolve({ base64: (reader.result as string).split(',')[1], mediaType: 'image/jpeg' });
        reader.onerror = () => reject(new Error('Read failed'));
        reader.readAsDataURL(blob);
      }, 'image/jpeg', 0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image load failed')); };
    img.src = url;
  });
}

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
  const [followUpCount, setFollowUpCount] = useState<typeof FOLLOW_UP_OPTIONS[number]>(10);
  const [adObjective, setAdObjective] = useState<typeof AD_OBJECTIVES[number]>('Messages');
  const [copyLength, setCopyLength] = useState<typeof COPY_LENGTHS[number]>('Standard');
  const [regeneratingHook, setRegeneratingHook] = useState(false);

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

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [autofilling, setAutofilling] = useState(false);
  const [generatingFeatures, setGeneratingFeatures] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const setFeature = (i: number, value: string) => setKeyFeatures(f => f.map((v, idx) => idx === i ? value : v));
  const addFeature = () => keyFeatures.length < 5 && setKeyFeatures(f => [...f, '']);
  const removeFeature = (i: number) => setKeyFeatures(f => f.filter((_, idx) => idx !== i));

  const addLegitimacySuggestion = (s: string) => {
    setLegitimacyInfo(prev => {
      const parts = prev.split(',').map(p => p.trim()).filter(Boolean);
      if (parts.includes(s)) return prev;
      return [...parts, s].join(', ');
    });
  };

  const onFileChange = (file: File | null) => {
    setImageFile(file);
    if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    setImagePreviewUrl(file ? URL.createObjectURL(file) : null);
  };

  const autofillFromImage = async () => {
    if (!imageFile) return;
    setError('');
    setAutofilling(true);
    try {
      const { base64, mediaType } = await compressToBase64(imageFile);
      const res = await fetch('/api/ad-copy-generator/autofill', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_base64: base64, image_media_type: mediaType, language }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Could not analyze the image. Please try again.'); return; }
      setProductName(data.productName || '');
      setDescription(data.description || '');
      if (Array.isArray(data.keyFeatures) && data.keyFeatures.length) {
        const filled = [...data.keyFeatures].slice(0, 5);
        while (filled.length < 3) filled.push('');
        setKeyFeatures(filled);
      }
      showToast('Auto-filled from image!');
    } catch (e: any) {
      setError('Could not analyze the image. Please try again.');
    } finally {
      setAutofilling(false);
    }
  };

  // Scoped version of autofill — only touches Key Features, leaving
  // Product Name/Description alone (useful when those are already typed
  // and the user just wants AI-suggested features from the photo).
  const generateFeaturesFromImage = async () => {
    if (!imageFile) { setError('Upload a product image first.'); return; }
    setError('');
    setGeneratingFeatures(true);
    try {
      const { base64, mediaType } = await compressToBase64(imageFile);
      const res = await fetch('/api/ad-copy-generator/autofill', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_base64: base64, image_media_type: mediaType, language }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Could not analyze the image. Please try again.'); return; }
      if (Array.isArray(data.keyFeatures) && data.keyFeatures.length) {
        const filled = [...data.keyFeatures].slice(0, 5);
        while (filled.length < 3) filled.push('');
        setKeyFeatures(filled);
        showToast('Features generated from image!');
      } else {
        setError('Could not identify features from this image.');
      }
    } catch (e: any) {
      setError('Could not analyze the image. Please try again.');
    } finally {
      setGeneratingFeatures(false);
    }
  };

  const generate = async () => {
    setError('');
    if (!imageFile) { setError('Product image is required.'); return; }
    if (!productName.trim()) { setError('Product/Service name is required.'); return; }
    if (!shopName.trim()) { setError('Shop name is required.'); return; }
    if (!price.trim()) { setError('Price is required.'); return; }
    if (!promoOffer.trim()) { setError('Promo/Offer is required.'); return; }

    setGenerating(true);
    setResult(null);
    try {
      let productImage: { base64: string; mediaType: string };
      try {
        productImage = await compressToBase64(imageFile);
      } catch {
        setError('Could not process the product image. Please try a different photo.');
        return;
      }

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
          ad_objective: adObjective,
          copy_length: copyLength,
          shop_name: shopName.trim(),
          price: price.trim(),
          promo_offer: promoOffer.trim(),
          delivery_time: deliveryTime || undefined,
          payment_method: paymentMethod || undefined,
          legitimacy_info: legitimacyInfo || undefined,
          additional_instructions: additionalInstructions || undefined,
          product_image_base64: productImage?.base64,
          product_image_media_type: productImage?.mediaType,
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

  // Powers both "Use This Hook" (hook+angle given) and "Generate 3 New
  // Hooks" (omitted) — text-only, reuses the product info already typed in
  // this form, never re-sends the image or re-runs the full generation.
  const regenerateHook = async (hook?: string, angle?: string) => {
    if (!result) return;
    setError('');
    setRegeneratingHook(true);
    try {
      const res = await fetch('/api/ad-copy-generator/regenerate-hook', {
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
          ad_objective: adObjective,
          copy_length: copyLength,
          shop_name: shopName.trim(),
          price: price.trim(),
          promo_offer: promoOffer.trim(),
          delivery_time: deliveryTime || undefined,
          payment_method: paymentMethod || undefined,
          legitimacy_info: legitimacyInfo || undefined,
          additional_instructions: additionalInstructions || undefined,
          selected_hook: hook,
          selected_angle: angle,
          previous_hooks: result.hookOptions.map(h => h.hook),
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Could not update the hook. Please try again.'); return; }
      setResult(prev => prev ? {
        ...prev,
        adCreatives: [data.adCreative, ...prev.adCreatives.slice(1)],
        hookOptions: data.hookOptions?.length ? data.hookOptions : prev.hookOptions,
      } : prev);
      showToast(hook ? 'Hook applied!' : 'New hooks generated!');
    } catch {
      setError('Could not update the hook. Please try again.');
    } finally {
      setRegeneratingHook(false);
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
            <label className="form-label">Product Image <span className="text-red-500">*</span> <span className="text-gray-400 font-normal">— for auto-fill &amp; more accurate copy</span></label>
            {imagePreviewUrl ? (
              <div className="relative">
                <img src={imagePreviewUrl} alt="Product" className="w-full h-40 object-contain bg-gray-50 rounded-lg border border-gray-200" />
                <button onClick={() => onFileChange(null)} className="absolute top-2 right-2 btn-secondary text-xs py-1 px-2 bg-white">Remove</button>
              </div>
            ) : (
              <button onClick={() => fileInputRef.current?.click()} className="w-full h-28 border-2 border-dashed border-gray-200 rounded-lg flex flex-col items-center justify-center gap-1.5 text-gray-400 hover:border-orange-300 hover:text-orange-500 transition-colors">
                <Upload size={20} />
                <span className="text-xs font-medium">Upload Product Image</span>
              </button>
            )}
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={e => onFileChange(e.target.files?.[0] || null)} />
            {imageFile && (
              <button onClick={autofillFromImage} disabled={autofilling} className="btn-secondary text-xs py-1.5 px-3 mt-2 flex items-center gap-1.5 disabled:opacity-50">
                {autofilling ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                {autofilling ? 'Analyzing...' : 'Auto-fill from image'}
              </button>
            )}
          </div>

          <div>
            <label className="form-label">Product / Service Name <span className="text-red-500">*</span></label>
            <input type="text" className="form-input" value={productName} onChange={e => setProductName(e.target.value)} placeholder="e.g. GlowUp Vitamin C Serum" />
          </div>

          <div>
            <label className="form-label">Description <span className="text-gray-400 font-normal">— optional</span></label>
            <textarea className="form-input" rows={3} value={description} onChange={e => setDescription(e.target.value)} placeholder="What is the product, benefits, price, offer..." />
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label className="form-label mb-0">Key Features <span className="text-gray-400 font-normal">— up to 5</span></label>
              {imageFile && (
                <button onClick={generateFeaturesFromImage} disabled={generatingFeatures} className="text-xs text-orange-600 font-medium flex items-center gap-1 disabled:opacity-50">
                  {generatingFeatures ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                  {generatingFeatures ? 'Generating...' : 'Generate with AI'}
                </button>
              )}
            </div>
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

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">Ad Objective</label>
              <select className="form-input" value={adObjective} onChange={e => setAdObjective(e.target.value as typeof AD_OBJECTIVES[number])}>
                {AD_OBJECTIVES.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">Copy Length</label>
              <select className="form-input" value={copyLength} onChange={e => setCopyLength(e.target.value as typeof COPY_LENGTHS[number])}>
                {COPY_LENGTHS.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
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
                <label className="form-label">Price (₱) <span className="text-red-500">*</span></label>
                <input type="text" className="form-input" value={price} onChange={e => setPrice(e.target.value)} placeholder="e.g. 499" />
              </div>
            </div>
            <div>
              <label className="form-label">Promo / Offer <span className="text-red-500">*</span></label>
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
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {LEGITIMACY_SUGGESTIONS.map(s => (
                  <button key={s} onClick={() => addLegitimacySuggestion(s)} className="text-xs bg-gray-50 text-gray-600 border border-gray-200 rounded-full px-2.5 py-1 hover:border-orange-300 hover:text-orange-600 transition-colors">+ {s}</button>
                ))}
              </div>
              <p className="text-[10px] text-gray-400 mt-1">Only add these if genuinely true for your business.</p>
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

              {/* Choose Your Hook — only affects adCreatives[0] */}
              {result.hookOptions.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <SectionHeader icon={Sparkles} title="Choose Your Hook" subtitle="for the first ad" />
                    <button onClick={() => regenerateHook()} disabled={regeneratingHook} className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5 disabled:opacity-50">
                      {regeneratingHook ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                      Generate 3 New Hooks
                    </button>
                  </div>
                  <div className="space-y-2">
                    {result.hookOptions.map((h, i) => {
                      const active = h.hook === result.adCreatives[0]?.hook;
                      return (
                        <div key={i} className={`rounded-lg border-2 p-3 space-y-1.5 ${active ? 'border-orange-400 bg-orange-50/50' : 'border-gray-200'}`}>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[10px] font-semibold text-gray-400 uppercase">{h.angle}</span>
                            {h.isBestPick && <span className="text-[10px] font-bold text-white bg-orange-500 rounded-full px-2 py-0.5">AI BEST PICK</span>}
                            {active && <span className="text-[10px] font-semibold text-orange-600">● Active</span>}
                          </div>
                          <p className="text-sm font-bold text-gray-900">{h.hook}</p>
                          <button onClick={() => regenerateHook(h.hook, h.angle)} disabled={regeneratingHook || active} className="btn-secondary text-xs py-1 px-2.5 disabled:opacity-50">
                            {active ? 'In Use' : 'Use This Hook'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Ad Creatives */}
              <div className="space-y-2">
                <SectionHeader icon={Megaphone} title="Ad Creatives" subtitle="FB Ads Manager" />
                <div className="space-y-3">
                  {result.adCreatives.map((v, i) => (
                    <div key={i} className="rounded-lg border border-gray-200 p-3 space-y-2.5">
                      {result.adCreatives.length > 1 && <p className="text-xs font-semibold text-orange-600">Variant {i + 1}{v.angle ? ` — ${v.angle}` : ''}</p>}

                      {v.hook && (
                        <div>
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-semibold text-gray-400 uppercase">Hook</span>
                            <CopyButton text={v.hook} />
                          </div>
                          <p className="text-sm font-bold text-gray-900">{v.hook}</p>
                        </div>
                      )}

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
