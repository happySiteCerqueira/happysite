import { useRef, useState } from 'react';
import api from '../api/api';

export default function Backup() {
  const inputRef = useRef();
  const [msg, setMsg] = useState('');
  const [erro, setErro] = useState('');

  async function exportar() {
    const res = await api.get('/backup/exportar', { responseType: 'blob' });
    const url = window.URL.createObjectURL(new Blob([res.data]));
    const a = document.createElement('a');
    a.href = url;
    a.download = `happysite-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function importar(e) {
    e.preventDefault();
    setMsg(''); setErro('');
    const file = inputRef.current.files[0];
    if (!file) return setErro('Selecione um arquivo de backup (.json)');
    const formData = new FormData();
    formData.append('backup', file);
    try {
      await api.post('/backup/importar', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      setMsg('Backup restaurado com sucesso! Recomenda-se reiniciar o sistema.');
    } catch (err) {
      setErro(err.response?.data?.erro || 'Erro ao importar backup');
    }
  }

  return (
    <div>
      <h2>💾 Backup do Sistema</h2>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3>Exportar backup</h3>
        <p style={{ color: '#6b7280', fontSize: 13 }}>Gera um arquivo .json com todos os dados do sistema (obras, colaboradores, medições, usuários, etc).</p>
        <button className="btn-primary" onClick={exportar}>Exportar backup agora</button>
      </div>

      <div className="card">
        <h3>Importar backup</h3>
        <p style={{ color: '#6b7280', fontSize: 13 }}>⚠️ Isso substituirá todos os dados atuais pelos dados do arquivo selecionado. Use com cuidado.</p>
        {msg && <div style={{ background: '#dcfce7', color: '#166534', padding: 8, borderRadius: 6, marginBottom: 10 }}>{msg}</div>}
        {erro && <div style={{ background: '#fee2e2', color: '#991b1b', padding: 8, borderRadius: 6, marginBottom: 10 }}>{erro}</div>}
        <form onSubmit={importar} className="flex gap-2">
          <input type="file" accept=".json" ref={inputRef} />
          <button type="submit" className="btn-danger">Importar e substituir</button>
        </form>
      </div>
    </div>
  );
}
