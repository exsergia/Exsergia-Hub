import React, { useState } from 'react';
import { Bell, Save, KeyRound, Loader2, Eye, EyeOff, ShieldCheck, UserPlus, Trash2, Shield, AlertCircle } from 'lucide-react';
import { requestNotificationPermission, sendBrowserNotification } from '../lib/services';
import { changePassword, auth, db, handleFirestoreError, OperationType } from '../lib/supabase';
import { registerPushForUser } from '../lib/push';
import { useAuth } from '../App';
import { useCollection } from '../lib/supabaseHooks';
import { collection, doc, setDoc, updateDoc, deleteDoc, serverTimestamp } from '../lib/supabaseDb';

const PREFS_KEY = 'prefs-notificacoes';
const defaultPrefs = { materials: true, checklist: true, financial: false, updates: true };

// Quem pode GERENCIAR administradores (promover/remover). Restrito a esta lista — nem todo admin vê.
const ADMIN_MANAGER_EMAILS = [
  'nascimentoerick446@gmail.com',
  'pms.arthur@gmail.com',
  'gilson@exsergia.eng.br',
  'planejamento@exsergia.eng.br',
  'contasapagar@exsergia.eng.br',
];

export default function Settings() {
  const { notify, userProfile } = useAuth();
  const [notifications, setNotifications] = useState(() => {
    try {
      const saved = localStorage.getItem(PREFS_KEY);
      return saved ? { ...defaultPrefs, ...JSON.parse(saved) } : defaultPrefs;
    } catch {
      return defaultPrefs;
    }
  });
  const [salvandoPrefs, setSalvandoPrefs] = useState(false);

  const handleToggle = (key: keyof typeof notifications) => {
    setNotifications(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSave = async () => {
    setSalvandoPrefs(true);
    try {
      // Persiste as preferências de verdade (antes só viviam em memória).
      try { localStorage.setItem(PREFS_KEY, JSON.stringify(notifications)); } catch {}

      // Habilita as notificações reais: permissão + inscrição push do aparelho.
      const ok = await requestNotificationPermission();
      if (ok) {
        const uid = userProfile?.id || auth.currentUser?.id;
        const registered = uid ? await registerPushForUser(uid) : false;
        if (!registered) {
          notify('warning', 'Preferências Salvas', 'As preferências foram salvas, mas não foi possível registrar este aparelho para notificações.');
          return;
        }
        sendBrowserNotification('Configurações Salvas', 'Notificações ativadas neste aparelho.');
        notify('success', 'Preferências Salvas', 'Este aparelho receberá os avisos do sistema mesmo com o aplicativo fechado.');
      } else {
        notify('warning', 'Preferências Salvas', 'Preferências salvas, mas as notificações estão bloqueadas no navegador.');
      }
    } finally {
      setSalvandoPrefs(false);
    }
  };

  const [senhaAtual, setSenhaAtual] = useState('');
  const [novaSenha, setNovaSenha] = useState('');
  const [confirmarSenha, setConfirmarSenha] = useState('');
  const [mostrarSenhas, setMostrarSenhas] = useState(false);
  const [salvandoSenha, setSalvandoSenha] = useState(false);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!senhaAtual || !novaSenha || !confirmarSenha) {
      notify('error', 'Campos obrigatórios', 'Preencha todos os campos para alterar a senha.');
      return;
    }
    if (novaSenha.length < 6) {
      notify('error', 'Senha muito curta', 'A nova senha precisa ter pelo menos 6 caracteres.');
      return;
    }
    if (novaSenha !== confirmarSenha) {
      notify('error', 'Senhas não conferem', 'A nova senha e a confirmação precisam ser iguais.');
      return;
    }
    if (novaSenha === senhaAtual) {
      notify('error', 'Senha repetida', 'A nova senha precisa ser diferente da atual.');
      return;
    }
    setSalvandoSenha(true);
    try {
      await changePassword(senhaAtual, novaSenha);
      notify('success', 'Senha alterada!', 'Sua senha foi atualizada com sucesso.');
      setSenhaAtual('');
      setNovaSenha('');
      setConfirmarSenha('');
    } catch (err: any) {
      notify('error', 'Erro ao alterar senha', err?.message || 'Não foi possível alterar a senha.');
    } finally {
      setSalvandoSenha(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8 animate-in fade-in duration-500">
      <div data-tour="set-header" className="flex flex-col gap-1">
        <h2 className="text-2xl font-bold tracking-tight text-zinc-900">Configurações</h2>
        <p className="text-zinc-500 text-sm">Gerencie suas preferências de sistema e notificações.</p>
      </div>

      <div data-tour="set-notif" className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-zinc-100 bg-zinc-50/50">
          <div className="flex items-center gap-3">
            <Bell className="w-5 h-5 text-zinc-400" />
            <h3 className="font-bold text-zinc-900 uppercase tracking-widest text-xs">Notificações Push</h3>
          </div>
        </div>
        
        <div className="divide-y divide-zinc-100">
          <NotificationItem 
            title="Entrada de Materiais" 
            desc="Receba avisos quando novos materiais forem registrados em qualquer obra."
            active={notifications.materials}
            onClick={() => handleToggle('materials')}
          />
          <NotificationItem 
            title="Pendências de Checklist" 
            desc="Lembretes diários para o preenchimento do Checklist Diário."
            active={notifications.checklist}
            onClick={() => handleToggle('checklist')}
          />
          <NotificationItem 
            title="Alertas Financeiros" 
            desc="Avisos sobre aprovações e pagamentos de medições."
            active={notifications.financial}
            onClick={() => handleToggle('financial')}
          />
          <NotificationItem 
            title="Status das Obras" 
            desc="Notificações sobre alterações significativas no cronograma."
            active={notifications.updates}
            onClick={() => handleToggle('updates')}
          />
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-4">
        <button
          onClick={handleSave}
          disabled={salvandoPrefs}
          className="flex items-center justify-center gap-2 px-8 py-4 bg-zinc-900 text-white rounded-xl font-bold uppercase tracking-widest hover:bg-zinc-800 transition-all shadow-xl shadow-zinc-200 disabled:opacity-60"
        >
          {salvandoPrefs ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
          {salvandoPrefs ? 'Salvando...' : 'Salvar Preferências'}
        </button>
      </div>

      <div data-tour="set-senha" className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-zinc-100 bg-zinc-50/50">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <KeyRound className="w-5 h-5 text-zinc-400" />
              <h3 className="font-bold text-zinc-900 uppercase tracking-widest text-xs">Alterar Senha</h3>
            </div>
            <button
              type="button"
              onClick={() => setMostrarSenhas(v => !v)}
              className="flex items-center gap-1.5 text-[11px] font-bold text-zinc-400 hover:text-zinc-700 transition-colors"
            >
              {mostrarSenhas ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              {mostrarSenhas ? 'Ocultar' : 'Mostrar'}
            </button>
          </div>
        </div>

        <form onSubmit={handleChangePassword} className="p-6 space-y-4">
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Senha Atual</label>
            <input
              type={mostrarSenhas ? 'text' : 'password'}
              value={senhaAtual}
              onChange={(e) => setSenhaAtual(e.target.value)}
              placeholder="Digite sua senha atual"
              autoComplete="current-password"
              className="w-full h-12 px-4 bg-white border border-zinc-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-zinc-900 focus:border-zinc-900 transition-all"
            />
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Nova Senha</label>
              <input
                type={mostrarSenhas ? 'text' : 'password'}
                value={novaSenha}
                onChange={(e) => setNovaSenha(e.target.value)}
                placeholder="Mín. 6 caracteres"
                autoComplete="new-password"
                className="w-full h-12 px-4 bg-white border border-zinc-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-zinc-900 focus:border-zinc-900 transition-all"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Confirmar Nova Senha</label>
              <input
                type={mostrarSenhas ? 'text' : 'password'}
                value={confirmarSenha}
                onChange={(e) => setConfirmarSenha(e.target.value)}
                placeholder="Repita a nova senha"
                autoComplete="new-password"
                className="w-full h-12 px-4 bg-white border border-zinc-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-zinc-900 focus:border-zinc-900 transition-all"
              />
            </div>
          </div>
          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={salvandoSenha}
              className="flex items-center justify-center gap-2 px-8 py-4 bg-zinc-900 text-white rounded-xl font-bold uppercase tracking-widest hover:bg-zinc-800 transition-all shadow-xl shadow-zinc-200 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {salvandoSenha ? <Loader2 className="w-5 h-5 animate-spin" /> : <KeyRound className="w-5 h-5" />}
              {salvandoSenha ? 'Salvando...' : 'Alterar Senha'}
            </button>
          </div>
        </form>
      </div>

      {ADMIN_MANAGER_EMAILS.includes((userProfile?.email || auth.currentUser?.email || '').trim().toLowerCase()) && <AdminManager />}
    </div>
  );
}

// ── Gestão de administradores (só admin) ────────────────────────────────────
function SettingsLoadError({ title, message }: { title: string; message?: string }) {
  return (
    <div className="m-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-red-700 flex items-start gap-3 shadow-sm">
      <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
      <div>
        <p className="text-sm font-black">{title}</p>
        <p className="text-xs font-medium text-red-600 break-words">{message || 'Verifique permissoes e conexao com o banco.'}</p>
      </div>
    </div>
  );
}

function AdminManager() {
  const { notify, userProfile } = useAuth();
  const [adminSnap, loading, adminError] = useCollection(collection(db, 'admin_access'));
  const [novoEmail, setNovoEmail] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const meuEmail = (userProfile?.email || auth.currentUser?.email || '').trim().toLowerCase();

  // Só os admins por e-mail (id `email:...`); os por CPF são raros e gerenciados à parte.
  // O e-mail exibido vem do ID (fonte da verdade do acesso), nunca do campo `valor`
  // — o login casa o admin pelo id `email:<login>`, então `valor` é só um espelho que pode estar errado.
  const admins = (adminSnap?.docs || [])
    .filter(d => d.id.trim().toLowerCase().startsWith('email:'))
    .map(d => ({ id: d.id, email: d.id.trim().toLowerCase().replace(/^email:/, ''), ativo: d.data()?.ativo !== false }))
    .sort((a, b) => a.email.localeCompare(b.email));

  const emailValido = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (salvando) return;
    const email = novoEmail.trim().toLowerCase();
    if (!emailValido(email)) { notify('error', 'E-mail inválido', 'Digite um e-mail válido.'); return; }
    if (admins.some(a => a.email === email)) { notify('warning', 'Já é admin', `${email} já está na lista.`); return; }
    setSalvando(true);
    try {
      // id determinístico e LIMPO — é assim que o login encontra o admin (busca por id exato).
      await setDoc(doc(db, 'admin_access', `email:${email}`), {
        tipo: 'email', valor: email, ativo: true, createdAt: serverTimestamp(),
      });
      notify('success', 'Admin adicionado', `${email} agora tem acesso total. Ele precisa sair e entrar de novo.`);
      setNovoEmail('');
    } catch (err: any) {
      notify('error', 'Erro ao adicionar', err?.message || 'Falha ao salvar.');
      handleFirestoreError(err, OperationType.WRITE, 'admin_access');
    } finally { setSalvando(false); }
  };

  const handleToggle = async (a: { id: string; email: string; ativo: boolean }) => {
    if (a.email === meuEmail) { notify('warning', 'Ação bloqueada', 'Você não pode desativar o seu próprio acesso.'); return; }
    setBusyId(a.id);
    try {
      await updateDoc(doc(db, 'admin_access', a.id), { ativo: !a.ativo });
      notify('success', a.ativo ? 'Admin desativado' : 'Admin reativado', a.email);
    } catch (err: any) {
      notify('error', 'Erro', err?.message || 'Falha ao atualizar.');
      handleFirestoreError(err, OperationType.WRITE, 'admin_access');
    } finally { setBusyId(null); }
  };

  const handleRemove = async (a: { id: string; email: string }) => {
    if (a.email === meuEmail) { notify('warning', 'Ação bloqueada', 'Você não pode remover o seu próprio acesso.'); return; }
    if (!confirm(`Remover o acesso de administrador de "${a.email}"?`)) return;
    setBusyId(a.id);
    try {
      await deleteDoc(doc(db, 'admin_access', a.id));
      notify('success', 'Admin removido', a.email);
    } catch (err: any) {
      notify('error', 'Erro ao remover', err?.message || 'Falha ao remover.');
      handleFirestoreError(err, OperationType.DELETE, 'admin_access');
    } finally { setBusyId(null); }
  };

  return (
    <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
      <div className="p-6 border-b border-zinc-100 bg-zinc-50/50">
        <div className="flex items-center gap-3">
          <ShieldCheck className="w-5 h-5 text-zinc-400" />
          <h3 className="font-bold text-zinc-900 uppercase tracking-widest text-xs">Administradores</h3>
        </div>
        <p className="text-xs text-zinc-500 mt-2 leading-relaxed">
          Admins têm acesso total ao sistema. Adicione pelo e-mail de login da pessoa — ela precisa <strong>sair e entrar de novo</strong> para o acesso valer.
        </p>
      </div>

      <form onSubmit={handleAdd} className="p-6 border-b border-zinc-100 flex flex-col sm:flex-row gap-3">
        <input
          type="email"
          value={novoEmail}
          onChange={(e) => setNovoEmail(e.target.value)}
          placeholder="email-da-pessoa@exemplo.com"
          autoComplete="off"
          className="flex-1 h-12 px-4 bg-white border border-zinc-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-zinc-900 focus:border-zinc-900 transition-all"
        />
        <button
          type="submit"
          disabled={salvando}
          className="flex items-center justify-center gap-2 px-6 h-12 bg-zinc-900 text-white rounded-xl font-bold text-sm hover:bg-zinc-800 transition-all disabled:opacity-60"
        >
          {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
          Adicionar
        </button>
      </form>

      {adminError && (
        <SettingsLoadError
          title="Erro ao carregar administradores"
          message={adminError.message}
        />
      )}

      <div className="divide-y divide-zinc-100">
        {loading ? (
          <div className="p-6 text-center text-zinc-400 text-sm">Carregando...</div>
        ) : admins.length === 0 ? (
          <div className="p-6 text-center text-zinc-400 text-sm">Nenhum administrador por e-mail cadastrado.</div>
        ) : admins.map(a => (
          <div key={a.id} className="p-5 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${a.ativo ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-400'}`}>
                <Shield className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-zinc-900 truncate">{a.email}{a.email === meuEmail && <span className="text-zinc-400 font-medium"> (você)</span>}</p>
                <p className={`text-[11px] font-bold uppercase tracking-wider ${a.ativo ? 'text-green-600' : 'text-zinc-400'}`}>{a.ativo ? 'Ativo' : 'Desativado'}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => handleToggle(a)}
                disabled={busyId === a.id || a.email === meuEmail}
                className="px-3 py-2 rounded-lg text-xs font-bold border border-zinc-200 text-zinc-600 hover:bg-zinc-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {a.ativo ? 'Desativar' : 'Reativar'}
              </button>
              <button
                type="button"
                onClick={() => handleRemove(a)}
                disabled={busyId === a.id || a.email === meuEmail}
                className="p-2 rounded-lg text-zinc-300 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                title="Remover"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function NotificationItem({ title, desc, active, onClick }: { title: string, desc: string, active: boolean, onClick: () => void }) {
  return (
    <div className="p-6 flex items-center justify-between gap-6 hover:bg-zinc-50/50 transition-colors">
      <div className="space-y-1">
        <h4 className="font-bold text-zinc-900 tracking-tight">{title}</h4>
        <p className="text-xs text-zinc-500 leading-relaxed max-w-sm">{desc}</p>
      </div>
      <button 
        onClick={onClick}
        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${active ? 'bg-zinc-900' : 'bg-zinc-200'}`}
      >
        <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${active ? 'translate-x-5' : 'translate-x-0'}`} />
      </button>
    </div>
  );
}
