import { ChangeEvent, useEffect, useRef, useState } from 'react';
import { Camera, Loader2, X } from 'lucide-react';

type CameraCaptureProps = {
  onCapture: (file: File) => void;
  onClose: () => void;
  quality?: number;
  idealWidth?: number;
  idealHeight?: number;
  documentMode?: boolean;
};

/**
 * Abre a câmera nativa do aparelho pelo seletor de arquivos do sistema.
 * Os parâmetros de qualidade e dimensão são mantidos na API para não quebrar
 * os formulários existentes; o tratamento final continua sendo feito no upload.
 */
export function CameraCapture({ onCapture, onClose }: CameraCaptureProps) {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const attemptedOpenRef = useRef(false);
  const [opening, setOpening] = useState(true);
  const [error, setError] = useState('');

  const openCamera = () => {
    setError('');
    setOpening(true);
    cameraInputRef.current?.click();
    // Ao cancelar o seletor nativo não existe um evento padronizado. O botão
    // volta a ficar disponível para uma nova tentativa.
    window.setTimeout(() => setOpening(false), 800);
  };

  useEffect(() => {
    if (attemptedOpenRef.current) return;
    attemptedOpenRef.current = true;
    const timer = window.setTimeout(openCamera, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const useSelectedImage = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    setOpening(false);
    if (!file) return;
    if (file.type && !file.type.startsWith('image/')) {
      setError('Selecione uma imagem válida.');
      return;
    }

    try {
      onCapture(file);
      onClose();
    } catch {
      setError('Não foi possível usar esta foto. Tente novamente.');
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-zinc-950/70 p-4 backdrop-blur-sm">
      <div className="relative w-full max-w-sm rounded-3xl bg-white p-6 text-center shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 rounded-xl p-2 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
          aria-label="Fechar"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-800">
          {opening ? <Loader2 className="h-7 w-7 animate-spin" /> : <Camera className="h-7 w-7" />}
        </div>
        <h3 className="mt-4 text-lg font-black text-zinc-950">Câmera do celular</h3>
        <p className="mt-2 text-sm leading-relaxed text-zinc-500">
          Use a câmera nativa do aparelho para tirar a foto.
        </p>

        {error && (
          <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{error}</p>
        )}

        <div className="mt-6">
          <button
            type="button"
            onClick={openCamera}
            disabled={opening}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-zinc-900 px-4 py-3.5 text-sm font-bold text-white transition-colors hover:bg-zinc-800 disabled:opacity-60"
          >
            {opening ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
            {opening ? 'Abrindo câmera...' : 'Abrir câmera do celular'}
          </button>
        </div>

        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={useSelectedImage}
        />
      </div>
    </div>
  );
}
