import { useEffect, useState } from 'react';
import api from '../api/api';
import { VERSAO_SISTEMA } from '../versao';

// Manuais do sistema (Configurações → Manuais, exclusivo do ADM).
//
// POR QUÊ: reúne num só lugar tudo o que é preciso para entender e dar manutenção no sistema.
// O objetivo prático é poder BAIXAR os arquivos e colar em qualquer chat de IA, de qualquer PC,
// sem depender do histórico de nenhuma conversa anterior.
export default function Manuais() {
  const [lista, setLista] = useState([]);
  const [aberto, setAberto] = useState(null);   // manual sendo lido na tela
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    api.get('/manuais')
      .then(res => setLista(res.data))
      .catch(() => setErro('Não foi possível carregar a lista de manuais.'));
  }, []);

  function abrir(chave) {
    setCarregando(true);
    setErro('');
    api.get(`/manuais/${chave}`)
      .then(res => setAberto(res.data))
      .catch(e => setErro(e.response?.data?.erro || 'Não foi possível abrir o manual.'))
      .finally(() => setCarregando(false));
  }

  // Baixa via blob (e não link direto) porque a rota exige o cabeçalho de autenticação —
  // um <a href> simples seria recusado com 401.
  async function baixar(manual) {
    try {
      const res = await api.get(`/manuais/${manual.chave}/download`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = manual.arquivo;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      setErro('Não foi possível baixar o arquivo.');
    }
  }

  // Baixa todos de uma vez, para colar o conjunto completo num chat novo.
  async function baixarTodos() {
    for (const manual of lista.filter(m => m.disponivel)) {
      await baixar(manual);
    }
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>📘 Manuais do sistema — versão {VERSAO_SISTEMA}</h3>
        <p style={{ fontSize: 13, color: '#374151', marginBottom: 8 }}>
          Baixe estes arquivos e cole em qualquer chat de IA para continuar desenvolvendo o
          sistema. Eles contêm tudo: como conectar, como cada módulo funciona, as regras de
          negócio e as armadilhas que já causaram problema.
        </p>
        <p style={{ fontSize: 12, color: '#6b7280', margin: 0 }}>
          Os manuais são atualizados a cada nova versão — baixe de novo sempre que for mexer no
          sistema, para ter a versão correspondente ao que está no ar.
        </p>
        {lista.filter(m => m.disponivel).length > 1 && (
          <button className="btn-primary" style={{ marginTop: 12 }} onClick={baixarTodos}>
            ⬇️ Baixar todos
          </button>
        )}
      </div>

      {erro && (
        <div className="card" style={{ marginBottom: 16, color: '#b91c1c', fontSize: 13, fontWeight: 600 }}>
          {erro}
        </div>
      )}

      <ListaManuais lista={lista} erro={erro} onAbrir={abrir} onBaixar={baixar} />

      {carregando && <div className="card" style={{ marginTop: 12, fontSize: 13 }}>Abrindo...</div>}
      {aberto && <LeitorManual manual={aberto} onFechar={() => setAberto(null)} />}
    </div>
  );
}

function ListaManuais({ lista, erro, onAbrir, onBaixar }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {lista.map(manual => (
        <div key={manual.chave} className="card">
          <div className="flex gap-4" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 320px' }}>
              <strong style={{ fontSize: 15 }}>{manual.icone} {manual.titulo}</strong>
              <div style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>{manual.descricao}</div>
              <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 6 }}>
                {manual.disponivel
                  ? `${manual.arquivo} · ${manual.tamanho_kb} KB`
                  : <span style={{ color: '#b45309' }}>⚠️ arquivo não encontrado no servidor</span>}
              </div>
            </div>
            {manual.disponivel && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn-secondary btn-sm" onClick={() => onAbrir(manual.chave)}>
                  👁️ Ler
                </button>
                <button className="btn-primary btn-sm" onClick={() => onBaixar(manual)}>
                  ⬇️ Baixar
                </button>
              </div>
            )}
          </div>
        </div>
      ))}
      {lista.length === 0 && !erro && (
        <div className="card" style={{ fontSize: 13, color: '#6b7280' }}>Carregando manuais...</div>
      )}
    </div>
  );
}

// Leitor simples: mostra o Markdown como texto puro (monoespaçado), que é exatamente o formato
// a copiar para um chat de IA. Renderizar como HTML exigiria uma biblioteca nova sem ganho real.
function LeitorManual({ manual, onFechar }) {
  const [copiado, setCopiado] = useState(false);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(manual.conteudo);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Alguns navegadores bloqueiam a área de transferência fora de HTTPS.
      setCopiado(false);
    }
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="flex gap-2" style={{ alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <strong>{manual.icone} {manual.titulo}</strong>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button className="btn-secondary btn-sm" onClick={copiar}>
            {copiado ? '✔ Copiado!' : '📋 Copiar tudo'}
          </button>
          <button className="btn-secondary btn-sm" onClick={onFechar}>✕ Fechar</button>
        </div>
      </div>
      <pre style={{
        maxHeight: '60vh', overflow: 'auto', background: '#f8fafc', padding: 12,
        borderRadius: 6, fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap',
        wordBreak: 'break-word', margin: 0, border: '1px solid #e2e8f0'
      }}>
        {manual.conteudo}
      </pre>
    </div>
  );
}
