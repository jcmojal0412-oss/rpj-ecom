'use client';

import { useRef, useState } from 'react';
import {
  Video, Upload, Sparkles, Loader2, Copy, Check, ChevronDown, ChevronUp, RefreshCw,
  Flame, Scissors, DollarSign, Gem, Users, Wand2, Clock,
} from 'lucide-react';
import { Toast, useToast } from '@/components/ui/Toast';
import type { VideoAnalysis, VideoAdCopyResult, VideoAdVersion } from '@/lib/ad-copy-generator';
import { AD_ANGLE_OPTIONS, TARGET_AUDIENCE_PRESETS, AD_OBJECTIVES, COPY_LENGTH_OPTIONS, TONE_OPTIONS } from './video-constants';

// Labels the analysis panel by what the video actually shows — a store/sale
// video isn't a "product", so calling it one there would be misleading.
const CONTENT_TYPE_LABELS: Record<string, { name: string; category: string }> = {
  'SINGLE PRODUCT': { name: 'Detected Product', category: 'Category' },
  'MULTIPLE PRODUCTS': { name: 'Products Shown', category: 'Category Mix' },
  'STORE PROMOTION': { name: 'Store', category: 'Category Mix' },
  'SALE / CAMPAIGN': { name: 'Campaign', category: 'Category Mix' },
  SERVICE: { name: 'Service', category: 'Category' },
  EVENT: { name: 'Event', category: 'Category' },
};

function SectionHeader({ icon: Icon, title, subtitle }: { icon: React.ElementType; title: string; subtitle?: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon size={14} className="text-orange-500" />
      <p className="text-xs font-semibold text-gray-700">{title}</p>
      {subtitle && <span className="text-[10px] text-gray-400 font-normal">— {subtitle}</span>}
    </div>
  );
}

const LANGUAGES = ['Taglish', 'Filipino', 'English'] as const;
const MAX_VIDEO_MB = 100;

const STAGE_MESSAGES = [
  'Extracting key scenes...',
  'Analyzing product...',
  'Understanding customer...',
];

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5 shrink-0"
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
      {copied ? 'Copied' : label}
    </button>
  );
}

function versionText(v: VideoAdVersion): string {
  return `${v.headline}\n\n${v.primaryText}\n\n${v.description}\n\n👉 ${v.cta}`;
}

export default function VideoAdCopyClient() {
  const { toast, showToast, clearToast } = useToast();

  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null);
  const [videoDuration, setVideoDuration] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [productName, setProductName] = useState('');
  const [sellingPrice, setSellingPrice] = useState('');
  const [originalPrice, setOriginalPrice] = useState('');
  const [targetAudiencePreset, setTargetAudiencePreset] = useState<typeof TARGET_AUDIENCE_PRESETS[number]>('Auto Detect');
  const [customTargetAudience, setCustomTargetAudience] = useState('');
  const [language, setLanguage] = useState<typeof LANGUAGES[number]>('Taglish');
  const [tone, setTone] = useState<typeof TONE_OPTIONS[number]>('Friendly & Persuasive');
  const [adObjective, setAdObjective] = useState<typeof AD_OBJECTIVES[number]>('Sales / Conversion');
  const [adAngle, setAdAngle] = useState<string>('AUTO');
  const [copyLength, setCopyLength] = useState<string>('Standard');

  const [offerCod, setOfferCod] = useState(false);
  const [offerFreeShipping, setOfferFreeShipping] = useState(false);
  const [offerNationwide, setOfferNationwide] = useState(false);
  const [offerLimitedStock, setOfferLimitedStock] = useState(false);
  const [offerLimitedTime, setOfferLimitedTime] = useState(false);
  const [discountPercent, setDiscountPercent] = useState('');
  const [customOffer, setCustomOffer] = useState('');

  const [analyzing, setAnalyzing] = useState(false);
  const [generatingCopy, setGeneratingCopy] = useState(false);
  const [regeneratingHook, setRegeneratingHook] = useState(false);
  const [stageText, setStageText] = useState('');
  const [error, setError] = useState('');

  const [analysis, setAnalysis] = useState<VideoAnalysis | null>(null);
  const [result, setResult] = useState<VideoAdCopyResult | null>(null);
  const [expanded, setExpanded] = useState<{ 1: boolean; 2: boolean }>({ 1: false, 2: false });

  const busy = analyzing || generatingCopy;

  const removeVideo = () => {
    if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
    setVideoFile(null);
    setVideoPreviewUrl(null);
    setVideoDuration(null);
    setAnalysis(null);
    setResult(null);
  };

  const onVideoSelected = (file: File | null) => {
    if (!file) return;
    const validTypes = ['video/mp4', 'video/quicktime', 'video/webm'];
    if (!validTypes.includes(file.type)) {
      setError('Unsupported video format. Please upload MP4, MOV, or WEBM.');
      return;
    }
    if (file.size > MAX_VIDEO_MB * 1024 * 1024) {
      setError(`Video is too large (max ${MAX_VIDEO_MB}MB).`);
      return;
    }
    setError('');
    setVideoFile(file);
    setVideoDuration(null);
    setAnalysis(null);
    setResult(null);
    if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
    setVideoPreviewUrl(URL.createObjectURL(file));
  };

  const targetAudienceValue = targetAudiencePreset === 'Custom' ? customTargetAudience : (targetAudiencePreset === 'Auto Detect' ? '' : targetAudiencePreset);

  const offerPayload = () => ({
    cod: offerCod,
    freeShipping: offerFreeShipping,
    nationwideDelivery: offerNationwide,
    limitedStock: offerLimitedStock,
    limitedTimeSale: offerLimitedTime,
    discountPercent: discountPercent || undefined,
    customOffer: customOffer || undefined,
  });

  const generateCopyFromAnalysis = async (a: VideoAnalysis, extraInstruction?: string) => {
    setGeneratingCopy(true);
    setError('');
    try {
      const res = await fetch('/api/ad-copy-generator/generate-video-copy', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          analysis: a,
          product_name: productName || undefined,
          selling_price: sellingPrice || undefined,
          original_price: originalPrice || undefined,
          target_audience: targetAudienceValue || undefined,
          language,
          tone,
          ad_objective: adObjective,
          ad_angle: adAngle,
          copy_length: copyLength,
          offer: offerPayload(),
          extra_instruction: extraInstruction,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Ad copy generation failed. Please try again.'); return; }
      setResult(data);
      setExpanded({ 1: false, 2: false });
      showToast(extraInstruction ? 'Ad copy updated!' : 'Ad copy generated!');
    } catch {
      setError('Ad copy generation failed. Please try again.');
    } finally {
      setGeneratingCopy(false);
    }
  };

  const analyzeAndGenerate = async () => {
    if (!videoFile) { setError('Please upload a product video first.'); return; }
    setError('');
    setAnalyzing(true);
    setResult(null);
    let stageIdx = 0;
    setStageText(STAGE_MESSAGES[0]);
    const stageTimer = setInterval(() => {
      stageIdx = Math.min(stageIdx + 1, STAGE_MESSAGES.length - 1);
      setStageText(STAGE_MESSAGES[stageIdx]);
    }, 3000);

    try {
      const formData = new FormData();
      formData.append('video', videoFile);
      if (productName) formData.append('product_name', productName);
      if (sellingPrice) formData.append('selling_price', sellingPrice);
      if (originalPrice) formData.append('original_price', originalPrice);
      if (targetAudienceValue) formData.append('target_audience', targetAudienceValue);
      formData.append('language', language);
      formData.append('tone', tone);
      formData.append('ad_objective', adObjective);
      formData.append('ad_angle', adAngle);
      formData.append('copy_length', copyLength);
      formData.append('offer_cod', String(offerCod));
      formData.append('offer_free_shipping', String(offerFreeShipping));
      formData.append('offer_nationwide_delivery', String(offerNationwide));
      formData.append('offer_limited_stock', String(offerLimitedStock));
      formData.append('offer_limited_time_sale', String(offerLimitedTime));
      if (discountPercent) formData.append('offer_discount_percent', discountPercent);
      if (customOffer) formData.append('offer_custom', customOffer);

      const res = await fetch('/api/ad-copy-generator/analyze-video', { method: 'POST', body: formData });
      const data = await res.json();
      clearInterval(stageTimer);
      setAnalyzing(false);
      if (!res.ok) { setError(data.error || 'Unable to analyze the video. Please try again.'); return; }

      setAnalysis(data.analysis);
      setStageText('Writing Facebook ad copy...');
      await generateCopyFromAnalysis(data.analysis);
    } catch {
      clearInterval(stageTimer);
      setAnalyzing(false);
      setError('Unable to analyze the video. Please try again.');
    }
  };

  const rewrite = (instruction: string) => {
    if (!analysis) return;
    generateCopyFromAnalysis(analysis, instruction);
  };

  // Powers both "Use This Hook" (hook+angle given) and "Generate 3 New
  // Hooks" (omitted) — text-only, reuses the saved analysis, never
  // re-sends the video frames or re-runs the full generation.
  const regenerateHook = async (hook?: string, angle?: string) => {
    if (!analysis || !result) return;
    setError('');
    setRegeneratingHook(true);
    try {
      const res = await fetch('/api/ad-copy-generator/regenerate-video-hook', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          analysis,
          product_name: productName || undefined,
          selling_price: sellingPrice || undefined,
          original_price: originalPrice || undefined,
          target_audience: targetAudienceValue || undefined,
          language,
          tone,
          ad_objective: adObjective,
          ad_angle: adAngle,
          copy_length: copyLength,
          offer: offerPayload(),
          selected_hook: hook,
          selected_angle: angle,
          previous_hooks: result.hookOptions.map(h => h.hook),
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Could not update the hook. Please try again.'); return; }
      setResult(prev => prev ? {
        ...prev,
        versions: [data.adVersion, ...prev.versions.slice(1)],
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
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Video size={22} className="text-orange-500" /> AI Ad Copy Generator</h1>
        <p className="text-sm text-gray-500 mt-1">Turn your product videos into high-converting Facebook ad copy.</p>
      </div>

      <div className="grid lg:grid-cols-2 gap-6 items-start">
        {/* LEFT: Inputs */}
        <div className="card space-y-5">
          <p className="text-sm font-semibold text-gray-700">Product Video</p>

          <div>
            <label className="form-label">Upload Product Video <span className="text-red-500">*</span> <span className="text-gray-400 font-normal">— MP4, MOV, or WEBM, max {MAX_VIDEO_MB}MB</span></label>
            {videoPreviewUrl ? (
              <div className="space-y-2">
                <video src={videoPreviewUrl} controls className="w-full max-h-56 rounded-lg border border-gray-200 bg-black" onLoadedMetadata={e => setVideoDuration(e.currentTarget.duration)} />
                <div className="flex items-center justify-between text-xs text-gray-500">
                  <span className="truncate">{videoFile?.name}</span>
                  <div className="flex items-center gap-3 shrink-0">
                    {videoDuration != null && <span className="flex items-center gap-1"><Clock size={12} /> {formatDuration(videoDuration)}</span>}
                    <span>{videoFile ? formatBytes(videoFile.size) : ''}</span>
                    <button onClick={removeVideo} className="text-orange-600 font-medium">Remove</button>
                  </div>
                </div>
              </div>
            ) : (
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => { e.preventDefault(); setDragOver(false); onVideoSelected(e.dataTransfer.files?.[0] || null); }}
                className={`w-full h-36 border-2 border-dashed rounded-lg flex flex-col items-center justify-center gap-1.5 cursor-pointer transition-colors ${dragOver ? 'border-orange-400 bg-orange-50 text-orange-500' : 'border-gray-200 text-gray-400 hover:border-orange-300 hover:text-orange-500'}`}
              >
                <Video size={22} />
                <span className="text-xs font-medium">Drag & drop your product video, or click to browse</span>
              </div>
            )}
            <input ref={fileInputRef} type="file" accept="video/mp4,video/quicktime,video/webm" className="hidden" onChange={e => onVideoSelected(e.target.files?.[0] || null)} />
          </div>

          <div className="border-t border-gray-100 pt-4 space-y-4">
            <p className="text-sm font-semibold text-gray-700">Optional Product Information</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="form-label">Product Name</label>
                <input type="text" className="form-input" value={productName} onChange={e => setProductName(e.target.value)} placeholder="e.g. Best Car Sunshade" />
              </div>
              <div>
                <label className="form-label">Selling Price</label>
                <input type="text" className="form-input" value={sellingPrice} onChange={e => setSellingPrice(e.target.value)} placeholder="e.g. 499" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="form-label">Original Price <span className="text-gray-400 font-normal">— optional</span></label>
                <input type="text" className="form-input" value={originalPrice} onChange={e => setOriginalPrice(e.target.value)} placeholder="e.g. 999" />
              </div>
              <div>
                <label className="form-label">Language</label>
                <select className="form-input" value={language} onChange={e => setLanguage(e.target.value as typeof LANGUAGES[number])}>
                  {LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="form-label">Target Audience</label>
              <select className="form-input" value={targetAudiencePreset} onChange={e => setTargetAudiencePreset(e.target.value as typeof TARGET_AUDIENCE_PRESETS[number])}>
                {TARGET_AUDIENCE_PRESETS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              {targetAudiencePreset === 'Custom' && (
                <input type="text" className="form-input mt-1.5" value={customTargetAudience} onChange={e => setCustomTargetAudience(e.target.value)} placeholder="Describe your target audience" />
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="form-label">Ad Objective</label>
                <select className="form-input" value={adObjective} onChange={e => setAdObjective(e.target.value as typeof AD_OBJECTIVES[number])}>
                  {AD_OBJECTIVES.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div>
                <label className="form-label">Ad Angle</label>
                <select className="form-input" value={adAngle} onChange={e => setAdAngle(e.target.value)}>
                  {AD_ANGLE_OPTIONS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="form-label">Tone <span className="text-gray-400 font-normal">— how it's said, separate from Ad Angle (what idea is used)</span></label>
              <select className="form-input" value={tone} onChange={e => setTone(e.target.value as typeof TONE_OPTIONS[number])}>
                {TONE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">Copy Length</label>
              <select className="form-input" value={copyLength} onChange={e => setCopyLength(e.target.value)}>
                {COPY_LENGTH_OPTIONS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
              </select>
            </div>
          </div>

          <div className="border-t border-gray-100 pt-4 space-y-3">
            <p className="text-sm font-semibold text-gray-700">Offer Information <span className="text-gray-400 font-normal text-xs">— only checked/filled items are used, AI will never invent an offer</span></p>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={offerCod} onChange={e => setOfferCod(e.target.checked)} /> Cash on Delivery</label>
              <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={offerFreeShipping} onChange={e => setOfferFreeShipping(e.target.checked)} /> Free Shipping</label>
              <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={offerNationwide} onChange={e => setOfferNationwide(e.target.checked)} /> Nationwide Delivery</label>
              <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={offerLimitedStock} onChange={e => setOfferLimitedStock(e.target.checked)} /> Limited Stock</label>
              <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={offerLimitedTime} onChange={e => setOfferLimitedTime(e.target.checked)} /> Limited-Time Sale</label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="form-label">Discount <span className="text-gray-400 font-normal">— optional</span></label>
                <div className="relative">
                  <input type="text" className="form-input" value={discountPercent} onChange={e => setDiscountPercent(e.target.value.replace(/[^0-9]/g, ''))} placeholder="e.g. 20" />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">% OFF</span>
                </div>
              </div>
              <div>
                <label className="form-label">Custom Offer <span className="text-gray-400 font-normal">— optional</span></label>
                <input type="text" className="form-input" value={customOffer} onChange={e => setCustomOffer(e.target.value)} placeholder="e.g. Buy 2 Take 1" />
              </div>
            </div>
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          <button onClick={analyzeAndGenerate} disabled={busy || !videoFile} className="btn-primary w-full text-base py-3 disabled:opacity-50 flex items-center justify-center gap-2">
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            {analyzing ? (stageText || 'Analyzing...') : generatingCopy ? 'Writing Facebook ad copy...' : 'ANALYZE VIDEO & GENERATE AD COPY'}
          </button>
        </div>

        {/* RIGHT: Output */}
        <div className="card space-y-6 lg:sticky lg:top-6">
          <p className="text-sm font-semibold text-gray-700">Generated Content</p>

          {busy ? (
            <div className="flex flex-col items-center gap-2 text-gray-400 py-12">
              <Loader2 size={28} className="animate-spin" />
              <p className="text-xs">{analyzing ? stageText : 'Writing Facebook ad copy...'}</p>
            </div>
          ) : result && analysis ? (
            <div className="space-y-6">
              {/* AI Video Analysis */}
              <div className="rounded-lg bg-gray-50 border border-gray-100 p-3 space-y-1.5">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-semibold text-gray-700">AI Video Analysis</p>
                  <span className="text-[10px] font-semibold text-gray-400 uppercase bg-gray-100 rounded-full px-2 py-0.5">{analysis.contentType}</span>
                </div>
                <p className="text-xs text-gray-600"><span className="text-gray-400">{(CONTENT_TYPE_LABELS[analysis.contentType] || CONTENT_TYPE_LABELS['SINGLE PRODUCT']).name}:</span> {analysis.productName}</p>
                {analysis.productCategory && <p className="text-xs text-gray-600"><span className="text-gray-400">{(CONTENT_TYPE_LABELS[analysis.contentType] || CONTENT_TYPE_LABELS['SINGLE PRODUCT']).category}:</span> {analysis.productCategory}</p>}
                {analysis.targetCustomer && <p className="text-xs text-gray-600"><span className="text-gray-400">Target Buyer:</span> {analysis.targetCustomer}</p>}
                {(analysis.mainBenefits[0] || analysis.visualHook) && <p className="text-xs text-gray-600"><span className="text-gray-400">Strongest Selling Point:</span> {analysis.mainBenefits[0] || analysis.visualHook}</p>}
                {analysis.financingInfo && <p className="text-xs text-gray-600"><span className="text-gray-400">Financing:</span> {analysis.financingInfo}</p>}
                {analysis.recommendedAngle && <p className="text-xs text-gray-600"><span className="text-gray-400">Recommended Ad Angle:</span> {analysis.recommendedAngle}</p>}
                {analysis.whyAngle && <p className="text-xs text-gray-600"><span className="text-gray-400">Why:</span> {analysis.whyAngle}</p>}
              </div>

              {/* Choose Your Hook — only affects versions[0] */}
              {result.hookOptions.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <SectionHeader icon={Sparkles} title="Choose Your Hook" subtitle="for the best ad copy" />
                    <button onClick={() => regenerateHook()} disabled={regeneratingHook || busy} className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5 disabled:opacity-50">
                      {regeneratingHook ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                      Generate 3 New Hooks
                    </button>
                  </div>
                  <div className="space-y-2">
                    {result.hookOptions.map((h, i) => {
                      const active = h.hook === result.versions[0]?.hook;
                      return (
                        <div key={i} className={`rounded-lg border-2 p-3 space-y-1.5 ${active ? 'border-orange-400 bg-orange-50/50' : 'border-gray-200'}`}>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[10px] font-semibold text-gray-400 uppercase">{h.angle}</span>
                            {h.isBestPick && <span className="text-[10px] font-bold text-white bg-orange-500 rounded-full px-2 py-0.5">AI BEST PICK</span>}
                            {active && <span className="text-[10px] font-semibold text-orange-600">● Active</span>}
                          </div>
                          <p className="text-sm font-bold text-gray-900">{h.hook}</p>
                          <button onClick={() => regenerateHook(h.hook, h.angle)} disabled={regeneratingHook || busy || active} className="btn-secondary text-xs py-1 px-2.5 disabled:opacity-50">
                            {active ? 'In Use' : 'Use This Hook'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Best Ad Copy — Version 1 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-orange-600">BEST AD COPY — {result.versions[0].angle}</p>
                  <CopyButton text={versionText(result.versions[0])} />
                </div>
                <div className="rounded-lg border-2 border-orange-200 bg-orange-50/40 p-3 space-y-2">
                  <p className="text-sm font-bold text-gray-900">{result.versions[0].hook}</p>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{result.versions[0].primaryText}</p>
                  <div className="pt-1 border-t border-orange-100 space-y-1">
                    <p className="text-xs text-gray-500"><span className="font-semibold text-gray-700">Headline:</span> {result.versions[0].headline}</p>
                    <p className="text-xs text-gray-500"><span className="font-semibold text-gray-700">Description:</span> {result.versions[0].description}</p>
                    <p className="text-xs font-semibold text-gray-900">👉 {result.versions[0].cta}</p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-1.5 pt-1">
                  <button onClick={() => rewrite('')} disabled={busy} className="btn-secondary text-xs py-1.5 px-2.5 flex items-center gap-1"><RefreshCw size={12} /> Regenerate</button>
                  <button onClick={() => rewrite('Make the copy much stronger and more assertive — a punchier hook, more persuasive throughout, while staying within the compliance and conversion rules.')} disabled={busy} className="btn-secondary text-xs py-1.5 px-2.5 flex items-center gap-1"><Flame size={12} /> Make Stronger</button>
                  <button onClick={() => rewrite('Make the primaryText significantly shorter and punchier — cut to the essential hook, one key benefit, and the CTA.')} disabled={busy} className="btn-secondary text-xs py-1.5 px-2.5 flex items-center gap-1"><Scissors size={12} /> Make Shorter</button>
                  <button onClick={() => rewrite('Re-select the strongest angle for this product given the current Ad Angle setting and regenerate all 3 versions around it.')} disabled={busy} className="btn-secondary text-xs py-1.5 px-2.5 flex items-center gap-1"><Wand2 size={12} /> Change Angle</button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button onClick={() => rewrite('Emphasize the offer and a clear sales-driven CTA more heavily; prioritize a Sales/Conversion objective.')} disabled={busy} className="btn-secondary text-xs py-1.5 px-2.5 flex items-center gap-1"><DollarSign size={12} /> More Sales Focused</button>
                  <button onClick={() => rewrite('Rewrite in a Premium tone — elegant, aspirational language, less hard-sell.')} disabled={busy} className="btn-secondary text-xs py-1.5 px-2.5 flex items-center gap-1"><Gem size={12} /> Make Premium</button>
                  <button onClick={() => rewrite('Rewrite using a Mommy/Family angle, speaking directly to parents.')} disabled={busy} className="btn-secondary text-xs py-1.5 px-2.5 flex items-center gap-1"><Users size={12} /> Mommy Angle</button>
                  <button onClick={() => rewrite('Increase the natural Taglish mix — make it sound even more like a real Filipino seller texting casually, less formal.')} disabled={busy} className="btn-secondary text-xs py-1.5 px-2.5 flex items-center gap-1">🇵🇭 More Taglish</button>
                </div>
              </div>

              {/* Version 2 & 3 — collapsible */}
              {([1, 2] as const).map(i => {
                const v = result.versions[i];
                if (!v) return null;
                const open = expanded[i as 1 | 2];
                return (
                  <div key={i} className="rounded-lg border border-gray-200">
                    <button onClick={() => setExpanded(prev => ({ ...prev, [i]: !prev[i as 1 | 2] }))} className="w-full flex items-center justify-between p-3 text-left">
                      <span className="text-xs font-semibold text-gray-700">Version {i + 1} — {v.angle}</span>
                      {open ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
                    </button>
                    {open && (
                      <div className="px-3 pb-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-bold text-gray-900">{v.hook}</p>
                          <CopyButton text={versionText(v)} />
                        </div>
                        <p className="text-sm text-gray-700 whitespace-pre-wrap">{v.primaryText}</p>
                        <p className="text-xs text-gray-500"><span className="font-semibold text-gray-700">Headline:</span> {v.headline}</p>
                        <p className="text-xs text-gray-500"><span className="font-semibold text-gray-700">Description:</span> {v.description}</p>
                        <p className="text-xs font-semibold text-gray-900">👉 {v.cta}</p>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* 10 Extra Hooks */}
              {result.extraHooks.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-gray-700">10 Extra Hooks</p>
                  <div className="space-y-1.5">
                    {result.extraHooks.map((h, i) => (
                      <div key={i} className="flex items-start gap-2 rounded-lg bg-gray-50 border border-gray-100 p-2.5">
                        <span className="text-[10px] font-semibold text-orange-500 uppercase mt-0.5 w-14 shrink-0">{h.category}</span>
                        <p className="text-sm text-gray-700 flex-1">{h.hook}</p>
                        <CopyButton text={h.hook} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 text-gray-300 py-12">
              <Video size={32} />
              <p className="text-xs text-gray-400">Upload a product video to generate ad copy</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
