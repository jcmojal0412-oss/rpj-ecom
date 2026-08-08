'use client';

import { useEffect, useRef, useState } from 'react';
import { Camera, RotateCcw, Check, Loader2, AlertCircle } from 'lucide-react';

type Phase = 'starting' | 'live' | 'denied' | 'preview' | 'uploading';

export default function SelfieCaptureModal({
  onClose,
  onCaptured,
  uploadUrl,
  extraFields,
}: {
  onClose: () => void;
  onCaptured: (photoPath: string) => void;
  uploadUrl: string;
  extraFields?: Record<string, string>;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [phase, setPhase] = useState<Phase>('starting');
  const [error, setError] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);

  const startCamera = async () => {
    setPhase('starting');
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setPhase('live');
    } catch (err: any) {
      const msg = err?.name === 'NotAllowedError'
        ? 'Camera access was denied. Please allow camera permission and try again.'
        : err?.name === 'NotFoundError'
        ? 'No camera was found on this device.'
        : 'Could not access the camera. Please try again.';
      setError(msg);
      setPhase('denied');
    }
  };

  useEffect(() => {
    startCamera();
    return () => {
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopStream = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  };

  const capture = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(blob => {
      if (!blob) return;
      setCapturedBlob(blob);
      setPreviewUrl(URL.createObjectURL(blob));
      stopStream();
      setPhase('preview');
    }, 'image/jpeg', 0.85);
  };

  const retake = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setCapturedBlob(null);
    startCamera();
  };

  const confirm = async () => {
    if (!capturedBlob) return;
    setPhase('uploading');
    setError('');
    try {
      const fd = new FormData();
      fd.append('file', new File([capturedBlob], 'selfie.jpg', { type: 'image/jpeg' }));
      if (extraFields) for (const [k, v] of Object.entries(extraFields)) fd.append(k, v);
      const res = await fetch(uploadUrl, { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      onCaptured(data.path);
    } catch (err: any) {
      setError(err.message || 'Upload failed. Please try again.');
      setPhase('preview');
    }
  };

  const handleClose = () => {
    stopStream();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    onClose();
  };

  return (
    <div className="space-y-3">
      <canvas ref={canvasRef} className="hidden" />

      {/* Capped to a viewport-relative height (not a fixed aspect ratio) so
          the buttons below always stay visible without scrolling, even on
          short phone screens. */}
      {(phase === 'starting' || phase === 'live') && (
        <div className="relative rounded-xl overflow-hidden bg-gray-900 h-[40vh] max-h-[380px] min-h-[220px]">
          <video ref={videoRef} className="w-full h-full object-cover -scale-x-100" playsInline muted />
          {phase === 'starting' && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="animate-spin text-white" size={28} />
            </div>
          )}
        </div>
      )}

      {phase === 'denied' && (
        <div className="rounded-xl bg-red-50 border border-red-100 p-6 text-center space-y-3">
          <AlertCircle className="mx-auto text-red-400" size={28} />
          <p className="text-sm text-red-600">{error}</p>
          <button onClick={startCamera} className="btn-secondary mx-auto">
            <RotateCcw size={14} /> Try Again
          </button>
        </div>
      )}

      {(phase === 'preview' || phase === 'uploading') && previewUrl && (
        <div className="relative rounded-xl overflow-hidden bg-gray-900 h-[40vh] max-h-[380px] min-h-[220px]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewUrl} alt="Captured selfie" className="w-full h-full object-cover -scale-x-100" />
        </div>
      )}

      {error && phase === 'preview' && (
        <p className="text-xs text-red-500 text-center">{error}</p>
      )}

      <div className="flex gap-2">
        {phase === 'live' && (
          <button onClick={capture} className="btn-primary w-full justify-center">
            <Camera size={16} /> Capture
          </button>
        )}
        {(phase === 'preview' || phase === 'uploading') && (
          <>
            <button onClick={retake} disabled={phase === 'uploading'} className="btn-secondary flex-1 justify-center disabled:opacity-50">
              <RotateCcw size={14} /> Retake
            </button>
            <button onClick={confirm} disabled={phase === 'uploading'} className="btn-primary flex-1 justify-center disabled:opacity-50">
              {phase === 'uploading' ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              {phase === 'uploading' ? 'Uploading...' : 'Confirm'}
            </button>
          </>
        )}
      </div>

      <button onClick={handleClose} className="btn-secondary w-full justify-center">Cancel</button>
    </div>
  );
}
