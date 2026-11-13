import { useEffect, useRef, useState } from 'react';
import api from '../api/api';
import AssinaturaCanvas from './AssinaturaCanvas';
import { useAuth } from '../context/AuthContext';

// Gestão da assinatura pessoal do usuário logado.
//
// A assinatura é desenhada uma única vez e fica guardada no perfil. A partir daí, todo documento
// que a pessoa emitir (hoje o termo de advertência) já sai assinado, em vez de deixar a linha em
// branco para assinar à mão.
//
// IMPORTANTE: trocar a assinatura aqui NÃO altera documentos já emitidos. Cada documento guarda
// a sua própria cópia, congelada no momento em que foi criado.
//
// Props:
//   onSalva    - callback após salvar com sucesso (ex: fechar o aviso inicial)
//   compacto   - esconde título e explicação (quando já há título no modal que o contém)
//   textoBotao - rótulo do botão de salvar
export default function MinhaAssinatura({ onSalva, compacto = false, textoBotao = 'Salvar assinatura' }) {
  const { marcarAssinaturaCriada } = useAuth();
  const [atual, setAtual] = useState(null);
  const [atualizadaEm, setAtualizadaEm] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [redesenhando, setRedesenhando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [ok, setOk] = useState('');

  // Mantém o traço em ref: o canvas avisa a cada mudança e não queremos re-renderizar
  // o componente (recriando o canvas) a cada pixel desenhado.
  const desenhoRef = useRef(null);

  useEffect(() => { carregar(); }, []);

  async function carregar() {
    setCarregando(true);
    try {
      const { data } = await api.get('/auth/minha-assinatura');
      setAtual(data.assinatura || null);
      setAtualizadaEm(data.atualizada_em || null);
      // Sem assinatura ainda: já abre direto no modo de desenho.
      setRedesenhando(!data.assinatura);
    } catch (e) {
      setErro('Não foi possível carregar a sua assinatura.');
    } finally {
      setCarregando(false);
    }
  }

  async function salvar() {
    const desenho = desenhoRef.current;
    if (!desenho) {
      setErro('Desenhe a sua assinatura no quadro antes de salvar.');
      return;
    }
    setSalvando(true);
    setErro('');
    setOk('');
    try {
      await api.put('/auth/minha-assinatura', { assinatura: desenho });
      setAtual(desenho);
      setAtualizadaEm(new Date().toISOString());
      setRedesenhando(false);
      desenhoRef.current = null;
      setOk('Assinatura salva. Os próximos documentos que você emitir já sairão assinados.');
      // Atualiza o contexto para o aviso de "cadastre sua assinatura" parar de aparecer.
      if (marcarAssinaturaCriada) marcarAssinaturaCriada();
      if (onSalva) onSalva();
    } catch (e) {
      setErro(e.response?.data?.erro || 'Não foi possível salvar a assinatura.');
    } finally {
      setSalvando(false);
    }
  }

  function formatarData(valor) {
    if (!valor) return '';
    const d = new Date(valor);
    if (isNaN(d)) return '';
    return d.toLocaleDateString('pt-BR');
  }

  if (carregando) return <p style={{ color: '#9ca3af' }}>Carregando...</p>;

  return (
    <div>
      {!compacto && (
        <>
          <h3 style={{ marginTop: 0 }}>✍️ Minha assinatura</h3>
          <p style={{ color: '#6b7280', fontSize: 13, marginTop: -6 }}>
            Usada automaticamente nos documentos que você emitir, como o termo de advertência.
          </p>
        </>
      )}

      {erro && (
        <div style={{ background: '#fee2e2', color: '#991b1b', padding: 10, borderRadius: 6, marginBottom: 10 }}>
          {erro}
        </div>
      )}
      {ok && (
        <div style={{ background: '#dcfce7', color: '#166534', padding: 10, borderRadius: 6, marginBottom: 10 }}>
          {ok}
        </div>
      )}

      {/* Assinatura já cadastrada e fora do modo de desenho: mostra a atual. */}
      {atual && !redesenhando && (
        <div>
          <div style={{
            border: '1px solid #e5e7eb', borderRadius: 6, padding: 10,
            background: '#fff', display: 'inline-block', maxWidth: '100%'
          }}>
            <img
              src={atual}
              alt="Minha assinatura"
              style={{ maxWidth: 320, maxHeight: 120, objectFit: 'contain', display: 'block' }}
            />
          </div>
          {atualizadaEm && (
            <div style={{ color: '#9ca3af', fontSize: 11, marginTop: 4 }}>
              Atualizada em {formatarData(atualizadaEm)}
            </div>
          )}
          <div style={{ marginTop: 10 }}>
            <button className="btn-secondary" onClick={() => { setRedesenhando(true); setOk(''); }}>
              Alterar assinatura
            </button>
          </div>
          <p style={{ color: '#9ca3af', fontSize: 11, marginTop: 8, maxWidth: 480 }}>
            Alterar a assinatura vale apenas para documentos futuros. Os já emitidos permanecem
            exatamente como foram assinados.
          </p>
        </div>
      )}

      {/* Modo de desenho. */}
      {redesenhando && (
        <div>
          <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>
            Desenhe a sua assinatura no quadro abaixo (use o dedo no celular ou o mouse no computador).
          </p>
          <AssinaturaCanvas onChange={valor => { desenhoRef.current = valor; }} />
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <button className="btn-success" onClick={salvar} disabled={salvando}>
              {salvando ? 'Salvando...' : `💾 ${textoBotao}`}
            </button>
            {/* Só dá para cancelar quando já existe uma assinatura anterior para manter. */}
            {atual && (
              <button
                className="btn-secondary"
                disabled={salvando}
                onClick={() => { setRedesenhando(false); desenhoRef.current = null; setErro(''); }}
              >
                Cancelar
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
