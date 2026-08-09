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

const CTA_OPTIONS = ['Shop Now', 'Order Now', 'Buy Now', 'Get Yours Now', 'Learn More'];
const OFFER_SUGGESTIONS = ['50% OFF', 'BUY 1 TAKE 1', 'FREE SHIPPING', 'COD AVAILABLE', 'LIMITED TIME OFFER'];

interface Product { id: number; sku: string; name: string; srp: number | null; }

/** Resize to max 1200px + compress to JPEG, matching the pattern used elsewhere in the app for image uploads. */
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
  const [autoHeadline, setAutoHeadline] = useState(true);
  const [cta, setCta] = useState('Shop Now');
  const [creativeStyle, setCreativeStyle] = useState<typeof CREATIVE_STYLES[number]['key']>('auto');
  const [format, setFormat] = useState<'4:5' | '1:1'>('4:5');

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/products').then(r => r.json()).then(d => setProducts(Array.isArray(d) ? d : []));
  }, []);

  const selectProduct = (id: string) => {
    if (!id) { setSelectedProductId(''); return; }
    const p = products.find(pr => pr.id === Number(id));
    if (!p) return;
    setSelectedProductId(p.id);
    setProductName(p.name);
    setSellingPrice(p.srp ? String(p.srp) : '');
    // Products don't have a stored image/description yet — still require a manual upload.
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
    if (!sellingPrice.trim()) { setError('Selling price is required.'); return; }
    if (!imageFile) { setError('Product image is required.'); return; }

    setGenerating(true);
    try {
      const { base64, mediaType } = await compressToBase64(imageFile);
      const res = await fetch('/api/ai-fb-ads/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: selectedProductId || null,
          product_name: productName.trim(),
          selling_price: sellingPrice,
          old_price: oldPrice || undefined,
          offer: offer || undefined,
          headline: autoHeadline ? undefined : (headline || undefined),
          benefits: benefits.filter(Boolean),
          cta,
          creative_style: creativeStyle,
          format,
          reference_image_base64: base64,
          reference_image_media_type: mediaType,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Image generation failed. Please try again.'); return; }
      setGeneratedImageUrl(data.image_path);
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
              <label className="form-label">Selling Price (₱)</label>
              <input type="number" className="form-input" value={sellingPrice} onChange={e => setSellingPrice(e.target.value)} placeholder="499" />
            </div>
            <div>
              <label className="form-label">Old Price (₱) <span className="text-gray-400 font-normal">— optional</span></label>
              <input type="number" className="form-input" value={oldPrice} onChange={e => setOldPrice(e.target.value)} placeholder="999" />
            </div>
          </div>

          <div>
            <label className="form-label">Offer / Promo <span className="text-gray-400 font-normal">— optional</span></label>
            <input type="text" className="form-input" value={offer} onChange={e => setOffer(e.target.value)} placeholder="e.g. 50% OFF" list="offer-suggestions" />
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
            <label className="form-label">Headline</label>
            <div className="flex items-center gap-2 mb-1.5">
              <label className="flex items-center gap-1.5 text-xs text-gray-600">
                <input type="checkbox" checked={autoHeadline} onChange={e => setAutoHeadline(e.target.checked)} />
                Auto Generate
              </label>
            </div>
            {!autoHeadline && (
              <input type="text" className="form-input" value={headline} onChange={e => setHeadline(e.target.value)} placeholder="e.g. Stay Cool. Sleep Better." />
            )}
          </div>

          <div>
            <label className="form-label">CTA</label>
            <select className="form-input" value={cta} onChange={e => setCta(e.target.value)}>
              {CTA_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div>
            <label className="form-label">Creative Style</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
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
                <p className="text-xs">Generating your creative...</p>
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
                <p>{formatCurrency(Number(sellingPrice))} {oldPrice && <span className="line-through ml-1">{formatCurrency(Number(oldPrice))}</span>}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
