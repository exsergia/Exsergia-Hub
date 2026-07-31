import { ChangeEvent, useEffect, useRef, useState } from 'react';
import { X, AlertCircle, CheckCircle2 } from 'lucide-react';

// Câmera in-browser (getUserMedia). Abre a câmera direto no app sem sair dele,
// evitando o reload causado por capture="environment" no Android Chrome.
// Componente compartilhado por Ferramentas, Frota e Materiais.
type CameraCaptureProps = {
  onCapture: (file: File) => void;
  onClose: () => void;
  quality?: number;
  idealWidth?: number;
  idealHeight?: number;
  documentMode?: boolean;
};

export function CameraCapture({
  onCapture,
  onClose,
  quality = 0.9,
  idealWidth = 1920,
  idealHeight = 1080,
  documentMode = false,
}: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mountedRef = useRef(true);
  const [ready, setReady] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [focusMessage, setFocusMessage] = useState<string | null>(null);
  const [captured, setCaptured] = useState<string | null>(null);
  const [capturedFile, setCapturedFile] = useState<File | null>(null);
  const [stabilizing, setStabilizing] = useState(false);

  const sleep = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms));

  const findRearCameraDeviceId = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const rear = devices.find(device => {
        if (device.kind !== 'videoinput') return false;
        return /back|rear|environment|traseira|camera 0/i.test(device.label || '');
      });
      return rear?.deviceId;
    } catch {
      return undefined;
    }
  };

  const waitForVideo = async (video: HTMLVideoElement) => {
    if (video.videoWidth > 0 && video.videoHeight > 0) return;
    await new Promise<void>(resolve => {
      const done = () => {
        video.removeEventListener('loadedmetadata', done);
        video.removeEventListener('canplay', done);
        resolve();
      };
      video.addEventListener('loadedmetadata', done, { once: true });
      video.addEventListener('canplay', done, { once: true });
      window.setTimeout(done, 1200);
    });
  };

  const buildVideoConstraints = (deviceId?: string, strictEnvironment = false): MediaTrackConstraints => {
    const constraints: MediaTrackConstraints & { resizeMode?: string } = {
      ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: strictEnvironment ? { exact: 'environment' } : { ideal: 'environment' } }),
      width: { ideal: idealWidth },
      height: { ideal: idealHeight },
      aspectRatio: documentMode ? { ideal: idealWidth / idealHeight } : undefined,
      frameRate: { ideal: 30, max: 30 },
      resizeMode: 'none',
    };
    return constraints;
  };

  const applyFocus = async (stream: MediaStream, point?: { x: number; y: number }) => {
    const track = stream.getVideoTracks()[0];
    if (!track?.applyConstraints) return false;

    const capabilities = (track.getCapabilities?.() || {}) as any;
    const advanced: Record<string, unknown>[] = [];

    if (Array.isArray(capabilities.focusMode)) {
      if (capabilities.focusMode.includes('continuous')) advanced.push({ focusMode: 'continuous' });
      else if (capabilities.focusMode.includes('single-shot')) advanced.push({ focusMode: 'single-shot' });
      else if (capabilities.focusMode.includes('auto')) advanced.push({ focusMode: 'auto' });
    }

    if (documentMode && Array.isArray(capabilities.exposureMode) && capabilities.exposureMode.includes('continuous')) {
      advanced.push({ exposureMode: 'continuous' });
    }

    if (documentMode && Array.isArray(capabilities.whiteBalanceMode) && capabilities.whiteBalanceMode.includes('continuous')) {
      advanced.push({ whiteBalanceMode: 'continuous' });
    }

    if (documentMode && Array.isArray(capabilities.torch) && capabilities.torch.includes(false)) {
      advanced.push({ torch: false });
    }

    if (documentMode && typeof capabilities.zoom?.min === 'number' && typeof capabilities.zoom?.max === 'number') {
      const minZoom = capabilities.zoom.min;
      const maxZoom = capabilities.zoom.max;
      const documentZoom = Math.min(maxZoom, Math.max(minZoom, 1.15));
      if (documentZoom > minZoom) advanced.push({ zoom: documentZoom });
    }

    if (point && 'pointsOfInterest' in capabilities) {
      advanced.push({ pointsOfInterest: [point] });
    }

    if (advanced.length === 0) return false;

    try {
      await track.applyConstraints({ advanced } as MediaTrackConstraints);
      return true;
    } catch {
      return false;
    }
  };

  const stopStream = () => {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }
  };

  const startCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamError('getUserMedia indisponivel');
      return;
    }

    stopStream();
    setReady(false);
    setStabilizing(false);
    setCamError(null);

    try {
      const rearDeviceId = await findRearCameraDeviceId();
      const videoAttempts: MediaTrackConstraints[] = [
        buildVideoConstraints(rearDeviceId),
        buildVideoConstraints(undefined, true),
        buildVideoConstraints(),
        {
          facingMode: { ideal: 'environment' },
          width: { ideal: Math.min(idealWidth, 1920) },
          height: { ideal: Math.min(idealHeight, 1080) },
          frameRate: { ideal: 24, max: 30 },
        },
      ];

      let stream: MediaStream | null = null;
      let lastError: unknown = null;

      for (const video of videoAttempts) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
          break;
        } catch (err) {
          lastError = err;
        }
      }

      if (!stream) throw lastError;

      if (!mountedRef.current) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.muted = true;
        try {
          await videoRef.current.play();
          await waitForVideo(videoRef.current);
          await applyFocus(stream, { x: 0.5, y: 0.5 });
          setStabilizing(true);
          await sleep(documentMode ? 700 : 350);
          if (!mountedRef.current) return;
          setStabilizing(false);
          setReady(true);
        } catch {
          setStabilizing(false);
          setReady(false);
        }
      }
    } catch (err: any) {
      if (!mountedRef.current) return;
      const msg = err?.name === 'NotAllowedError'
        ? 'Permissão de câmera negada. Libere nas configurações do navegador.'
        : 'Não foi possível acessar a câmera neste dispositivo.';
      setCamError(msg);
    }
  };

  const handleTapToFocus = async (event: React.PointerEvent<HTMLDivElement>) => {
    if (!streamRef.current || captured || camError) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
    const focused = await applyFocus(streamRef.current, { x, y });
    setFocusMessage(focused ? 'Foco ajustado' : 'Autofoco do navegador');
    window.setTimeout(() => setFocusMessage(null), 1200);
  };

  useEffect(() => {
    mountedRef.current = true;
    startCamera();
    return () => {
      mountedRef.current = false;
      stopStream();
    };
  }, [documentMode, idealHeight, idealWidth]);

  const handleCapture = async () => {
    if (!videoRef.current || !ready || stabilizing) return;
    setReady(false);
    const track = streamRef.current?.getVideoTracks()[0];

    if (documentMode && track && 'ImageCapture' in window) {
      try {
        await applyFocus(streamRef.current, { x: 0.5, y: 0.5 });
        await sleep(650);
        const photo = await new (window as any).ImageCapture(track).takePhoto();
        const file = new File([photo], `foto-${Date.now()}.jpg`, { type: photo.type || 'image/jpeg' });
        stopStream();
        setCapturedFile(file);
        setCaptured(URL.createObjectURL(photo));
        return;
      } catch {
        // Nem todo navegador implementa ImageCapture de forma confiavel; o canvas fica como fallback.
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth || idealWidth;
    canvas.height = videoRef.current.videoHeight || idealHeight;
    const context = canvas.getContext('2d');
    if (context) {
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
    }
    canvas.toBlob(blob => {
      if (!blob) {
        setReady(true);
        return;
      }
      const file = new File([blob], `foto-${Date.now()}.jpg`, { type: 'image/jpeg' });
      stopStream();
      setCapturedFile(file);
      setCaptured(URL.createObjectURL(blob));
    }, 'image/jpeg', quality);
  };

  const handleConfirm = () => {
    if (capturedFile) { onCapture(capturedFile); if (captured) URL.revokeObjectURL(captured); }
  };

  const handleFileFallback = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) onCapture(file);
    event.target.value = '';
  };

  const handleRetake = () => {
    if (captured) URL.revokeObjectURL(captured);
    setCaptured(null);
    setCapturedFile(null);
    void startCamera();
  };

  const handleClose = () => { stopStream(); if (captured) URL.revokeObjectURL(captured); onClose(); };

  return (
    <div className="fixed inset-0 z-[70] bg-black flex flex-col" style={{ touchAction: 'none' }}>
      <div className="flex items-center justify-between p-4 shrink-0">
        <button type="button" onClick={handleClose} className="p-2 text-white hover:bg-white/10 rounded-xl transition-colors">
          <X className="w-6 h-6" />
        </button>
        <span className="text-white text-sm font-bold uppercase tracking-widest">{captured ? 'Confirmar Foto' : 'Tirar Foto'}</span>
        <div className="w-10" />
      </div>

      <div className="flex-1 relative overflow-hidden bg-black" onPointerDown={handleTapToFocus}>
        {camError ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-8 text-center">
            <AlertCircle className="w-16 h-16 text-red-400" />
            <p className="text-white text-sm">{camError}</p>
            <button type="button" onClick={() => fileInputRef.current?.click()} className="px-6 py-3 bg-white text-black rounded-xl font-bold text-sm">Escolher Foto</button>
            <button type="button" onClick={handleClose} className="px-6 py-3 border border-white/20 text-white rounded-xl font-bold text-sm">Fechar</button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handleFileFallback}
            />
          </div>
        ) : captured ? (
          <img src={captured} className="w-full h-full object-contain" alt="Captura" />
        ) : (
          <video ref={videoRef} className="w-full h-full object-cover" autoPlay playsInline muted />
        )}
        {!captured && !camError && (
          <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-black/45 px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-white">
            {stabilizing ? 'Estabilizando imagem...' : (focusMessage || 'Toque na tela para focar')}
          </div>
        )}
      </div>

      <div className="shrink-0 flex items-center justify-center gap-6 p-8 bg-black">
        {captured ? (
          <>
            <button type="button" onClick={handleRetake}
              className="flex-1 py-4 rounded-2xl border-2 border-white/20 text-white font-bold text-sm hover:bg-white/10 transition-all">
              Tirar Novamente
            </button>
            <button type="button" onClick={handleConfirm}
              className="flex-1 py-4 rounded-2xl bg-white text-black font-bold text-sm hover:bg-zinc-100 transition-all flex items-center justify-center gap-2">
              <CheckCircle2 className="w-5 h-5" /> Usar Esta Foto
            </button>
          </>
        ) : (
          <button type="button" onClick={handleCapture} disabled={!ready}
            className="w-20 h-20 rounded-full bg-white border-4 border-zinc-400 shadow-2xl hover:scale-95 active:scale-90 transition-transform disabled:opacity-40"
            aria-label="Capturar foto"
          />
        )}
      </div>
    </div>
  );
}
