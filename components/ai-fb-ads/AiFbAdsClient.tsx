'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, Sparkles, Upload, ImageIcon, RefreshCw, Download } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { Toast, useToast } from '@/components/ui/Toast';

const CREATIVE_STYLES = [
  { key: 'auto', label: 'Auto', description: 'Best-fit style for this offer.' },
  { key: 'premium', label: 'Premium Product', description: 'Elegant, clean, minimal luxury.' },
  { key: 'feature_heavy', label: 'Feature Heavy', description: 'Icons, benefit sections, infographic.' },
  { key: 'promo', label: 'Promo / Discount', description: 'Big offer, price prominent.' },
  { key: 'lifestyle', label: 'Lifestyle', description: 'Product in real usage setting.' },
] as const;
type StyleKey = typeof CREATIVE_STYLES[number]['key'];

const CTA_OPTIONS = ['Shop Now', 'Order Now', 'Buy Now', 'Get Yours Now', 'Learn More'];
const OFFER_SUGGESTIONS = ['BUY 1 TAKE 1', 'FREE SHIPPING', 'COD AVAILABLE', 'LIMITED TIME OFFER'];

const PROMPT_MODES = [
  { key: 'auto', label: 'Auto', description: 'Uses the hidden master prompt + your Creative Style. No extra input needed.' },
  { key: 'preset', label: 'Preset', description: 'Pick a named creative direction below.' },
  { key: 'custom', label: 'Custom', description: 'Add your own extra instructions.' },
] as const;
type PromptModeKey = typeof PROMPT_MODES[number]['key'];

const PRESETS = [
  { key: 'premium', label: 'Premium Product', description: 'Elegant, luxury-inspired, refined lighting.' },
  { key: 'feature_heavy', label: 'Feature Heavy Ecommerce', description: 'Large hero product, benefit/icon areas.' },
  { key: 'promo', label: 'Promo / Discount', description: 'Scroll-stopping, offer-led, urgent.' },
  { key: 'lifestyle', label: 'Lifestyle', description: 'Aspirational real-world setting.' },
  { key: 'minimal_clean', label: 'Minimal Clean', description: 'Strong spacing, soft background, elegant.' },
  { key: 'high_converting', label: 'High-Converting FB Ad', description: 'Strong hook, persuasive hierarchy.' },
] as const;
type PresetKey = typeof PRESETS[number]['key'];

const NAVY = '#0B1F3A';
const ROYAL = '#2554C7';

interface Product { id: number; sku: string; name: string; srp: number | null; }

/** Resize to max 1200px + compress to JPEG — used for the uploaded product photo before sending. */
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

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = w; }
    else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

interface OverlayInput {
  productName: string;
  sellingPrice: string;
  oldPrice: string;
  discountPercent: number | null;
  offer: string;
  headline: string;
  benefits: string[];
  cta: string;
  style: StyleKey;
}

/** Draws the background (cover-fit) plus the real text layer on top — this is the whole point of the V1.1 rework: the AI image never carries text, this function does. */
async function compositeCreative(backgroundDataUrl: string, format: '4:5' | '1:1', input: OverlayInput): Promise<string> {
  const W = 1080, H = format === '1:1' ? 1080 : 1350;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  const bg = await loadImage(backgroundDataUrl);
  const scale = Math.max(W / bg.width, H / bg.height);
  const dw = bg.width * scale, dh = bg.height * scale;
  ctx.drawImage(bg, (W - dw) / 2, (H - dh) / 2, dw, dh);

  const priceText = input.sellingPrice ? formatCurrency(Number(input.sellingPrice)) : '';
  const oldPriceText = input.oldPrice ? formatCurrency(Number(input.oldPrice)) : '';
  const discountText = input.discountPercent ? `${input.discountPercent}% OFF` : '';

  ctx.textBaseline = 'middle';

  const drawHeadline = (bandY: number, bandH: number, color: string) => {
    if (!input.headline) return;
    ctx.fillStyle = color;
    ctx.font = '700 52px -apple-system, Segoe UI, Roboto, Arial';
    ctx.textAlign = 'center';
    const lines = wrapText(ctx, input.headline.toUpperCase(), W - 120);
    const lineH = 58;
    const startY = bandY + bandH / 2 - ((lines.length - 1) * lineH) / 2;
    lines.slice(0, 2).forEach((l, i) => ctx.fillText(l, W / 2, startY + i * lineH));
  };

  const drawCtaButton = (cx: number, cy: number) => {
    ctx.font = '700 36px -apple-system, Segoe UI, Roboto, Arial';
    const label = input.cta.toUpperCase();
    const tw = ctx.measureText(label).width;
    const bw = tw + 90, bh = 78;
    roundRect(ctx, cx - bw / 2, cy - bh / 2, bw, bh, bh / 2);
    ctx.fillStyle = ROYAL;
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.fillText(label, cx, cy + 2);
  };

  if (input.style === 'feature_heavy') {
    // Top band: headline
    const topH = 170;
    const grad = ctx.createLinearGradient(0, 0, 0, topH);
    grad.addColorStop(0, 'rgba(11,31,58,0.92)');
    grad.addColorStop(1, 'rgba(11,31,58,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, topH);
    drawHeadline(0, topH, '#fff');

    // Left column: benefit chips
    const chips = input.benefits.slice(0, 5);
    if (chips.length) {
      const chipW = 300, chipH = 70, gap = 18, startY = topH + 40;
      chips.forEach((b, i) => {
        const y = startY + i * (chipH + gap);
        roundRect(ctx, 40, y, chipW, chipH, 16);
        ctx.fillStyle = 'rgba(255,255,255,0.94)';
        ctx.fill();
        ctx.fillStyle = ROYAL;
        ctx.beginPath();
        ctx.arc(40 + 36, y + chipH / 2, 14, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = '700 18px -apple-system, Segoe UI, Roboto, Arial';
        ctx.textAlign = 'center';
        ctx.fillText('✓', 40 + 36, y + chipH / 2 + 1);
        ctx.fillStyle = NAVY;
        ctx.font = '600 20px -apple-system, Segoe UI, Roboto, Arial';
        ctx.textAlign = 'left';
        const lines = wrapText(ctx, b, chipW - 80);
        lines.slice(0, 2).forEach((l, li) => ctx.fillText(l, 40 + 66, y + chipH / 2 + (li === 0 && lines.length > 1 ? -12 : 6)));
      });
    }

    drawBottomStrip();
  } else if (input.style === 'promo') {
    const topH = input.headline ? 150 : 0;
    if (topH) {
      ctx.fillStyle = NAVY;
      ctx.fillRect(0, 0, W, topH);
      drawHeadline(0, topH, '#fff');
    }
    drawBottomStrip(true);
  } else {
    // premium / lifestyle / auto — minimal
    if (input.headline) {
      const topH = 140;
      const grad = ctx.createLinearGradient(0, 0, 0, topH);
      grad.addColorStop(0, 'rgba(11,31,58,0.85)');
      grad.addColorStop(1, 'rgba(11,31,58,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, topH);
      drawHeadline(0, topH, '#fff');
    }
    drawBottomStrip();
  }

  function drawBottomStrip(big = false) {
    if (!priceText && !input.cta) return;
    const stripH = big ? 300 : 240;
    ctx.fillStyle = NAVY;
    ctx.fillRect(0, H - stripH, W, stripH);

    let y = H - stripH + (big ? 70 : 60);

    if (discountText) {
      ctx.font = '700 30px -apple-system, Segoe UI, Roboto, Arial';
      const tw = ctx.measureText(discountText).width;
      roundRect(ctx, W / 2 - tw / 2 - 24, y - 26, tw + 48, 52, 26);
      ctx.fillStyle = ROYAL;
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.fillText(discountText, W / 2, y + 1);
      y += 70;
    }

    if (priceText) {
      ctx.textAlign = 'center';
      ctx.font = `700 ${big ? 72 : 60}px -apple-system, Segoe UI, Roboto, Arial`;
      ctx.fillStyle = '#fff';
      if (oldPriceText) {
        const priceW = ctx.measureText(priceText).width;
        ctx.font = '400 34px -apple-system, Segoe UI, Roboto, Arial';
        const oldW = ctx.measureText(oldPriceText).width;
        const totalW = priceW + 24 + oldW;
        const startX = W / 2 - totalW / 2;
        ctx.font = `700 ${big ? 72 : 60}px -apple-system, Segoe UI, Roboto, Arial`;
        ctx.textAlign = 'left';
        ctx.fillText(priceText, startX, y);
        ctx.font = '400 34px -apple-system, Segoe UI, Roboto, Arial';
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        const oldX = startX + priceW + 24;
        ctx.fillText(oldPriceText, oldX, y);
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(oldX, y); ctx.lineTo(oldX + oldW, y); ctx.stroke();
      } else {
        ctx.fillText(priceText, W / 2, y);
      }
      y += big ? 80 : 66;
    }

    if (input.offer) {
      ctx.font = '600 22px -apple-system, Segoe UI, Roboto, Arial';
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.textAlign = 'center';
      ctx.fillText(input.offer.toUpperCase(), W / 2, y);
      y += 44;
    }

    if (input.cta) drawCtaButton(W / 2, y + 20);
  }

  // Product name label, small, top-left corner (kept minimal — the physical
  // product itself is the primary visual, per the prompt's "hero" direction).
  if (input.productName) {
    ctx.font = '600 22px -apple-system, Segoe UI, Roboto, Arial';
    ctx.fillStyle = 'rgba(11,31,58,0.55)';
    ctx.textAlign = 'left';
    ctx.fillText(input.productName.toUpperCase(), 28, 34);
  }

  return canvas.toDataURL('image/png');
}

export default function AiFbAdsClient() {
  const { toast, showToast, clearToast } = useToast();

  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<number | ''>('');

  const [productName, setProductName] = useState('');
  const [sellingPrice, setSellingPrice] = useState('');
  const [oldPrice, setOldPrice] = useState('');
  const [offer, setOffer] = useState('');
  const [benefits, setBenefits] = useState(['', '', '', '', '']);
  const [headline, setHeadline] = useState('');
  const [cta, setCta] = useState('Shop Now');
  const [creativeStyle, setCreativeStyle] = useState<StyleKey>('auto');
  const [format, setFormat] = useState<'4:5' | '1:1'>('4:5');
  const [promptMode, setPromptMode] = useState<PromptModeKey>('auto');
  const [presetKey, setPresetKey] = useState<PresetKey>('premium');
  const [customPrompt, setCustomPrompt] = useState('');

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/products').then(r => r.json()).then(d => setProducts(Array.isArray(d) ? d : []));
  }, []);

  const discountPercent = (() => {
    const sp = Number(sellingPrice), op = Number(oldPrice);
    if (!sp || !op || op <= sp) return null;
    return Math.round((1 - sp / op) * 100);
  })();

  const selectProduct = (id: string) => {
    if (!id) { setSelectedProductId(''); return; }
    const p = products.find(pr => pr.id === Number(id));
    if (!p) return;
    setSelectedProductId(p.id);
    setProductName(p.name);
    setSellingPrice(p.srp ? String(p.srp) : '');
    showToast('Product selected. This product has no saved image yet — please upload one below.', 'success');
  };

  const onFileChange = (file: File | null) => {
    setImageFile(file);
    if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    setImagePreviewUrl(file ? URL.createObjectURL(file) : null);
  };

  const setBenefit = (i: number, value: string) => setBenefits(b => b.map((v, idx) => idx === i ? value : v));

  const generate = async () => {
    setError('');
    if (!productName.trim()) { setError('Product name is required.'); return; }
    if (!imageFile) { setError('Product image is required.'); return; }

    setGenerating(true);
    try {
      const { base64, mediaType } = await compressToBase64(imageFile);

      const genRes = await fetch('/api/ai-fb-ads/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_name: productName.trim(),
          creative_style: creativeStyle,
          format,
          reference_image_base64: base64,
          reference_image_media_type: mediaType,
          prompt_mode: promptMode,
          preset_key: promptMode === 'preset' ? presetKey : undefined,
          custom_prompt: promptMode === 'custom' ? customPrompt : undefined,
        }),
      });
      const genData = await genRes.json();
      if (!genRes.ok) { setError(genData.error || 'Image generation failed. Please try again.'); return; }

      const backgroundDataUrl = `data:${genData.background_media_type};base64,${genData.background_base64}`;
      const finalDataUrl = await compositeCreative(backgroundDataUrl, format, {
        productName: productName.trim(),
        sellingPrice, oldPrice, discountPercent,
        offer, headline, benefits: benefits.filter(Boolean), cta, style: creativeStyle,
      });

      const saveRes = await fetch('/api/ai-fb-ads/save', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: selectedProductId || null,
          product_name: productName.trim(),
          selling_price: sellingPrice || undefined,
          old_price: oldPrice || undefined,
          offer: offer || undefined,
          headline: headline || undefined,
          benefits: benefits.filter(Boolean),
          cta,
          creative_style: creativeStyle,
          format,
          reference_image_base64: base64,
          reference_image_media_type: mediaType,
          final_image_base64: finalDataUrl.split(',')[1],
          final_image_media_type: 'image/png',
        }),
      });
      const saveData = await saveRes.json();
      if (!saveRes.ok) { setError(saveData.error || 'Failed to save the creative.'); return; }

      setGeneratedImageUrl(saveData.image_path);
      showToast('Creative generated!');
    } catch (e: any) {
      setError('Image generation failed. Please try again.');
    } finally {
      setGenerating(false);
    }
  };

  const generateAnother = () => {
    setGeneratedImageUrl(null);
    setError('');
  };

  return (
    <div className="p-6 space-y-6">
      {toast && <Toast message={toast.message} type={toast.type} onClose={clearToast} />}

      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Sparkles size={22} className="text-orange-500" /> AI FB Ads Generator</h1>
        <p className="text-sm text-gray-500 mt-1">Generate ready-to-use Facebook ad creatives from your product images.</p>
      </div>

      <div className="grid lg:grid-cols-2 gap-6 items-start">
        {/* LEFT: Creative Settings */}
        <div className="card space-y-5">
          <p className="text-sm font-semibold text-gray-700">Creative Settings</p>

          <div>
            <label className="form-label">Select Existing Product</label>
            <select className="form-input" value={selectedProductId} onChange={e => selectProduct(e.target.value)}>
              <option value="">— Choose a product (optional) —</option>
              {products.map(p => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}
            </select>
          </div>

          <div>
            <label className="form-label">Product Image</label>
            {imagePreviewUrl ? (
              <div className="relative">
                <img src={imagePreviewUrl} alt="Product" className="w-full h-40 object-contain bg-gray-50 rounded-lg border border-gray-200" />
                <button onClick={() => onFileChange(null)} className="absolute top-2 right-2 btn-secondary text-xs py-1 px-2 bg-white">Remove</button>
              </div>
            ) : (
              <button onClick={() => fileInputRef.current?.click()} className="w-full h-32 border-2 border-dashed border-gray-200 rounded-lg flex flex-col items-center justify-center gap-1.5 text-gray-400 hover:border-orange-300 hover:text-orange-500 transition-colors">
                <Upload size={20} />
                <span className="text-xs font-medium">Upload Product Image</span>
              </button>
            )}
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={e => onFileChange(e.target.files?.[0] || null)} />
          </div>

          <div>
            <label className="form-label">Product Name</label>
            <input type="text" className="form-input" value={productName} onChange={e => setProductName(e.target.value)} placeholder="e.g. Blackout Curtain Panel" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">Selling Price (₱) <span className="text-gray-400 font-normal">— optional</span></label>
              <input type="number" className="form-input" value={sellingPrice} onChange={e => setSellingPrice(e.target.value)} placeholder="499" />
            </div>
            <div>
              <label className="form-label">Old Price (₱) <span className="text-gray-400 font-normal">— optional</span></label>
              <input type="number" className="form-input" value={oldPrice} onChange={e => setOldPrice(e.target.value)} placeholder="999" />
            </div>
          </div>
          {discountPercent !== null && (
            <p className="text-xs text-orange-600 -mt-3">Auto-calculated discount: <b>{discountPercent}% OFF</b> (not typed — computed from the two prices above)</p>
          )}

          <div>
            <label className="form-label">Offer / Promo <span className="text-gray-400 font-normal">— optional, non-price offers</span></label>
            <input type="text" className="form-input" value={offer} onChange={e => setOffer(e.target.value)} placeholder="e.g. BUY 1 TAKE 1" list="offer-suggestions" />
            <datalist id="offer-suggestions">{OFFER_SUGGESTIONS.map(o => <option key={o} value={o} />)}</datalist>
          </div>

          <div>
            <label className="form-label">Key Benefits <span className="text-gray-400 font-normal">— up to 5</span></label>
            <div className="space-y-1.5">
              {benefits.map((b, i) => (
                <input key={i} type="text" className="form-input" value={b} onChange={e => setBenefit(i, e.target.value)} placeholder={`Benefit ${i + 1}`} />
              ))}
            </div>
          </div>

          <div>
            <label className="form-label">Headline <span className="text-gray-400 font-normal">— optional</span></label>
            <input type="text" className="form-input" value={headline} onChange={e => setHeadline(e.target.value)} placeholder="e.g. Stay Cool. Sleep Better." />
          </div>

          <div>
            <label className="form-label">CTA</label>
            <select className="form-input" value={cta} onChange={e => setCta(e.target.value)}>
              {CTA_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div>
            <label className="form-label">Creative Style {promptMode === 'preset' && <span className="text-gray-400 font-normal">— not used while Prompt Mode is Preset</span>}</label>
            <div className={`grid grid-cols-2 sm:grid-cols-3 gap-2 ${promptMode === 'preset' ? 'opacity-40 pointer-events-none' : ''}`}>
              {CREATIVE_STYLES.map(s => (
                <button
                  key={s.key}
                  onClick={() => setCreativeStyle(s.key)}
                  className={`text-left rounded-lg border-2 p-2.5 transition-colors ${creativeStyle === s.key ? 'border-orange-500 bg-orange-50' : 'border-gray-200 hover:border-gray-300'}`}
                >
                  <p className="text-xs font-semibold text-gray-900">{s.label}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">{s.description}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Prompt Mode — Layer 2/3 of the 3-layer prompt system (Layer 1,
              the master prompt, is hidden and always applied). Auto reuses
              Creative Style above; Preset overrides it with a named
              direction; Custom keeps Creative Style AND appends free text. */}
          <div className="border-t border-gray-100 pt-4">
            <label className="form-label">Prompt Mode</label>
            <div className="grid grid-cols-3 gap-2 mb-3">
              {PROMPT_MODES.map(m => (
                <button
                  key={m.key}
                  onClick={() => setPromptMode(m.key)}
                  className={`text-left rounded-lg border-2 p-2.5 transition-colors ${promptMode === m.key ? 'border-orange-500 bg-orange-50' : 'border-gray-200 hover:border-gray-300'}`}
                >
                  <p className="text-xs font-semibold text-gray-900">{m.label}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">{m.description}</p>
                </button>
              ))}
            </div>

            {promptMode === 'preset' && (
              <div className="grid grid-cols-2 gap-2">
                {PRESETS.map(p => (
                  <button
                    key={p.key}
                    onClick={() => setPresetKey(p.key)}
                    className={`text-left rounded-lg border-2 p-2.5 transition-colors ${presetKey === p.key ? 'border-orange-500 bg-orange-50' : 'border-gray-200 hover:border-gray-300'}`}
                  >
                    <p className="text-xs font-semibold text-gray-900">{p.label}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">{p.description}</p>
                  </button>
                ))}
              </div>
            )}

            {promptMode === 'custom' && (
              <div>
                <label className="form-label">Custom Prompt <span className="text-gray-400 font-normal">— optional</span></label>
                <textarea
                  className="form-input min-h-[90px]"
                  value={customPrompt}
                  onChange={e => setCustomPrompt(e.target.value)}
                  placeholder="e.g. use blue and white theme, make it more premium, use modern home background, add stylish model if appropriate, focus on mothers/homeowners, make it elegant and scroll-stopping"
                />
                <p className="text-xs text-gray-400 mt-1">Still uses the master prompt + your Creative Style above — this text is added on top. Leave blank to let the generator add its own premium-styling hook automatically.</p>
              </div>
            )}
          </div>

          <div>
            <label className="form-label">Output Format</label>
            <div className="flex gap-2">
              <button onClick={() => setFormat('4:5')} className={`flex-1 rounded-lg border-2 py-2.5 text-sm font-medium transition-colors ${format === '4:5' ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                Feed 4:5 <span className="text-xs text-gray-400">(1080x1350)</span>
              </button>
              <button onClick={() => setFormat('1:1')} className={`flex-1 rounded-lg border-2 py-2.5 text-sm font-medium transition-colors ${format === '1:1' ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                Square 1:1 <span className="text-xs text-gray-400">(1080x1080)</span>
              </button>
            </div>
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          <button onClick={generate} disabled={generating} className="btn-primary w-full text-base py-3 disabled:opacity-50 flex items-center justify-center gap-2">
            {generating ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            {generating ? 'Generating...' : 'GENERATE FB AD'}
          </button>
        </div>

        {/* RIGHT: Preview */}
        <div className="card space-y-4 lg:sticky lg:top-6">
          <p className="text-sm font-semibold text-gray-700">Generated Creative Preview</p>

          <div className={`bg-gray-50 rounded-lg border border-gray-200 flex items-center justify-center overflow-hidden ${format === '1:1' ? 'aspect-square' : 'aspect-[4/5]'}`}>
            {generating ? (
              <div className="flex flex-col items-center gap-2 text-gray-400">
                <Loader2 size={28} className="animate-spin" />
                <p className="text-xs">Generating background, then adding your text...</p>
              </div>
            ) : generatedImageUrl ? (
              <img src={generatedImageUrl} alt="Generated creative" className="w-full h-full object-contain" />
            ) : (
              <div className="flex flex-col items-center gap-2 text-gray-300">
                <ImageIcon size={32} />
                <p className="text-xs text-gray-400">Your generated ad will appear here</p>
              </div>
            )}
          </div>

          {generatedImageUrl && !generating && (
            <div className="flex flex-wrap gap-2">
              <button onClick={generate} className="btn-secondary text-sm py-2 px-4 flex items-center gap-1.5"><RefreshCw size={14} /> Regenerate</button>
              <a href={generatedImageUrl} download={`${productName || 'ad-creative'}.png`} className="btn-secondary text-sm py-2 px-4 flex items-center gap-1.5"><Download size={14} /> Save Image</a>
              <button onClick={generateAnother} className="btn-secondary text-sm py-2 px-4">Generate Another</button>
            </div>
          )}

          {(sellingPrice || productName) && (
            <div className="text-xs text-gray-400 border-t border-gray-100 pt-3">
              {productName && <p className="font-medium text-gray-600">{productName}</p>}
              {sellingPrice && (
                <p>{formatCurrency(Number(sellingPrice))} {oldPrice && <span className="line-through ml-1">{formatCurrency(Number(oldPrice))}</span>} {discountPercent !== null && <span className="ml-1 text-orange-600">({discountPercent}% OFF)</span>}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
