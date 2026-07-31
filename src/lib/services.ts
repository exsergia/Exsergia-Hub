import { supabase, supabaseKey, supabaseUrl } from './supabase';
import { compressImage } from './imageUtils';
import { FiscalAiAnalysis } from '../types';

export const requestNotificationPermission = async () => {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission !== 'denied') {
    const permission = await Notification.requestPermission();
    return permission === 'granted';
  }
  return false;
};

export const sendBrowserNotification = async (title: string, body: string) => {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  // No mobile (e em PWAs) o construtor `new Notification()` é ilegal — é preciso
  // usar a Service Worker Registration. Tentamos esse caminho primeiro e só caímos
  // no construtor (desktop) como fallback. Tudo protegido para nunca lançar.
  try {
    if ('serviceWorker' in navigator) {
      const timeout = new Promise<never>((_, reject) =>
        window.setTimeout(() => reject(new Error('Service worker indisponivel')), 1500)
      );
      const reg = await Promise.race([navigator.serviceWorker.ready, timeout]);
      // Sem `icon` (ícone grande): no Android ele fica à direita e corta o texto do corpo.
      if ('showNotification' in reg) {
        await reg.showNotification(title, { body, badge: '/icon-192.png' });
        return;
      }
    }
  } catch {
    // ignora e tenta o fallback abaixo
  }

  try {
    new Notification(title, { body });
  } catch {
    // Ambiente não suporta o construtor (ex.: mobile sem SW pronto) — silencia.
  }
};

const UPLOADS_BUCKET = 'uploads';
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 365;
const FISCAL_BUCKET = 'fiscal-private';
const FISCAL_SIGNED_URL_TTL_SECONDS = 60 * 10;
const SIGNED_URL_CACHE_SAFETY_SECONDS = 30;

const fiscalSignedUrlCache = new Map<string, { url: string; expiresAt: number }>();

const buildAccessUrl = async (bucket: string, path: string) => {
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);

  if (error) throw error;
  return data.signedUrl;
};

export const uploadImage = async (file: File, path = 'uploads', onProgress?: (progress: number) => void): Promise<string> => {
  // Comprime imagens antes do upload (reduz tempo no 4G de campo e storage).
  // Se a compressão falhar, sobe o arquivo original — sem regressão.
  let body: Blob = file;
  let safeExt = (file.name.split('.').pop() || 'jpg').replace(/[^a-zA-Z0-9]/g, '') || 'jpg';
  let contentType = file.type || 'image/jpeg';

  if ((file.type || '').startsWith('image/')) {
    try {
      body = await compressImage(file, 1600, 0.7);
      safeExt = 'jpg';
      contentType = 'image/jpeg';
    } catch {
      body = file;
    }
  }

  const fileName = `${path}/${Date.now()}-${Math.random().toString(36).slice(2)}.${safeExt}`;

  onProgress?.(10);
  const { error } = await supabase.storage.from(UPLOADS_BUCKET).upload(fileName, body, {
    cacheControl: '3600',
    upsert: false,
    contentType,
  });

  if (error) throw error;

  onProgress?.(100);
  return buildAccessUrl(UPLOADS_BUCKET, fileName);
};

export const uploadFile = async (file: File, path = 'uploads', onProgress?: (progress: number) => void): Promise<string> => {
  const fileName = `${path}/${Date.now()}-${Math.random().toString(36).slice(2)}-${file.name}`;
  onProgress?.(10);
  const { error } = await supabase.storage.from(UPLOADS_BUCKET).upload(fileName, file, {
    cacheControl: '3600',
    upsert: false,
  });
  if (error) throw error;
  onProgress?.(100);
  return buildAccessUrl(UPLOADS_BUCKET, fileName);
};

export const uploadPhoto = uploadImage;

export type FiscalPhotoUpload = {
  fotoPath: string;
  fotoUrl?: string;
  fotoSizeBytes: number;
  fotoStorageSizeBytes: number;
  thumbnailPath: string;
  thumbnailSizeBytes: number;
};

function isStorageBucketMissing(error: unknown) {
  const message = String((error as any)?.message || (error as any)?.error_description || error || '');
  return /bucket not found|bucket.*not.*exist|not_found/i.test(message);
}

async function uploadBlobToBucket(bucket: string, fileName: string, body: Blob, contentType = 'image/jpeg') {
  const { error } = await supabase.storage.from(bucket).upload(fileName, body, {
    cacheControl: '3600',
    upsert: false,
    contentType,
  });
  if (error) throw error;
}

export async function uploadFiscalPhoto(file: File): Promise<FiscalPhotoUpload> {
  const baseName = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let fullImage: Blob = file;
  let thumbnail: Blob = file;

  try {
    fullImage = await compressImage(file, 2200, 0.84);
  } catch {
    fullImage = file;
  }

  try {
    thumbnail = await compressImage(file, 560, 0.58);
  } catch {
    thumbnail = fullImage;
  }

  const fotoPath = `fiscal/${baseName}.jpg`;
  const thumbnailPath = `fiscal/thumbs/${baseName}.jpg`;

  try {
    await Promise.all([
      uploadBlobToBucket(FISCAL_BUCKET, fotoPath, fullImage),
      uploadBlobToBucket(FISCAL_BUCKET, thumbnailPath, thumbnail),
    ]);

    return {
      fotoPath,
      fotoSizeBytes: file.size,
      fotoStorageSizeBytes: fullImage.size,
      thumbnailPath,
      thumbnailSizeBytes: thumbnail.size,
    };
  } catch (error) {
    if (!isStorageBucketMissing(error)) throw error;

    const fallbackPath = `fiscal/${baseName}.jpg`;
    const { error: fallbackError } = await supabase.storage.from(UPLOADS_BUCKET).upload(fallbackPath, fullImage, {
      cacheControl: '3600',
      upsert: false,
      contentType: 'image/jpeg',
    });
    if (fallbackError) throw fallbackError;

    return {
      fotoPath: '',
      fotoUrl: await buildAccessUrl(UPLOADS_BUCKET, fallbackPath),
      fotoSizeBytes: file.size,
      fotoStorageSizeBytes: fullImage.size,
      thumbnailPath: '',
      thumbnailSizeBytes: 0,
    };
  }
}

export async function getFiscalPhotoUrl(path?: string, ttlSeconds = FISCAL_SIGNED_URL_TTL_SECONDS) {
  if (!path) return '';
  const cacheKey = `${FISCAL_BUCKET}:${path}`;
  const cached = fiscalSignedUrlCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.url;

  const { data, error } = await supabase.storage
    .from(FISCAL_BUCKET)
    .createSignedUrl(path, ttlSeconds);
  if (error) throw error;
  fiscalSignedUrlCache.set(cacheKey, {
    url: data.signedUrl,
    expiresAt: Date.now() + Math.max(1, ttlSeconds - SIGNED_URL_CACHE_SAFETY_SECONDS) * 1000,
  });
  return data.signedUrl;
}

export async function getFiscalPhotoUrls(paths: string[], ttlSeconds = FISCAL_SIGNED_URL_TTL_SECONDS) {
  const uniquePaths = Array.from(new Set(paths.filter(Boolean)));
  const result: Record<string, string> = {};
  const missing: string[] = [];
  const now = Date.now();

  uniquePaths.forEach(path => {
    const cacheKey = `${FISCAL_BUCKET}:${path}`;
    const cached = fiscalSignedUrlCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      result[path] = cached.url;
    } else {
      missing.push(path);
    }
  });

  if (missing.length === 0) return result;

  const { data, error } = await supabase.storage
    .from(FISCAL_BUCKET)
    .createSignedUrls(missing, ttlSeconds);
  if (error) throw error;

  const expiresAt = Date.now() + Math.max(1, ttlSeconds - SIGNED_URL_CACHE_SAFETY_SECONDS) * 1000;
  (data || []).forEach(item => {
    if (!item.path || !item.signedUrl) return;
    const cacheKey = `${FISCAL_BUCKET}:${item.path}`;
    fiscalSignedUrlCache.set(cacheKey, { url: item.signedUrl, expiresAt });
    result[item.path] = item.signedUrl;
  });

  return result;
}

export async function deleteFiscalPhotos(paths: Array<string | undefined>) {
  const cleanPaths = Array.from(new Set(paths.filter(Boolean))) as string[];
  if (cleanPaths.length === 0) return;
  const { error } = await supabase.storage.from(FISCAL_BUCKET).remove(cleanPaths);
  if (error) throw error;
}

export async function analyzeFiscalImage(params: {
  imageUrl?: string;
  imageDataUrl?: string;
  tipo: 'NF' | 'Cupom';
  valor: number;
  data: string;
  despesa?: string;
}): Promise<FiscalAiAnalysis> {
  const pending = (message: string, detail?: string): FiscalAiAnalysis => ({
    status: 'pendente',
    confidence: 0,
    documentType: 'Indefinido',
    extractedValue: null,
    extractedDate: null,
    vendor: null,
    reasons: [message],
    warnings: detail ? [detail] : ['Documento salvo sem analise automatica.'],
    analyzedAt: new Date().toISOString(),
    configured: false,
    error: detail,
  });

  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) {
    return pending('Sessao obrigatoria para executar a analise automatica.', 'Entre novamente no sistema e tente lancar a imagem outra vez.');
  }

  let data: unknown;
  try {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 30000);

    const response = await fetch(`${supabaseUrl}/functions/v1/analyze-fiscal-image`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        apikey: supabaseKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify(params),
      signal: controller.signal,
    });
    window.clearTimeout(timeoutId);

    const text = await response.text();
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { error: text || 'Resposta invalida da Edge Function.' };
    }

    if (!response.ok) {
      const message = String((data as any)?.error || (data as any)?.message || `HTTP ${response.status}`);
      return pending('A IA nao concluiu a leitura da imagem.', message);
    }
  } catch (err: any) {
    const detail = err?.name === 'AbortError'
      ? 'Tempo limite da IA excedido.'
      : /failed to fetch|network/i.test(String(err?.message || ''))
        ? 'Nao foi possivel conectar ao scanner de IA agora.'
        : err?.message || 'Edge Function indisponivel.';
    return pending('Nao foi possivel executar a analise automatica.', detail);
  }

  if ((data as any)?.error) {
    return pending('A IA nao concluiu a leitura da imagem.', String((data as any).error));
  }

  return data as FiscalAiAnalysis;
}

function fileToDataUrl(file: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Nao foi possivel ler a imagem.'));
    reader.readAsDataURL(file);
  });
}

export async function scanFiscalImageFile(file: File, params: {
  tipo: 'NF' | 'Cupom';
  valor: number;
  data: string;
  despesa?: string;
}) {
  let imageForScan: Blob = file;
  try {
    imageForScan = await compressImage(file, 1200, 0.65);
  } catch {
    imageForScan = file;
  }
  const imageDataUrl = await fileToDataUrl(imageForScan);
  return analyzeFiscalImage({ ...params, imageDataUrl });
}
