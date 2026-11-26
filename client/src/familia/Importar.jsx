import { useRef, useState } from 'react';
import { familiaMutation, listaDados, mensagemErro, moeda } from './familiaApi';
import { Modal, Painel, Vazio } from './FamiliaUi';

export default function Importar({ cadastros, onImportado }) {
  const input = useRef(null);
  const [arquivo, setArquivo] = useState(null);
  const [arrastando, setArrastando] = useState(false);
  const [previa, setPrevia] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');
  const [ok, setOk] = useState('');
  const [conta, setConta] = useState('');

  function escolherArquivo(file) {
    setErro(''); setOk(''); setPrevia(null);
    if (!file) return;
    const extensao = file.name.split('.').pop()?.toLowerCase();
    if (!['csv', 'ofx', 'pdf'].includes(extensao)) {
      setErro('Formato não suportado. Envie um arquivo CSV, OFX ou PDF.'); return;
    }
    if (file.size > 15 * 1024 * 1024) { setErro('O arquivo deve ter no máximo 15 MB.'); return; }
    setArquivo(file);
  }
  async function gerarPrevia() {
    if (!arquivo) return;
    setEnviando(true); setErro(''); setOk('');
    const corpo = new FormData();
    corpo.append('arquivo', arquivo);
    if (conta) corpo.append('conta_id', conta);
    try { setPrevia(await familiaMutation('post', '/importar/previa', corpo, { headers: { 'Content-Type': 'multipart/form-data' } })); }
    catch (e) { setErro(mensagemErro(e, 'Não foi possível analisar o arquivo.')); }
    finally { setEnviando(false); }
  }
  async function confirmar() {
    if (!previa) return;
    setEnviando(true); setErro('');
    const corpo = { ...previa, itens: listaDados(previa.items || previa.itens || previa.lancamentos).map(item => ({
      ...item, ...(conta ? { conta_id: Number(conta) } : {})
    })) };
    try {
      const resultado = await familiaMutation('post', '/importar/confirmar', corpo);
      setOk(`${resultado?.criados ?? resultado?.importados ?? itens.length} lançamento(s) importado(s) com sucesso.`);
      setPrevia(null); setArquivo(null); if (input.current) input.current.value = '';
      onImportado?.();
    } catch (e) { setErro(mensagemErro(e)); }
    finally { setEnviando(false); }
  }
  const itens = listaDados(previa?.lancamentos || previa?.movimentacoes || previa?.items || previa?.itens || previa);
  function atualizarItem(indice, campo, valor) {
    setPrevia(atual => {
      const novos = [...itens];
      novos[indice] = { ...novos[indice], [campo]: valor };
      return { ...atual, itens: novos };
    });
  }
  return <div className="fam-coluna">
    <div className="fam-titulo-pagina"><div><p className="familia-kicker">Automação</p><h1>Importar extrato</h1></div></div>
    <div className="fam-grid-importar">
      <Painel titulo="1. Envie seu arquivo" descricao="Arquivos CSV, OFX ou PDF de até 15 MB.">
        <div className={`fam-dropzone ${arrastando ? 'arrastando' : ''}`} onDragOver={e => { e.preventDefault(); setArrastando(true); }} onDragLeave={() => setArrastando(false)} onDrop={e => { e.preventDefault(); setArrastando(false); escolherArquivo(e.dataTransfer.files[0]); }}>
          <span>⇧</span><strong>{arquivo ? arquivo.name : 'Arraste seu extrato aqui'}</strong>
          <p>{arquivo ? `${(arquivo.size / 1024).toFixed(0)} KB · pronto para análise` : 'ou escolha um arquivo no seu dispositivo'}</p>
          <button type="button" className="familia-botao secundario" onClick={() => input.current?.click()}>Escolher arquivo</button>
          <input ref={input} hidden type="file" accept=".csv,.ofx,.pdf,text/csv,application/pdf,application/x-ofx" onChange={e => escolherArquivo(e.target.files[0])}/>
        </div>
        <label className="fam-campo-conta">Conta de destino (opcional)<select value={conta} onChange={e => setConta(e.target.value)}><option value="">Detectar pelo arquivo</option>{listaDados(cadastros.contas).map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></label>
        <button className="familia-botao primario fam-largura-total" disabled={!arquivo || enviando} onClick={gerarPrevia}>{enviando ? 'Analisando…' : 'Analisar arquivo'}</button>
      </Painel>
      <Painel titulo="Como funciona" descricao="Mais praticidade, com você no controle.">
        <ol className="fam-passos"><li><span>1</span><div><b>Escolha o extrato</b><p>Faça o download diretamente no site ou aplicativo do seu banco.</p></div></li><li><span>2</span><div><b>Revise a prévia</b><p>Você confere data, descrição, valor e categorização antes de importar.</p></div></li><li><span>3</span><div><b>Confirme a importação</b><p>Somente depois da confirmação os lançamentos entram no sistema.</p></div></li></ol>
        <div className="fam-nota-seguranca">✓ Seus arquivos são usados apenas para gerar a prévia e não substituem seus dados existentes.</div>
      </Painel>
    </div>
    {erro && <div className="familia-alerta erro">{erro}</div>}
    {ok && <div className="familia-alerta sucesso">{ok}</div>}
    {previa && <Modal titulo="Prévia da importação" onClose={() => setPrevia(null)} amplo>
      <div className="fam-importar-resumo"><span><strong>{itens.length}</strong> movimentos encontrados</span><span><strong>{itens.filter(i => i.tipo === 'despesa' || (!i.tipo && Number(i.valor) < 0)).length}</strong> despesas</span><span><strong>{itens.filter(i => i.tipo === 'receita' || (!i.tipo && Number(i.valor) > 0)).length}</strong> receitas</span></div>
      {itens.length ? <div className="fam-tabela fam-previa-tabela"><table><thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Tipo</th><th className="direita">Valor</th></tr></thead><tbody>{itens.map((i, n) => <tr key={i.id || n}><td>{String(i.data || i.vencimento || '').slice(0, 10).split('-').reverse().join('/')}</td><td>{i.descricao || i.historico}</td><td><select value={i.categoria_id || ''} onChange={e => atualizarItem(n, 'categoria_id', e.target.value)}><option value="">A categorizar</option>{listaDados(cadastros.categorias).filter(c => !c.tipo || c.tipo === i.tipo).map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></td><td><span className={`fam-status ${i.tipo === 'receita' ? 'confirmado' : 'pendente'}`}>{i.tipo || 'Despesa'}</span></td><td className={`direita ${i.tipo === 'receita' ? 'positivo' : 'negativo'}`}>{moeda(Math.abs(Number(i.valor)))}</td></tr>)}</tbody></table></div> : <Vazio titulo="Nenhum movimento reconhecido" texto="Confira o arquivo e tente novamente." />}
      <footer className="fam-modal-rodape"><p>Revise os movimentos antes de confirmar.</p><button className="familia-botao secundario" onClick={() => setPrevia(null)}>Cancelar</button><button className="familia-botao primario" disabled={!itens.length || enviando} onClick={confirmar}>{enviando ? 'Importando…' : `Importar ${itens.length}`}</button></footer>
    </Modal>}
  </div>;
}
