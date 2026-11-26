import { useCallback, useEffect, useState } from 'react';
import { dataBr, familiaGet, familiaMutation, listaDados, mensagemErro, moeda } from './familiaApi';
import { BotoesAcao, Carregando, ConfirmarExclusao, ErroDados, Modal, Painel, Seletor, Vazio } from './FamiliaUi';

const configs = {
  contas: {
    singular: 'conta', titulo: 'Contas',
    colunas: ['nome', 'tipo', 'saldo_inicial'],
    vazio: { nome: '', tipo: 'corrente', saldo_inicial: 0, cor: '#168a78', ativo: true },
    campos: [
      ['nome', 'Nome da conta', 'text', true],
      ['tipo', 'Tipo', 'select', false, ['corrente', 'poupanca', 'corretora', 'dinheiro']],
      ['saldo_inicial', 'Saldo inicial (R$)', 'number'], ['cor', 'Cor', 'color']
    ]
  },
  cartoes: {
    singular: 'cartão', titulo: 'Cartões',
    colunas: ['nome', 'limite', 'dia_fechamento'],
    vazio: { nome: '', bandeira: '', limite: '', dia_fechamento: '', dia_vencimento: '', conta_pagamento_id: '' },
    campos: [
      ['nome', 'Nome do cartão', 'text', true], ['bandeira', 'Bandeira', 'text'], ['limite', 'Limite (R$)', 'number'],
      ['dia_fechamento', 'Dia fechamento', 'number'], ['dia_vencimento', 'Dia vencimento', 'number'],
      ['conta_pagamento_id', 'Conta de pagamento', 'entidade', false, 'contas']
    ]
  },
  categorias: {
    singular: 'categoria', titulo: 'Categorias',
    colunas: ['nome', 'tipo'],
    vazio: { nome: '', tipo: 'despesa', cor: '#168a78' },
    campos: [
      ['nome', 'Nome', 'text', true], ['tipo', 'Tipo', 'select', false, ['despesa', 'receita']],
      ['cor', 'Cor', 'color'], ['icone', 'Ícone', 'text']
    ]
  }
};

function CadastroModal({ entidade, registro, cadastros, onClose, onSalvo }) {
  const config = configs[entidade];
  const [campos, setCampos] = useState({ ...config.vazio, ...(registro || {}) });
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  async function salvar(e) {
    e.preventDefault(); setErro(''); setSalvando(true);
    try {
      await familiaMutation(registro?.id ? 'put' : 'post', `/${entidade}${registro?.id ? `/${registro.id}` : ''}`, campos);
      onSalvo();
    } catch (err) { setErro(mensagemErro(err)); }
    finally { setSalvando(false); }
  }
  return <Modal titulo={`${registro?.id ? 'Editar' : 'Nova'} ${config.singular}`} onClose={onClose}>
    <form className="fam-form" onSubmit={salvar}>
      <div className="fam-duas-colunas">
        {config.campos.map(([chave, rotulo, tipo, required, opcoes]) => <label key={chave}>{rotulo}
          {tipo === 'select' ? <select required={required} value={campos[chave] ?? ''} onChange={e => setCampos(v => ({ ...v, [chave]: e.target.value }))}>{opcoes.map(o => <option key={o} value={o}>{o[0].toUpperCase() + o.slice(1)}</option>)}</select> :
            tipo === 'entidade' ? <Seletor required={required} dados={listaDados(cadastros[opcoes])} value={campos[chave]} onChange={e => setCampos(v => ({ ...v, [chave]: e.target.value }))} /> :
              <input required={required} type={tipo} step={tipo === 'number' ? '0.01' : undefined} min={tipo === 'number' ? 0 : undefined} value={campos[chave] ?? ''} onChange={e => setCampos(v => ({ ...v, [chave]: e.target.value }))} />}
        </label>)}
      </div>
      {erro && <div className="familia-alerta erro">{erro}</div>}
      <footer><button type="button" className="familia-botao secundario" onClick={onClose}>Cancelar</button><button className="familia-botao primario" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button></footer>
    </form>
  </Modal>;
}

function FormRecorrencia({ registro, cadastros, onClose, onSalvo }) {
  const [campos, setCampos] = useState({
    descricao: '', valor_previsto: '', tipo: 'despesa', dia_vencimento: '',
    categoria_id: '', conta_id: '', cartao_id: '', ativo: true, ...(registro || {})
  });
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const alterar = chave => e => setCampos(v => ({ ...v, [chave]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  async function salvar(e) {
    e.preventDefault(); setSalvando(true); setErro('');
    try {
      await familiaMutation(registro?.id ? 'put' : 'post', `/recorrencias${registro?.id ? `/${registro.id}` : ''}`, { ...campos, valor_previsto: Number(campos.valor_previsto) });
      onSalvo();
    } catch (err) { setErro(mensagemErro(err)); }
    finally { setSalvando(false); }
  }
  return <Modal titulo={`${registro?.id ? 'Editar' : 'Nova'} previsão / fixo`} onClose={onClose}>
    <form className="fam-form" onSubmit={salvar}>
      <label>Descrição<input autoFocus required value={campos.descricao} onChange={alterar('descricao')} /></label>
      <div className="fam-duas-colunas">
        <label>Valor previsto (R$)<input required type="number" min="0" step="0.01" value={campos.valor_previsto} onChange={alterar('valor_previsto')} /></label>
        <label>Tipo<select value={campos.tipo} onChange={alterar('tipo')}><option value="despesa">Despesa</option><option value="receita">Receita</option></select></label>
        <label>Dia de vencimento<input required type="number" min="1" max="31" value={campos.dia_vencimento} onChange={alterar('dia_vencimento')} /></label>
        <label>Conta<Seletor dados={listaDados(cadastros.contas)} value={campos.conta_id} onChange={alterar('conta_id')} /></label>
        <label>Categoria<Seletor dados={listaDados(cadastros.categorias)} value={campos.categoria_id} onChange={alterar('categoria_id')} /></label>
        <label>Cartão<Seletor dados={listaDados(cadastros.cartoes)} value={campos.cartao_id} onChange={alterar('cartao_id')} placeholder="Nenhum" /></label>
        <label className="fam-check"><input type="checkbox" checked={!!campos.ativo} onChange={alterar('ativo')} /> Recorrência ativa</label>
      </div>
      {erro && <div className="familia-alerta erro">{erro}</div>}
      <footer><button type="button" className="familia-botao secundario" onClick={onClose}>Cancelar</button><button className="familia-botao primario" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar previsão'}</button></footer>
    </form>
  </Modal>;
}

export default function Previsao({ cadastros, atualizarCadastros }) {
  const [aba, setAba] = useState('recorrencias');
  const [recorrencias, setRecorrencias] = useState(listaDados(cadastros.recorrencias));
  const [projecao, setProjecao] = useState([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');
  const [modal, setModal] = useState(null);
  const carregar = useCallback(async () => {
    setCarregando(true); setErro('');
    try {
      const [fixos, meses] = await Promise.all([familiaGet('/recorrencias'), familiaGet('/previsao')]);
      setRecorrencias(listaDados(fixos)); setProjecao(listaDados(meses));
    }
    catch (e) { setErro(mensagemErro(e)); }
    finally { setCarregando(false); }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);
  async function excluir(tipo, item) {
    if (!ConfirmarExclusao({ nome: item.descricao || item.nome })) return;
    try {
      await familiaMutation('delete', `/${tipo}/${item.id}`);
      await (tipo === 'recorrencias' ? carregar() : atualizarCadastros());
    } catch (e) { setErro(mensagemErro(e)); }
  }
  async function confirmar(item) {
    try { await familiaMutation('post', `/recorrencias/${item.id}/confirmar`, {}); await carregar(); }
    catch (e) { setErro(mensagemErro(e)); }
  }
  const entidades = listaDados(cadastros[aba]);
  return <div className="fam-coluna">
    <div className="fam-titulo-pagina"><div><p className="familia-kicker">Organização</p><h1>Previsão &amp; fixos</h1></div>
      <button className="familia-botao primario" onClick={() => setModal({ tipo: aba })}>＋ Novo {aba === 'recorrencias' ? 'fixo' : configs[aba].singular}</button>
    </div>
    <nav className="fam-subabas">
      {['recorrencias', 'contas', 'cartoes', 'categorias'].map(tipo => <button key={tipo} className={aba === tipo ? 'ativa' : ''} onClick={() => setAba(tipo)}>{tipo === 'recorrencias' ? 'Previsões' : configs[tipo].titulo}</button>)}
    </nav>
    {erro && <ErroDados texto={erro} tentarNovamente={carregar} />}
    {!!projecao.length && aba === 'recorrencias' && <Painel titulo="Projeção de 6 meses" descricao="Receitas e despesas previstas com base nos fixos ativos.">
      <div className="fam-previsao-meses">{projecao.map((mes, indice) => <div key={mes.mes || indice}>
        <span>{new Date(`${mes.mes || ''}-01T00:00:00`).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' })}</span>
        <strong className={Number(mes.receitas || 0) - Number(mes.despesas || 0) >= 0 ? 'positivo' : 'negativo'}>{moeda(Number(mes.receitas || 0) - Number(mes.despesas || 0))}</strong>
        <small><i className="positivo">+ {moeda(mes.receitas)}</i><i className="negativo">− {moeda(mes.despesas)}</i></small>
      </div>)}</div>
    </Painel>}
    <Painel titulo={aba === 'recorrencias' ? 'Compromissos recorrentes' : configs[aba].titulo} descricao={aba === 'recorrencias' ? 'Confirme um compromisso para transformá-lo em lançamento.' : undefined}>
      {carregando && aba === 'recorrencias' ? <Carregando /> : aba === 'recorrencias' ? (
        recorrencias.length ? <div className="fam-tabela"><table><thead><tr><th>Descrição</th><th>Próxima data</th><th>Frequência</th><th className="direita">Valor</th><th /></tr></thead><tbody>
          {recorrencias.map((r, i) => <tr key={r.id || i}><td><strong>{r.descricao}</strong><small>{r.ativo === false ? 'Inativa' : (r.categoria_nome || 'Ativa')}</small></td><td>{r.dia_vencimento ? `Todo dia ${r.dia_vencimento}` : dataBr(r.proximo_vencimento)}</td><td>Mensal</td><td className={`direita ${r.tipo === 'receita' ? 'positivo' : 'negativo'}`}><b>{moeda(r.valor_previsto ?? r.valor)}</b></td><td className="direita">
            <button className="familia-botao mini" disabled={r.ativo === false} onClick={() => confirmar(r)}>Confirmar</button><BotoesAcao onEditar={() => setModal({ tipo: 'recorrencias', registro: r })} onExcluir={() => excluir('recorrencias', r)} />
          </td></tr>)}
        </tbody></table></div> : <Vazio titulo="Nenhum custo fixo cadastrado" />
      ) : (
        entidades.length ? <div className="fam-tabela"><table><thead><tr>{configs[aba].colunas.map(c => <th key={c}>{c.replaceAll('_', ' ')}</th>)}<th /></tr></thead><tbody>
          {entidades.map((r, i) => <tr key={r.id || i}>{configs[aba].colunas.map(c => <td key={c}>{c.includes('saldo') || c.includes('limite') ? moeda(r[c]) : (c.includes('dia_') ? `Dia ${r[c] || '—'}` : r[c] || '—')}</td>)}<td className="direita"><BotoesAcao onEditar={() => setModal({ tipo: aba, registro: r })} onExcluir={() => excluir(aba, r)} /></td></tr>)}
        </tbody></table></div> : <Vazio titulo={`Nenhum${aba === 'categorias' || aba === 'contas' ? 'a' : ''} ${configs[aba].singular} cadastrado`} />
      )}
    </Painel>
    {modal && (modal.tipo === 'recorrencias' ?
      <FormRecorrencia registro={modal.registro} cadastros={cadastros} onClose={() => setModal(null)} onSalvo={() => { setModal(null); carregar(); atualizarCadastros(); }} /> :
      <CadastroModal entidade={modal.tipo} registro={modal.registro} cadastros={cadastros} onClose={() => setModal(null)} onSalvo={() => { setModal(null); atualizarCadastros(); }} />)}
  </div>;
}
