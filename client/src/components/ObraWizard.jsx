import { useState } from 'react';
import api from '../api/api';

const ITENS_TERREO_PADRAO = [
  'Estacionamento', 'Guarita', 'Piscina', 'Centro de Medição', 'Salão de Festa',
  'Reservatório Inferior', 'Reservatório Reuso', 'Reservatório Retardo'
];

const ITENS_COBERTURA_PADRAO = [
  'Banheiros', 'Cozinha Gourmet', 'Salão de Festa', 'Cobertura Descoberta'
];

// obraExistente: quando informada, o wizard entra em modo "revisão/edição" de uma obra já
// cadastrada (usado pelo botão "Revisar cadastro", restrito ao ADM): pré-preenche todos os
// passos com os dados atuais e salva com PUT em vez de POST ao finalizar.
export default function ObraWizard({ onClose, onCriada, obraExistente }) {
  const modoEdicao = !!obraExistente;
  const [passo, setPasso] = useState(1);
  const [dados, setDados] = useState(() => obraExistente ? {
    nome: obraExistente.nome || '',
    endereco: obraExistente.endereco || '',
    tem_transicao: !!obraExistente.tem_transicao,
    terreo_tipo: obraExistente.terreo_tipo || 'estacionamento',
    terreo_qtd_apto: obraExistente.terreo_qtd_apto || 0,
    fundacao_etapas: obraExistente.fundacao_etapas || 1,
    tem_atico: !!obraExistente.tem_atico,
    tem_caixa_dagua: !!obraExistente.tem_caixa_dagua,
    blocos_pavimentos: (obraExistente.blocos_pavimentos && obraExistente.blocos_pavimentos.length > 0)
      ? obraExistente.blocos_pavimentos.map(b => ({ ...b }))
      : [{ qtd_andares: 1, apto_por_andar: 4 }],
    itens_terreo: [...(obraExistente.itens_terreo || [])],
    itens_cobertura: [...(obraExistente.itens_cobertura || [])]
  } : {
    nome: '', endereco: '',
    tem_transicao: false,
    terreo_tipo: 'estacionamento',
    terreo_qtd_apto: 0,
    fundacao_etapas: 1,
    tem_atico: false,
    tem_caixa_dagua: false,
    blocos_pavimentos: [{ qtd_andares: 1, apto_por_andar: 4 }],

    itens_terreo: [],
    itens_cobertura: []
  });

  const [novoItemTerreo, setNovoItemTerreo] = useState('');
  const [novoItemCobertura, setNovoItemCobertura] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  function alterar(campo, valor) {
    setDados(d => ({ ...d, [campo]: valor }));
  }

  function alterarBloco(idx, campo, valor) {
    const blocos = [...dados.blocos_pavimentos];
    blocos[idx] = { ...blocos[idx], [campo]: Number(valor) };
    setDados(d => ({ ...d, blocos_pavimentos: blocos }));
  }

  function addBloco() {
    setDados(d => ({ ...d, blocos_pavimentos: [...d.blocos_pavimentos, { qtd_andares: 1, apto_por_andar: 4 }] }));
  }

  function removerBloco(idx) {
    setDados(d => ({ ...d, blocos_pavimentos: d.blocos_pavimentos.filter((_, i) => i !== idx) }));
  }

  function toggleItemTerreo(item) {
    setDados(d => ({
      ...d,
      itens_terreo: d.itens_terreo.includes(item) ? d.itens_terreo.filter(i => i !== item) : [...d.itens_terreo, item]
    }));
  }

  function toggleItemCobertura(item) {
    setDados(d => ({
      ...d,
      itens_cobertura: d.itens_cobertura.includes(item) ? d.itens_cobertura.filter(i => i !== item) : [...d.itens_cobertura, item]
    }));
  }

  function addItemPersonalizadoTerreo() {
    if (!novoItemTerreo.trim()) return;
    toggleItemTerreo(novoItemTerreo.trim());
    setNovoItemTerreo('');
  }

  function addItemPersonalizadoCobertura() {
    if (!novoItemCobertura.trim()) return;
    toggleItemCobertura(novoItemCobertura.trim());
    setNovoItemCobertura('');
  }

  async function finalizar() {
    setErro('');
    if (!dados.nome.trim()) { setErro('Informe o nome da obra'); setPasso(1); return; }
    setSalvando(true);
    try {
      if (modoEdicao) {
        await api.put(`/obras/${obraExistente.id}`, dados);
      } else {
        await api.post('/obras', dados);
      }
      onCriada();
    } catch (err) {
      setErro(err.response?.data?.erro || (modoEdicao ? 'Erro ao salvar alterações da obra' : 'Erro ao criar obra'));
    } finally {
      setSalvando(false);
    }
  }

  const totalPassos = 5;

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ width: 640 }}>
        <div className="flex" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>{modoEdicao ? `Revisar cadastro — Passo ${passo} de ${totalPassos}` : `Nova Obra — Passo ${passo} de ${totalPassos}`}</h3>
          <button className="btn-secondary btn-sm" onClick={onClose}>Fechar</button>
        </div>

        {modoEdicao && (
          <div style={{ background: '#fef3c7', color: '#92400e', padding: 8, borderRadius: 6, marginBottom: 10, fontSize: 12 }}>
            ⚠️ Atenção: alterar blocos de pavimentos ou itens do térreo/cobertura de uma obra que já possui
            marcações/medições lançadas pode desalinhar dados já registrados no desenho do prédio. Revise com cuidado antes de salvar.
          </div>
        )}

        {erro && <div style={{ background: '#fee2e2', color: '#991b1b', padding: 8, borderRadius: 6, marginBottom: 10 }}>{erro}</div>}

        {passo === 1 && (
          <div className="flex-col gap-2">
            <label>Nome da obra</label>
            <input value={dados.nome} onChange={e => alterar('nome', e.target.value)} autoFocus />
            <label>Endereço</label>
            <input value={dados.endereco} onChange={e => alterar('endereco', e.target.value)} />
            <label style={{ marginTop: 8 }}>
              <input type="checkbox" checked={dados.tem_transicao} onChange={e => alterar('tem_transicao', e.target.checked)} /> Tem transição (pilares/viga de transição)
            </label>
          </div>
        )}

        {passo === 2 && (
          <div className="flex-col gap-2">
            <label>No térreo tem:</label>
            <select value={dados.terreo_tipo} onChange={e => alterar('terreo_tipo', e.target.value)}>
              <option value="estacionamento">Estacionamento</option>
              <option value="apartamento">Apartamento</option>
            </select>
            {dados.terreo_tipo === 'apartamento' && (
              <>
                <label>Quantidade de apartamentos no térreo</label>
                <input type="number" min={0} value={dados.terreo_qtd_apto} onChange={e => alterar('terreo_qtd_apto', Number(e.target.value))} />
              </>
            )}
            <label style={{ marginTop: 8 }}>Fundação — quantidade de etapas</label>
            <input type="number" min={1} value={dados.fundacao_etapas} onChange={e => alterar('fundacao_etapas', Number(e.target.value))} />
            <label style={{ marginTop: 8 }}>
              <input type="checkbox" checked={dados.tem_atico} onChange={e => alterar('tem_atico', e.target.checked)} /> Tem ático
            </label>
            <label>
              <input type="checkbox" checked={dados.tem_caixa_dagua} onChange={e => alterar('tem_caixa_dagua', e.target.checked)} /> Tem caixa d'água
            </label>
            <div style={{ marginTop: 8, fontSize: 12, color: '#6b7280' }}>
              A numeração dos apartamentos é gerada automaticamente com base na quantidade de apartamentos
              por andar de cada bloco (ex: 8 aptos/andar → 11 a 18, 91 a 98, 101 a 108...; 17 aptos/andar →
              101 a 117, 901 a 917, 1001 a 1017...).
            </div>
          </div>
        )}



        {passo === 3 && (
          <div className="flex-col gap-2">
            <label>Blocos de pavimentos diferentes</label>
            <div style={{ color: '#6b7280', fontSize: 12, marginBottom: 6 }}>
              Ex: 6 andares com 8 apartamentos cada + 4 andares com 6 apartamentos cada = 2 blocos
            </div>
            {dados.blocos_pavimentos.map((b, idx) => (
              <div key={idx} className="flex gap-2" style={{ alignItems: 'end', marginBottom: 6 }}>
                <div className="flex-col gap-2">
                  <label style={{ fontSize: 12 }}>Qtd. de andares</label>
                  <input type="number" min={1} value={b.qtd_andares} onChange={e => alterarBloco(idx, 'qtd_andares', e.target.value)} style={{ width: 100 }} />
                </div>
                <div className="flex-col gap-2">
                  <label style={{ fontSize: 12 }}>Aptos por andar</label>
                  <input type="number" min={1} value={b.apto_por_andar} onChange={e => alterarBloco(idx, 'apto_por_andar', e.target.value)} style={{ width: 100 }} />
                </div>
                {dados.blocos_pavimentos.length > 1 && (
                  <button type="button" className="btn-danger btn-sm" onClick={() => removerBloco(idx)}>Remover</button>
                )}
              </div>
            ))}
            <button type="button" className="btn-secondary btn-sm" onClick={addBloco} style={{ width: 160 }}>+ Adicionar bloco</button>
          </div>
        )}

        {passo === 4 && (
          <div className="flex-col gap-2">
            <label>Itens do térreo</label>
            {ITENS_TERREO_PADRAO.map(item => (
              <label key={item}>
                <input type="checkbox" checked={dados.itens_terreo.includes(item)} onChange={() => toggleItemTerreo(item)} /> {item}
              </label>
            ))}
            {dados.itens_terreo.filter(i => !ITENS_TERREO_PADRAO.includes(i)).map(item => (
              <label key={item}>
                <input type="checkbox" checked={true} onChange={() => toggleItemTerreo(item)} /> {item} (personalizado)
              </label>
            ))}
            <div className="flex gap-2" style={{ marginTop: 8 }}>
              <input placeholder="Personalizar (novo item)" value={novoItemTerreo} onChange={e => setNovoItemTerreo(e.target.value)} />
              <button type="button" className="btn-secondary btn-sm" onClick={addItemPersonalizadoTerreo}>Adicionar</button>
            </div>
          </div>
        )}

        {passo === 5 && (
          <div className="flex-col gap-2">
            <label>A obra tem cobertura?</label>
            {ITENS_COBERTURA_PADRAO.map(item => (
              <label key={item}>
                <input type="checkbox" checked={dados.itens_cobertura.includes(item)} onChange={() => toggleItemCobertura(item)} /> {item}
              </label>
            ))}
            {dados.itens_cobertura.filter(i => !ITENS_COBERTURA_PADRAO.includes(i)).map(item => (
              <label key={item}>
                <input type="checkbox" checked={true} onChange={() => toggleItemCobertura(item)} /> {item} (personalizado)
              </label>
            ))}
            <div className="flex gap-2" style={{ marginTop: 8 }}>
              <input placeholder="Personalizar (novo item)" value={novoItemCobertura} onChange={e => setNovoItemCobertura(e.target.value)} />
              <button type="button" className="btn-secondary btn-sm" onClick={addItemPersonalizadoCobertura}>Adicionar</button>
            </div>
          </div>
        )}

        <div className="flex gap-2" style={{ marginTop: 20, justifyContent: 'space-between' }}>
          <button className="btn-secondary" disabled={passo === 1} onClick={() => setPasso(p => p - 1)}>Voltar</button>
          {passo < totalPassos ? (
            <button className="btn-primary" onClick={() => setPasso(p => p + 1)}>Avançar</button>
          ) : (
            <button className="btn-success" disabled={salvando} onClick={finalizar}>
              {salvando ? 'Salvando...' : (modoEdicao ? 'Salvar alterações' : 'Criar obra')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
