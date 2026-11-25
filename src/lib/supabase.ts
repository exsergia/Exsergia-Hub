import { createClient, Session, User } from '@supabase/supabase-js';

const rawSupabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const DEFAULT_SUPABASE_URL = 'https://krbimgxlnyucldfxkvdy.supabase.co';
const DEFAULT_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_LyarOzLLpQjox1EypkoX6g_tFHWZX9T';

function normalizeSupabaseUrl(url?: string) {
  if (!url) return undefined;
  return url.trim().replace(/\/?rest\/v1\/?$/i, '').replace(/\/$/, '');
}

export const supabaseUrl = normalizeSupabaseUrl(rawSupabaseUrl) || DEFAULT_SUPABASE_URL;
export const supabaseKey = (supabaseAnonKey || '').trim() || DEFAULT_SUPABASE_PUBLISHABLE_KEY;

if (!rawSupabaseUrl?.trim() || !supabaseAnonKey?.trim()) {
  console.warn('Supabase não configurado. Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no .env.');
}

export const supabase = createClient(
  supabaseUrl,
  supabaseKey,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  }
);

export type SupabaseUser = User;
export type SupabaseSession = Session;

export const auth = {
  currentUser: null as User | null,
};

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function isTransientSupabaseError(error: unknown) {
  const message = error instanceof Error ? error.message : String((error as any)?.message || error || '');
  const status = (error as any)?.status;
  return (
    status === 408 ||
    status === 429 ||
    (typeof status === 'number' && status >= 500) ||
    /failed to fetch|networkerror|network request failed|fetch failed|timeout|temporarily unavailable/i.test(message)
  );
}

export async function withSupabaseRetry<T>(
  operation: () => PromiseLike<T> | T,
  attempts = 3,
  baseDelayMs = 500
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await operation();
      const responseError = (result as any)?.error;
      if (responseError && isTransientSupabaseError(responseError) && attempt < attempts) {
        lastError = responseError;
        await sleep(baseDelayMs * attempt);
        continue;
      }
      return result;
    } catch (error) {
      lastError = error;
      if (!isTransientSupabaseError(error) || attempt === attempts) break;
      await sleep(baseDelayMs * attempt);
    }
  }

  throw lastError;
}

export function setCurrentUser(user: User | null) {
  auth.currentUser = user;
}

export async function logOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function signInWithEmailAndPassword(_auth: unknown, email: string, password: string) {
  const { data, error } = await withSupabaseRetry(
    () => supabase.auth.signInWithPassword({ email, password })
  );
  if (error) throw error;
  return { user: data.user };
}

export async function changePassword(currentPassword: string, newPassword: string) {
  const email = auth.currentUser?.email;
  if (!email) throw new Error('Nenhum usuário autenticado.');
  // Revalida a senha atual antes de permitir a troca
  const { error: reauthError } = await supabase.auth.signInWithPassword({ email, password: currentPassword });
  if (reauthError) throw new Error('Senha atual incorreta.');
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}

export async function createUserWithEmailAndPassword(_auth: unknown, email: string, password: string, metadata?: Record<string, unknown>) {
  const { data, error } = await withSupabaseRetry(
    () => supabase.auth.signUp({
      email,
      password,
      options: { data: metadata || {} },
    })
  );
  if (error) {
    const message = String(error.message || '');
    const code = String((error as any).code || '');
    if (/already registered|already exists|email.*registered/i.test(message) || code === 'user_already_exists') {
      const { data: loginData, error: loginError } = await withSupabaseRetry(
        () => supabase.auth.signInWithPassword({ email, password })
      );
      if (!loginError && loginData.user) return { user: loginData.user, session: loginData.session };
    }
    throw error;
  }
  if (!data.user) throw new Error('Usuário não foi criado no Supabase Auth.');
  return { user: data.user, session: data.session };
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export function handleSupabaseError(error: unknown, operationType: OperationType, path: string | null) {
  // Logger puro: registra o detalhe no console para depuração, sem relançar
  // (evita unhandled rejections nos catch das páginas) e sem expor dado pessoal
  // do usuário (e-mail) — apenas o id, relevante para LGPD.
  console.error('Supabase Error:', {
    error: error instanceof Error ? error.message : String(error),
    operationType,
    path,
    userId: auth.currentUser?.id,
  });
}

export const handleFirestoreError = handleSupabaseError;

export const db = {};
