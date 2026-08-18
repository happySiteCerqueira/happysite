import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../api/api';
import { useAuth } from '../context/AuthContext';
import PredioDesenho from '../components/PredioDesenho';
import ObraWizard from '../components/ObraWizard';
import { gerarListaCelulas } from '../utils/celulasPredio';

function mesAtual() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function ObraDetalhe() {
  const { id } = useParams();
  const { temPermissao } = useAuth();
  const [obra, setObra] = useState(null);
  const [servicoAtivoId, setServicoAtivoId] = useState(null);
  const [pessoasLiberadas, setPessoasLiberadas] = useState([]);
  const [todasPessoas, setTodasPessoas] = useState([]);
  const [grupos, setGrupos] = useState([]);
  const [marcacoes, setMarcacoes] = useState({});
  const [mes, setMes] = useState(mesAtual());
  const [celulaSelecionada, setCelulaSelecionada] = useState(null);
  const [quantidadeModalCelula, setQuantidadeModalCelula] = useState('');

  const [mostrarConfigServico, setMostrarConfigServico] = useState(false);
  const [recalculando, setRecalculando] = useState(false);

  const [importandoPrecos, setImportandoPrecos] = useState(false);
  const [novoGrupoNome, setNovoGrupoNome] = useState('');
  const [mostrarEditarServicos, setMostrarEditarServicos] = useState(false);
  const [servicosPadrao, setServicosPadrao] = useState([]);
  const [selecaoServicos, setSelecaoServicos] = useState(new Set());
  const [novoServicoNome, setNovoServicoNome] = useState('');
  const [salvandoServicos, setSalvandoServicos] = useState(false);
  const [avisoServicos, setAvisoServicos] = useState('');
  const [ordemAbas, setOrdemAbas] = useState([]); // lista de ids na ordem exibida (para drag-and-drop)
  const [arrastandoId, setArrastandoId] = useState(null);
  const [sobreId, setSobreId] = useState(null);
  const [mostrarRevisaoObra, setMostrarRevisaoObra] = useState(false);

  // ---- Tela de Quantidades (quantidade cadastrada por célula, base do cálculo de valor) ----
  const [mostrarQuantidades, setMostrarQuantidades] = useState(false);
  const [listaCelulasQtd, setListaCelulasQtd] = useState([]);
  const [quantidadesMapa, setQuantidadesMapa] = useState({});
  const [importandoQuantidades, setImportandoQuantidades] = useState(false);
  // etapa do fluxo dentro do modal: 'inicio' (importar/manual) -> 'individual' | 'grupo'
  const [etapaQuantidades, setEtapaQuantidades] = useState('inicio');
  const [selecaoGrupoQtd, setSelecaoGrupoQtd] = useState(new Set()); // células marcadas p/ aplicar quantidade em lote
  const [valorGrupoQtd, setValorGrupoQtd] = useState('');
  const [aplicandoGrupoQtd, setAplicandoGrupoQtd] = useState(false);
  const [celulaReplicando, setCelulaReplicando] = useState(null); // key da célula com popover de replicar aberto
  const [andarDestinoReplicar, setAndarDestinoReplicar] = useState('');
  const [replicando, setReplicando] = useState(false);

  // ---- Rótulos customizados de apartamento (por OBRA, compartilhado entre todas as abas) ----
  const [rotulosAptos, setRotulosAptos] = useState({});
  const [mostrarAlterarNome, setMostrarAlterarNome] = useState(false);
  const [novoNomeApto, setNovoNomeApto] = useState('');
  const [salvandoNome, setSalvandoNome] = useState(false);

  // ---- Definir quantidade em vários andares (atalho direto do desenho) ----
  const [mostrarQtdVariosAndares, setMostrarQtdVariosAndares] = useState(false);
  const [valorQtdVariosAndares, setValorQtdVariosAndares] = useState('');
  const [andaresSelecionadosQtd, setAndaresSelecionadosQtd] = useState(new Set());
  const [aplicandoQtdVariosAndares, setAplicandoQtdVariosAndares] = useState(false);

  function carregarObra() {
    api.get(`/obras/${id}`).then(res => {
      setObra(res.data);
      setOrdemAbas((res.data.servicos || []).map(s => s.id));
      if (!servicoAtivoId && res.data.servicos?.length) setServicoAtivoId(res.data.servicos[0].id);
    });
    api.get(`/obras/${id}/rotulos-aptos`).then(res => setRotulosAptos(res.data || {}));
  }
  useEffect(carregarObra, [id]);


  function iniciarArraste(servicoId) {
    setArrastandoId(servicoId);
  }

  function passarSobre(e, servicoId) {
    e.preventDefault();
    if (servicoId !== sobreId) setSobreId(servicoId);
  }

  function soltarAba(e, servicoIdDestino) {
    e.preventDefault();
    setSobreId(null);
    if (!arrastandoId || arrastandoId === servicoIdDestino) { setArrastandoId(null); return; }
    setOrdemAbas(prev => {
      const nova = prev.slice();
      const origemIdx = nova.indexOf(arrastandoId);
      const destinoIdx = nova.indexOf(servicoIdDestino);
      if (origemIdx === -1 || destinoIdx === -1) return prev;
      nova.splice(origemIdx, 1);
      nova.splice(destinoIdx, 0, arrastandoId);
      api.put(`/obras/${id}/servicos/reordenar`, { ids: nova }).catch(() => {});
      return nova;
    });
    setArrastandoId(null);
  }

  useEffect(() => {
    api.get('/colaboradores').then(res => setTodasPessoas(res.data));
  }, []);

  useEffect(() => {
    if (!servicoAtivoId) return;
    api.get(`/obras/servicos/${servicoAtivoId}/pessoas`).then(res => setPessoasLiberadas(res.data));
    carregarGrupos();
    carregarCelulas();
    // Carrega as quantidades já cadastradas para este serviço, mesmo sem abrir o modal de
    // Quantidades, pois o desenho usa esse mapa para pintar em cinza-pendência as células
    // ainda sem quantidade definida.
    api.get(`/obras/servicos/${servicoAtivoId}/quantidades`).then(res => setQuantidadesMapa(res.data || {}));
  }, [servicoAtivoId, mes]);

  function carregarGrupos() {
    if (!servicoAtivoId) return;
    api.get(`/obras/servicos/${servicoAtivoId}/grupos`).then(res => setGrupos(res.data));
  }

  function carregarCelulas() {
    if (!servicoAtivoId) return;
    api.get(`/obras/servicos/${servicoAtivoId}/celulas`, { params: { mes } }).then(res => {
      const map = {};
      res.data.forEach(c => {
        // Se já houver uma marcação nessa célula (modo grupo grava várias linhas), guarda a primeira
        // e acumula os membros do grupo para exibir no tooltip/cor.
        if (!map[c.celula_key]) map[c.celula_key] = { ...c, membrosGrupo: [] };
        if (c.grupo_id) map[c.celula_key].membrosGrupo.push(c.colaborador_id);
      });
      setMarcacoes(map);
    });
  }

  const servicoAtivo = obra?.servicos?.find(s => s.id === servicoAtivoId);
  const pessoasPorId = {};
  todasPessoas.forEach(p => { pessoasPorId[p.id] = p; });

  function abrirSelecaoPessoa(celulaKey) {
    if (!temPermissao('ENGENHEIRO', 'MESTRE', 'RH')) return;
    setCelulaSelecionada(celulaKey);
    const qtdAtual = quantidadesMapa[celulaKey];
    setQuantidadeModalCelula(qtdAtual != null ? String(qtdAtual) : '');
  }


  // Se o usuário alterou o campo de quantidade dentro do modal "Quem executou", envia esse valor
  // junto na marcação e também persiste na tabela de quantidades (mantém quantidadesMapa em dia).
  async function salvarQuantidadeModalSeAlterada() {
    if (quantidadeModalCelula === '' || quantidadeModalCelula == null) return undefined;
    const valor = Number(quantidadeModalCelula);
    if (isNaN(valor)) return undefined;
    await api.put(`/obras/servicos/${servicoAtivoId}/quantidades`, { celula_key: celulaSelecionada, quantidade: valor });
    setQuantidadesMapa(prev => ({ ...prev, [celulaSelecionada]: valor }));
    return valor;
  }

  async function marcarPessoa(colaboradorId) {
    const quantidade = await salvarQuantidadeModalSeAlterada();
    await api.post(`/obras/servicos/${servicoAtivoId}/celulas`, {
      celula_key: celulaSelecionada,
      colaborador_id: colaboradorId,
      mes_ciclo: mes,
      ...(quantidade !== undefined ? { quantidade } : {})
      // sem "quantidade": o backend usa a quantidade cadastrada nessa célula (tela Quantidades),
      // ou 1 se nenhuma tiver sido definida ainda.
    });
    setCelulaSelecionada(null);
    carregarCelulas();
  }

  async function marcarGrupo(grupoId) {
    const quantidade = await salvarQuantidadeModalSeAlterada();
    await api.post(`/obras/servicos/${servicoAtivoId}/celulas`, {
      celula_key: celulaSelecionada,
      grupo_id: grupoId,
      mes_ciclo: mes,
      ...(quantidade !== undefined ? { quantidade } : {})
    });
    setCelulaSelecionada(null);
    carregarCelulas();
  }


  async function desmarcar() {
    await api.post(`/obras/servicos/${servicoAtivoId}/celulas`, {
      celula_key: celulaSelecionada,
      colaborador_id: null,
      mes_ciclo: mes
    });
    setCelulaSelecionada(null);
    carregarCelulas();
  }

  async function vincularPessoa(colaboradorId) {
    await api.post(`/obras/servicos/${servicoAtivoId}/pessoas`, { colaborador_id: colaboradorId });
    api.get(`/obras/servicos/${servicoAtivoId}/pessoas`).then(res => setPessoasLiberadas(res.data));
  }

  async function desvincularPessoa(colaboradorId) {
    await api.delete(`/obras/servicos/${servicoAtivoId}/pessoas/${colaboradorId}`);
    api.get(`/obras/servicos/${servicoAtivoId}/pessoas`).then(res => setPessoasLiberadas(res.data));
  }

  async function salvarConfigServico(campo, valor) {
    await api.put(`/obras/servicos/${servicoAtivoId}`, { [campo]: valor });
    carregarObra();
  }

  // Recalcula (retroativamente) o valor de TODAS as marcações já lançadas neste serviço,
  // usando o valor unitário ATUAL. Útil quando o valor foi alterado depois de já existirem
  // marcações lançadas com o valor antigo (ex: serviço estava com R$ 0,00 no momento da marcação).
  async function recalcularValores() {
    if (!confirm(`Recalcular os valores de TODAS as marcações já lançadas em "${servicoAtivo.nome}" (todos os meses), usando o valor unitário atual (R$ ${servicoAtivo.valor_unitario})?`)) return;
    setRecalculando(true);
    try {
      const res = await api.post(`/obras/servicos/${servicoAtivoId}/recalcular-valores`, {});
      alert(`${res.data.atualizados} marcação(ões) recalculada(s) com sucesso.`);
      carregarCelulas();
    } catch (err) {
      alert(err.response?.data?.erro || 'Erro ao recalcular valores');
    }
    setRecalculando(false);
  }


  async function removerServico(servicoId, nome) {
    if (!confirm(`Remover a aba de serviço "${nome}" desta obra? Isso apagará todas as marcações feitas nela.`)) return;
    try {
      await api.delete(`/obras/servicos/${servicoId}`);
      if (servicoAtivoId === servicoId) setServicoAtivoId(null);
      carregarObra();
    } catch (err) {
      alert(err.response?.data?.erro || 'Erro ao remover serviço');
    }
  }

  async function abrirEditarServicos() {
    setAvisoServicos('');
    const [resPadrao] = await Promise.all([api.get('/obras/servicos-padrao')]);
    setServicosPadrao(resPadrao.data);
    const nomesAtuais = new Set((obra.servicos || []).map(s => s.nome));
    setSelecaoServicos(nomesAtuais);
    setNovoServicoNome('');
    setMostrarEditarServicos(true);
  }

  function alternarSelecaoServico(nome) {
    setSelecaoServicos(prev => {
      const novo = new Set(prev);
      if (novo.has(nome)) novo.delete(nome); else novo.add(nome);
      return novo;
    });
  }

  function adicionarServicoPersonalizado() {
    const nome = novoServicoNome.trim();
    if (!nome) return;
    setSelecaoServicos(prev => new Set(prev).add(nome));
    setNovoServicoNome('');
  }

  async function salvarServicosEmLote() {
    setSalvandoServicos(true);
    setAvisoServicos('');
    try {
      const res = await api.put(`/obras/${id}/servicos-em-lote`, { nomes: Array.from(selecaoServicos) });
      if (res.data.bloqueados?.length) {
        setAvisoServicos(`Não foi possível remover: ${res.data.bloqueados.join(', ')} — já possuem lançamentos. Marque-os novamente na lista.`);
        setSelecaoServicos(prev => {
          const novo = new Set(prev);
          res.data.bloqueados.forEach(n => novo.add(n));
          return novo;
        });
      } else {
        setMostrarEditarServicos(false);
      }
      carregarObra();
    } catch (err) {
      setAvisoServicos(err.response?.data?.erro || 'Erro ao salvar serviços');
    }
    setSalvandoServicos(false);
  }

  async function criarGrupo() {
    if (!novoGrupoNome.trim()) return;
    await api.post(`/obras/servicos/${servicoAtivoId}/grupos`, { nome_grupo: novoGrupoNome.trim() });
    setNovoGrupoNome('');
    carregarGrupos();
  }

  async function excluirGrupo(grupoId) {
    if (!confirm('Excluir este grupo?')) return;
    await api.delete(`/obras/grupos/${grupoId}`);
    carregarGrupos();
  }

  async function alternarMembroGrupo(grupoId, colaboradorId, jaEsta) {
    if (jaEsta) {
      await api.delete(`/obras/grupos/${grupoId}/membros/${colaboradorId}`);
    } else {
      await api.post(`/obras/grupos/${grupoId}/membros`, { colaborador_id: colaboradorId });
    }
    carregarGrupos();
  }

  async function exportarPrecos() {
    const res = await api.get(`/obras/${id}/precos/exportar`, { responseType: 'blob' });
    const url = window.URL.createObjectURL(new Blob([res.data]));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `precos-${obra.nome.replace(/[^a-z0-9]/gi, '_')}.xlsx`);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  }

  async function importarPrecos(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportandoPrecos(true);
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = reader.result.split(',')[1];
        const res = await api.post(`/obras/${id}/precos/importar`, { arquivo_base64: base64 });
        alert(`Preços importados: ${res.data.atualizados} serviço(s) atualizado(s).${res.data.erros ? ` (${res.data.erros} linha(s) ignorada(s))` : ''}`);
        carregarObra();
        setImportandoPrecos(false);
      };
      reader.readAsDataURL(file);
    } catch (err) {
      alert(err.response?.data?.erro || 'Erro ao importar planilha');
      setImportandoPrecos(false);
    }
    e.target.value = '';
  }

  // ---- Quantidades por célula (base do cálculo de valor ao marcar quem executou) ----

  async function abrirQuantidades() {
    if (!servicoAtivo) return;
    const lista = gerarListaCelulas(obra, servicoAtivo.modo_medicao, rotulosAptos);

    setListaCelulasQtd(lista);
    const res = await api.get(`/obras/servicos/${servicoAtivoId}/quantidades`);
    setQuantidadesMapa(res.data || {});
    setEtapaQuantidades('inicio');
    setSelecaoGrupoQtd(new Set());
    setValorGrupoQtd('');
    setMostrarQuantidades(true);
  }

  function fecharQuantidades() {
    setMostrarQuantidades(false);
    setEtapaQuantidades('inicio');
  }

  function editarQuantidadeLocal(key, valor) {
    setQuantidadesMapa(prev => ({ ...prev, [key]: valor }));
  }

  async function salvarQuantidadeCelula(key) {
    const valor = Number(quantidadesMapa[key]) || 0;
    await api.put(`/obras/servicos/${servicoAtivoId}/quantidades`, { celula_key: key, quantidade: valor });
  }

  // ---- Replicar quantidade de uma célula (apartamento, pavimento ou frente/fundo) para outros
  // andares do mesmo bloco. Reconhece os 3 formatos possíveis, dependendo do modo de medição do serviço. ----
  const REGEX_APTO = /^apto-b(\d+)-a(\d+)-(\d+)$/;
  const REGEX_PAV_FRENTE_FUNDO = /^pav-b(\d+)-a(\d+)-(frente|fundo)$/;
  const REGEX_PAVIMENTO = /^pav-b(\d+)-a(\d+)$/;

  function infoReplicacao(key) {
    if (!obra) return null;
    let m = REGEX_APTO.exec(key);
    if (m) {
      const blocoIdx = Number(m[1]);
      const andarAtual = Number(m[2]);
      const bloco = (obra.blocos_pavimentos || [])[blocoIdx];
      if (!bloco) return null;
      return { blocoIdx, andarAtual, qtdAndares: bloco.qtd_andares, tipo: 'apartamento' };
    }
    m = REGEX_PAV_FRENTE_FUNDO.exec(key);
    if (m) {
      const blocoIdx = Number(m[1]);
      const andarAtual = Number(m[2]);
      const bloco = (obra.blocos_pavimentos || [])[blocoIdx];
      if (!bloco) return null;
      return { blocoIdx, andarAtual, qtdAndares: bloco.qtd_andares, tipo: 'frente_fundo' };
    }
    m = REGEX_PAVIMENTO.exec(key);
    if (m) {
      const blocoIdx = Number(m[1]);
      const andarAtual = Number(m[2]);
      const bloco = (obra.blocos_pavimentos || [])[blocoIdx];
      if (!bloco) return null;
      return { blocoIdx, andarAtual, qtdAndares: bloco.qtd_andares, tipo: 'pavimento' };
    }
    return null;
  }

  function descricaoTipoReplicacao(tipo) {
    if (tipo === 'pavimento') return 'este pavimento';
    if (tipo === 'frente_fundo') return 'este lado (frente/fundo)';
    return 'este apartamento (mesma posição/terminação)';
  }


  // ---- Alterar nome (rótulo customizado) do apartamento clicado no desenho ----
  function abrirAlterarNome() {
    if (!celulaSelecionada) return;
    setNovoNomeApto(rotulosAptos[celulaSelecionada] || '');
    setMostrarAlterarNome(true);
  }

  async function salvarNomeApto() {
    if (!celulaSelecionada || !novoNomeApto.trim()) return;
    setSalvandoNome(true);
    try {
      const res = await api.put(`/obras/${id}/rotulos-aptos`, {
        celula_key: celulaSelecionada,
        rotulo: novoNomeApto.trim()
      });
      setRotulosAptos(prev => {
        const novo = { ...prev };
        (res.data.atualizados || []).forEach(a => { novo[a.key] = a.rotulo; });
        return novo;
      });
      setMostrarAlterarNome(false);
      setCelulaSelecionada(null);
    } catch (err) {
      alert(err.response?.data?.erro || 'Erro ao alterar nome do apartamento');
    }
    setSalvandoNome(false);
  }

  // ---- Definir quantidade em vários andares (atalho direto do clique no desenho) ----
  function abrirQtdVariosAndares() {
    if (!celulaSelecionada) return;
    const qtdAtual = quantidadesMapa[celulaSelecionada];
    setValorQtdVariosAndares(qtdAtual != null ? String(qtdAtual) : '');
    setAndaresSelecionadosQtd(new Set());
    setMostrarQtdVariosAndares(true);
  }

  function alternarAndarQtd(andar) {
    setAndaresSelecionadosQtd(prev => {
      const novo = new Set(prev);
      if (novo.has(andar)) novo.delete(andar); else novo.add(andar);
      return novo;
    });
  }

  function marcarTodosAndaresQtd(qtdAndares) {
    setAndaresSelecionadosQtd(new Set(Array.from({ length: qtdAndares }, (_, i) => i)));
  }

  async function confirmarQtdVariosAndares() {
    if (!celulaSelecionada) return;
    const info = infoReplicacao(celulaSelecionada);
    if (!info) return;
    if (andaresSelecionadosQtd.size === 0) { alert('Selecione ao menos um andar.'); return; }
    const valor = Number(valorQtdVariosAndares);
    if (isNaN(valor)) { alert('Informe uma quantidade válida.'); return; }
    setAplicandoQtdVariosAndares(true);
    try {
      const res = await api.put(`/obras/servicos/${servicoAtivoId}/quantidades/aplicar-varios-andares`, {
        celula_key_origem: celulaSelecionada,
        andares_destino: Array.from(andaresSelecionadosQtd),
        quantidade: valor
      });
      setQuantidadesMapa(prev => {
        const novo = { ...prev };
        (res.data.celulas || []).forEach(k => { novo[k] = valor; });
        return novo;
      });
      setMostrarQtdVariosAndares(false);
      setCelulaSelecionada(null);
    } catch (err) {
      alert(err.response?.data?.erro || 'Erro ao aplicar quantidade em vários andares');
    }
    setAplicandoQtdVariosAndares(false);
  }


  function abrirReplicar(key) {
    setCelulaReplicando(key);
    setAndarDestinoReplicar('');
  }

  function fecharReplicar() {
    setCelulaReplicando(null);
    setAndarDestinoReplicar('');
  }

  async function confirmarReplicar() {
    if (!celulaReplicando || andarDestinoReplicar === '') return;
    setReplicando(true);
    try {
      const res = await api.put(`/obras/servicos/${servicoAtivoId}/quantidades/replicar`, {
        celula_key_origem: celulaReplicando,
        andar_destino: Number(andarDestinoReplicar)
      });
      setQuantidadesMapa(prev => {
        const novo = { ...prev };
        (res.data.celulas || []).forEach(k => { novo[k] = res.data.quantidade; });
        return novo;
      });
      fecharReplicar();
    } catch (err) {
      alert(err.response?.data?.erro || 'Erro ao replicar quantidade');
    }
    setReplicando(false);
  }


  function alternarSelecaoGrupoQtd(key) {
    setSelecaoGrupoQtd(prev => {
      const novo = new Set(prev);
      if (novo.has(key)) novo.delete(key); else novo.add(key);
      return novo;
    });
  }

  async function aplicarQuantidadeEmGrupo() {
    if (selecaoGrupoQtd.size === 0) { alert('Selecione ao menos um item da lista.'); return; }
    const valor = Number(valorGrupoQtd);
    if (isNaN(valor)) { alert('Informe uma quantidade válida.'); return; }
    setAplicandoGrupoQtd(true);
    try {
      await api.put(`/obras/servicos/${servicoAtivoId}/quantidades-em-lote`, {
        celulas: Array.from(selecaoGrupoQtd),
        quantidade: valor
      });
      setQuantidadesMapa(prev => {
        const novo = { ...prev };
        selecaoGrupoQtd.forEach(key => { novo[key] = valor; });
        return novo;
      });
      setSelecaoGrupoQtd(new Set());
      setValorGrupoQtd('');
    } catch (err) {
      alert(err.response?.data?.erro || 'Erro ao aplicar quantidade em lote');
    }
    setAplicandoGrupoQtd(false);
  }

  async function exportarQuantidades() {
    const res = await api.post(`/obras/servicos/${servicoAtivoId}/quantidades/exportar`,
      { celulas: listaCelulasQtd }, { responseType: 'blob' });
    const url = window.URL.createObjectURL(new Blob([res.data]));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `quantidades-${servicoAtivo.nome.replace(/[^a-z0-9]/gi, '_')}.xlsx`);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  }

  async function importarQuantidades(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportandoQuantidades(true);
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = reader.result.split(',')[1];
        const res = await api.post(`/obras/servicos/${servicoAtivoId}/quantidades/importar`, { arquivo_base64: base64 });
        alert(`Quantidades importadas: ${res.data.atualizados} célula(s) atualizada(s).${res.data.erros ? ` (${res.data.erros} linha(s) ignorada(s))` : ''}`);
        const res2 = await api.get(`/obras/servicos/${servicoAtivoId}/quantidades`);
        setQuantidadesMapa(res2.data || {});
        setImportandoQuantidades(false);
      };
      reader.readAsDataURL(file);
    } catch (err) {
      alert(err.response?.data?.erro || 'Erro ao importar planilha');
      setImportandoQuantidades(false);
    }
    e.target.value = '';
  }

  if (!obra) return <div>Carregando...</div>;

  return (
    <div>
      <Link to="/obras" style={{ color: '#2563eb', fontSize: 13 }}>← Voltar para Obras</Link>
      <div className="flex gap-2" style={{ alignItems: 'center', marginTop: 6 }}>
        <h2 style={{ margin: 0 }}>{obra.nome}</h2>
        {temPermissao('ADM') && (
          <button className="btn-secondary btn-sm" onClick={() => setMostrarRevisaoObra(true)} title="Revisar todas as etapas do cadastro desta obra para corrigir algum erro de preenchimento">
            🔄 Revisar cadastro
          </button>
        )}
      </div>
      <div style={{ color: '#6b7280', marginBottom: 16 }}>{obra.endereco}</div>


      {temPermissao('RH', 'ADM', 'FINANCEIRO') && (
        <div className="flex gap-2" style={{ marginBottom: 16 }}>
          <button className="btn-secondary btn-sm" onClick={exportarPrecos}>📥 Exportar planilha de preços</button>
          <label className="btn-secondary btn-sm" style={{ cursor: 'pointer', margin: 0 }}>
            {importandoPrecos ? 'Importando...' : '📤 Importar preços'}
            <input type="file" accept=".xlsx,.xls" onChange={importarPrecos} style={{ display: 'none' }} disabled={importandoPrecos} />
          </label>
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center' }}>
        {ordemAbas.map(sid => {
          const s = obra.servicos?.find(x => x.id === sid);
          if (!s) return null;
          const podeArrastar = temPermissao('RH', 'ADM', 'ENGENHEIRO', 'MESTRE');
          return (
            <button
              key={s.id}
              className={s.id === servicoAtivoId ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}
              onClick={() => setServicoAtivoId(s.id)}
              draggable={podeArrastar}
              onDragStart={() => podeArrastar && iniciarArraste(s.id)}
              onDragOver={e => podeArrastar && passarSobre(e, s.id)}
              onDrop={e => podeArrastar && soltarAba(e, s.id)}
              onDragEnd={() => { setArrastandoId(null); setSobreId(null); }}
              title={podeArrastar ? 'Arraste para reordenar' : s.nome}
              style={{
                cursor: podeArrastar ? 'grab' : 'pointer',
                opacity: arrastandoId === s.id ? 0.4 : 1,
                outline: sobreId === s.id && arrastandoId && arrastandoId !== s.id ? '2px dashed #2563eb' : undefined
              }}
            >
              {podeArrastar && <span style={{ marginRight: 4, opacity: 0.6 }}>⠿</span>}
              {s.nome}
            </button>
          );
        })}
        {temPermissao('RH', 'ADM') && (
          <button className="btn-secondary btn-sm" title="Escolher quais serviços esta obra deve ter" onClick={abrirEditarServicos}>
            ✏️ Editar serviços desta obra
          </button>
        )}
      </div>

      {servicoAtivo && (
        <div className="card">
          <div className="flex gap-2" style={{ alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
            <strong>{servicoAtivo.nome}</strong>
            <span style={{ fontSize: 12, color: '#6b7280' }}>
              Medição: {servicoAtivo.modo_medicao} • Execução: {servicoAtivo.modo_execucao === 'grupo' ? 'Em grupo' : 'Individual'} • Valor unit.: R$ {servicoAtivo.valor_unitario}
            </span>
            <input type="month" value={mes} onChange={e => setMes(e.target.value)} style={{ marginLeft: 'auto' }} />
            {temPermissao('RH', 'ENGENHEIRO', 'MESTRE') && (
              <>
                <button className="btn-secondary btn-sm" onClick={() => setMostrarConfigServico(true)}>Configurar serviço</button>
                <button className="btn-secondary btn-sm" onClick={abrirQuantidades} title="Definir a quantidade (m², m³, un...) de cada apartamento/pavimento para este serviço">
                  📏 Quantidades
                </button>
              </>
            )}
          </div>

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
            <span style={{ fontSize: 12, color: '#6b7280', alignSelf: 'center' }}>Liberados para executar:</span>
            {pessoasLiberadas.map(p => (
              <span key={p.id} className="badge" style={{ background: p.cor }}>{p.nome}</span>
            ))}
            {pessoasLiberadas.length === 0 && <span style={{ fontSize: 12, color: '#9ca3af' }}>Nenhum vinculado ainda</span>}
          </div>

          <div style={{ overflowX: 'auto', paddingBottom: 10 }}>
            <PredioDesenho
              obra={obra}
              modoMedicao={servicoAtivo.modo_medicao}
              marcacoes={marcacoes}
              pessoasPorId={pessoasPorId}
              onClickCelula={abrirSelecaoPessoa}
              rotulosAptos={rotulosAptos}
              quantidadesMapa={quantidadesMapa}
            />
          </div>
        </div>
      )}

      {celulaSelecionada && (
        <div className="modal-overlay" onClick={() => setCelulaSelecionada(null)}>
          <div className="modal-content" style={{ width: 320 }} onClick={e => e.stopPropagation()}>
            <h4>Quem executou: {rotulosAptos[celulaSelecionada] || celulaSelecionada}</h4>

            {temPermissao('RH', 'ADM', 'ENGENHEIRO', 'MESTRE') && (
              <div className="flex-col gap-2" style={{ marginBottom: 10 }}>
                <label style={{ fontSize: 11, color: '#6b7280' }}>Quantidade ({servicoAtivo?.unidade || 'un'})</label>
                <input
                  type="number" step="0.01"
                  value={quantidadeModalCelula}
                  onChange={e => setQuantidadeModalCelula(e.target.value)}
                  placeholder="Usar quantidade já cadastrada"
                  style={{ width: '100%' }}
                />
              </div>
            )}

            <div className="flex-col gap-2">
              {servicoAtivo?.modo_execucao === 'grupo' ? (
                <>
                  {grupos.map(g => (
                    <button key={g.id} className="btn-secondary" onClick={() => marcarGrupo(g.id)}>
                      👥 {g.nome_grupo} ({g.membros.length} pessoa{g.membros.length !== 1 ? 's' : ''})
                    </button>
                  ))}
                  {grupos.length === 0 && <div style={{ color: '#9ca3af', fontSize: 13 }}>Nenhum grupo cadastrado ainda. Vá em "Configurar serviço".</div>}
                </>
              ) : (
                <>
                  {pessoasLiberadas.map(p => (
                    <button key={p.id} className="btn-secondary" style={{ borderLeft: `6px solid ${p.cor}` }} onClick={() => marcarPessoa(p.id)}>
                      {p.nome}
                    </button>
                  ))}
                  {pessoasLiberadas.length === 0 && <div style={{ color: '#9ca3af', fontSize: 13 }}>Nenhuma pessoa liberada para este serviço ainda. Vá em "Configurar serviço".</div>}
                </>
              )}
            </div>
            <button className="btn-danger" style={{ marginTop: 12, width: '100%' }} onClick={desmarcar}>Remover marcação</button>

            {infoReplicacao(celulaSelecionada) && temPermissao('RH', 'ADM', 'ENGENHEIRO', 'MESTRE') && (
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                {REGEX_APTO.test(celulaSelecionada) && (
                  <button className="btn-secondary btn-sm" style={{ flex: 1 }} onClick={abrirAlterarNome}>
                    ✏️ Alterar nome
                  </button>
                )}
                <button className="btn-secondary btn-sm" style={{ flex: 1 }} onClick={abrirQtdVariosAndares}>
                  🔢 Definir quantidade
                </button>
              </div>
            )}
          </div>
        </div>
      )}


      {mostrarAlterarNome && celulaSelecionada && (
        <div className="modal-overlay" onClick={() => setMostrarAlterarNome(false)}>
          <div className="modal-content" style={{ width: 340 }} onClick={e => e.stopPropagation()}>
            <h4>Alterar nome do apartamento</h4>
            <p style={{ fontSize: 12, color: '#6b7280' }}>
              Isso altera o rótulo exibido em <strong>todas as abas de serviço</strong> desta obra (é a mesma unidade física).
              Se você informar um número, os demais apartamentos deste andar e de todos os andares acima (mesmo bloco)
              serão renumerados automaticamente em sequência.
            </p>
            <input
              autoFocus
              value={novoNomeApto}
              onChange={e => setNovoNomeApto(e.target.value)}
              placeholder="Ex: 155"
              style={{ width: '100%', marginBottom: 12 }}
            />
            <div className="flex gap-2">
              <button className="btn-secondary" style={{ flex: 1 }} onClick={() => setMostrarAlterarNome(false)}>Cancelar</button>
              <button className="btn-primary" style={{ flex: 1 }} disabled={salvandoNome || !novoNomeApto.trim()} onClick={salvarNomeApto}>
                {salvandoNome ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {mostrarQtdVariosAndares && celulaSelecionada && (() => {
        const info = infoReplicacao(celulaSelecionada);
        if (!info) return null;
        return (
          <div className="modal-overlay" onClick={() => setMostrarQtdVariosAndares(false)}>
            <div className="modal-content" style={{ width: 380, maxHeight: '85vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
              <h4>Definir quantidade em vários andares</h4>
              <p style={{ fontSize: 12, color: '#6b7280' }}>
                Aplica a mesma quantidade a {descricaoTipoReplicacao(info.tipo)} em todos os andares
                marcados abaixo, dentro deste mesmo bloco.
              </p>

              <label>Quantidade ({servicoAtivo?.unidade || 'un'})</label>
              <input
                type="number" step="0.01"
                value={valorQtdVariosAndares}
                onChange={e => setValorQtdVariosAndares(e.target.value)}
                style={{ width: '100%', marginBottom: 12 }}
              />
              <div className="flex gap-2" style={{ marginBottom: 8, alignItems: 'center' }}>
                <strong style={{ fontSize: 13, flex: 1 }}>Andares deste bloco:</strong>
                <button className="btn-secondary btn-sm" onClick={() => marcarTodosAndaresQtd(info.qtdAndares)}>Marcar todos</button>
                <button className="btn-secondary btn-sm" onClick={() => setAndaresSelecionadosQtd(new Set())}>Limpar</button>
              </div>
              <div style={{ maxHeight: 220, overflow: 'auto', border: '1px solid #e5e7eb', borderRadius: 6, padding: 8 }}>
                {Array.from({ length: info.qtdAndares }, (_, i) => i).map(andar => (
                  <label key={andar} className="flex gap-2" style={{ alignItems: 'center', fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={andaresSelecionadosQtd.has(andar)}
                      onChange={() => alternarAndarQtd(andar)}
                    />
                    {andar + 1}º andar do bloco{andar === info.andarAtual ? ' (atual)' : ''}
                  </label>
                ))}
              </div>
              <div className="flex gap-2" style={{ marginTop: 12 }}>
                <button className="btn-secondary" style={{ flex: 1 }} onClick={() => setMostrarQtdVariosAndares(false)}>Cancelar</button>
                <button className="btn-primary" style={{ flex: 1 }} disabled={aplicandoQtdVariosAndares} onClick={confirmarQtdVariosAndares}>
                  {aplicandoQtdVariosAndares ? 'Aplicando...' : `Aplicar a ${andaresSelecionadosQtd.size} andar(es)`}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {mostrarConfigServico && servicoAtivo && (
        <div className="modal-overlay" onClick={() => setMostrarConfigServico(false)}>
          <div className="modal-content" style={{ width: 460, maxHeight: '85vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
            <h4>Configurar: {servicoAtivo.nome}</h4>
            <div className="flex-col gap-2" style={{ marginBottom: 12 }}>
              <label>Modo de medição</label>
              <select defaultValue={servicoAtivo.modo_medicao} onChange={e => salvarConfigServico('modo_medicao', e.target.value)}>
                <option value="apartamento">Por apartamento</option>
                <option value="pavimento">Por pavimento</option>
                <option value="frente_fundo">Frente/Fundo</option>
              </select>


              <label>Modo de execução</label>
              <select defaultValue={servicoAtivo.modo_execucao} onChange={e => salvarConfigServico('modo_execucao', e.target.value)}>
                <option value="individual">Individual (uma pessoa por vez)</option>
                <option value="grupo">Em grupo (valor dividido entre a equipe)</option>
              </select>

              <label>Valor unitário (R$)</label>
              <input type="number" step="0.01" defaultValue={servicoAtivo.valor_unitario}
                onBlur={e => salvarConfigServico('valor_unitario', Number(e.target.value))} />

              <button
                className="btn-secondary btn-sm"
                style={{ marginTop: 8 }}
                disabled={recalculando}
                onClick={recalcularValores}
                title="Recalcula os valores de todas as marcações já lançadas neste serviço, usando o valor unitário atual (útil se o valor foi alterado depois de já ter marcações lançadas)"
              >
                {recalculando ? 'Recalculando...' : '🔄 Recalcular valores já lançados'}
              </button>
            </div>


            {servicoAtivo.modo_execucao === 'grupo' && (
              <div style={{ marginBottom: 16, borderTop: '1px solid #e5e7eb', paddingTop: 12 }}>
                <h5>Grupos de execução</h5>
                <div className="flex gap-2" style={{ marginBottom: 10 }}>
                  <input placeholder="Nome do novo grupo (ex: Equipe A)" value={novoGrupoNome}
                    onChange={e => setNovoGrupoNome(e.target.value)} style={{ flex: 1 }} />
                  <button className="btn-primary btn-sm" onClick={criarGrupo}>+ Criar grupo</button>
                </div>
                {grupos.map(g => (
                  <div key={g.id} className="card" style={{ marginBottom: 8, padding: 10 }}>
                    <div className="flex gap-2" style={{ alignItems: 'center', marginBottom: 6 }}>
                      <strong style={{ flex: 1 }}>👥 {g.nome_grupo}</strong>
                      <button className="btn-danger btn-sm" onClick={() => excluirGrupo(g.id)}>Excluir</button>
                    </div>
                    <div style={{ maxHeight: 130, overflow: 'auto' }}>
                      {todasPessoas.map(p => {
                        const jaEsta = g.membros.some(m => m.id === p.id);
                        return (
                          <label key={p.id} className="flex gap-2" style={{ alignItems: 'center', fontSize: 13 }}>
                            <input type="checkbox" checked={jaEsta} onChange={() => alternarMembroGrupo(g.id, p.id, jaEsta)} />
                            <span style={{ width: 10, height: 10, background: p.cor, borderRadius: 2, display: 'inline-block' }}></span>
                            {p.nome}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
                {grupos.length === 0 && <div style={{ color: '#9ca3af', fontSize: 13 }}>Nenhum grupo criado ainda.</div>}
              </div>
            )}

            <h5>Pessoas/Empresas liberadas para este serviço</h5>
            <div className="flex-col gap-2" style={{ maxHeight: 200, overflow: 'auto' }}>
              {todasPessoas.map(p => {
                const liberado = pessoasLiberadas.some(pl => pl.id === p.id);
                return (
                  <label key={p.id} className="flex gap-2" style={{ alignItems: 'center' }}>
                    <input type="checkbox" checked={liberado} onChange={() => liberado ? desvincularPessoa(p.id) : vincularPessoa(p.id)} />
                    <span style={{ width: 12, height: 12, background: p.cor, borderRadius: 3, display: 'inline-block' }}></span>
                    {p.nome}
                  </label>
                );
              })}
            </div>
            <button className="btn-primary" style={{ marginTop: 12, width: '100%' }} onClick={() => setMostrarConfigServico(false)}>Fechar</button>
          </div>
        </div>
      )}

      {mostrarQuantidades && servicoAtivo && (
        <div className="modal-overlay" onClick={fecharQuantidades}>
          <div className="modal-content" style={{ width: 560, maxHeight: '85vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
            <h4>Quantidades: {servicoAtivo.nome}</h4>
            <p style={{ fontSize: 12, color: '#6b7280' }}>
              Defina a quantidade ({servicoAtivo.unidade || 'un'}) de cada {servicoAtivo.modo_medicao === 'pavimento' ? 'pavimento' : servicoAtivo.modo_medicao === 'frente_fundo' ? 'frente/fundo' : 'apartamento/local'} deste serviço.

              O valor é multiplicado pelo valor unitário (R$ {servicoAtivo.valor_unitario}) ao marcar quem executou.
            </p>

            {etapaQuantidades === 'inicio' && (
              <div className="flex-col gap-2">
                <p style={{ fontSize: 13, fontWeight: 600 }}>Como você quer preencher as quantidades?</p>
                <button className="btn-primary" onClick={exportarQuantidades}>📥 Exportar planilha (para editar no Excel)</button>
                <label className="btn-secondary" style={{ cursor: 'pointer', textAlign: 'center' }}>
                  {importandoQuantidades ? 'Importando...' : '📤 Importar planilha preenchida'}
                  <input type="file" accept=".xlsx,.xls" onChange={importarQuantidades} style={{ display: 'none' }} disabled={importandoQuantidades} />
                </label>
                <div style={{ borderTop: '1px solid #e5e7eb', margin: '8px 0' }}></div>
                <p style={{ fontSize: 13, fontWeight: 600 }}>Ou preencher manualmente na tela:</p>
                <button className="btn-secondary" onClick={() => setEtapaQuantidades('individual')}>
                  🔢 Individual (um local por vez)
                </button>
                <button className="btn-secondary" onClick={() => setEtapaQuantidades('grupo')}>
                  👥 Em grupo (selecionar vários locais e aplicar a mesma quantidade)
                </button>
              </div>
            )}

            {etapaQuantidades === 'individual' && (
              <div>
                <button className="btn-secondary btn-sm" style={{ marginBottom: 10 }} onClick={() => setEtapaQuantidades('inicio')}>← Voltar</button>
                <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>
                      <th style={{ padding: 6 }}>Local</th>
                      <th style={{ padding: 6, width: 120 }}>Quantidade</th>
                    </tr>
                  </thead>
                  <tbody>
                    {listaCelulasQtd.map(item => {
                      const info = infoReplicacao(item.key);
                      return (
                        <tr key={item.key} style={{ borderBottom: '1px solid #f3f4f6' }}>
                          <td style={{ padding: 6 }}>{item.label}</td>
                          <td style={{ padding: 6 }}>
                            <div style={{ display: 'flex', gap: 4, alignItems: 'center', position: 'relative' }}>
                              <input
                                type="number" step="0.01"
                                value={quantidadesMapa[item.key] ?? 0}
                                onChange={e => editarQuantidadeLocal(item.key, e.target.value)}
                                onBlur={() => salvarQuantidadeCelula(item.key)}
                                style={{ width: '100%' }}
                              />
                              {info && (
                                <button
                                  type="button"
                                  className="btn-secondary btn-sm"
                                  title="Replicar esta quantidade para outros andares (mesmo apartamento)"
                                  style={{ padding: '2px 6px', fontSize: 11 }}
                                  onClick={() => abrirReplicar(item.key)}
                                >
                                  ↕
                                </button>
                              )}
                              {celulaReplicando === item.key && info && (
                                <div className="card" style={{
                                  position: 'absolute', top: '100%', right: 0, zIndex: 10,
                                  width: 220, padding: 10, boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
                                }}>
                                  <div style={{ fontSize: 12, marginBottom: 6 }}>
                                    Replicar quantidade ({quantidadesMapa[item.key] ?? 0}) para {descricaoTipoReplicacao(info.tipo)} até:
                                  </div>

                                  <select
                                    value={andarDestinoReplicar}
                                    onChange={e => setAndarDestinoReplicar(e.target.value)}
                                    style={{ width: '100%', marginBottom: 6 }}
                                  >
                                    <option value="">Selecione o andar...</option>
                                    {Array.from({ length: info.qtdAndares }, (_, i) => i).map(i => (
                                      <option key={i} value={i} disabled={i === info.andarAtual}>
                                        {i + 1}º andar do bloco{i === info.andarAtual ? ' (atual)' : ''}
                                      </option>
                                    ))}
                                  </select>
                                  <div className="flex gap-2">
                                    <button className="btn-secondary btn-sm" style={{ flex: 1 }} onClick={fecharReplicar}>Cancelar</button>
                                    <button className="btn-primary btn-sm" style={{ flex: 1 }} disabled={replicando || andarDestinoReplicar === ''} onClick={confirmarReplicar}>
                                      {replicando ? '...' : 'Aplicar'}
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}


            {etapaQuantidades === 'grupo' && (
              <div>
                <button className="btn-secondary btn-sm" style={{ marginBottom: 10 }} onClick={() => setEtapaQuantidades('inicio')}>← Voltar</button>
                <p style={{ fontSize: 12, color: '#6b7280' }}>
                  Marque os locais que têm a mesma quantidade (ex: todos os apartamentos final 3), informe o valor e aplique.
                  Isso só facilita a digitação — na medição cada local continua entrando separado.
                </p>

                <div className="flex gap-2" style={{ marginBottom: 10, position: 'sticky', top: 0, background: 'white', paddingBottom: 8, borderBottom: '1px solid #e5e7eb' }}>
                  <input
                    type="number" step="0.01" placeholder="Quantidade a aplicar"
                    value={valorGrupoQtd} onChange={e => setValorGrupoQtd(e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <button className="btn-primary btn-sm" disabled={aplicandoGrupoQtd} onClick={aplicarQuantidadeEmGrupo}>
                    {aplicandoGrupoQtd ? 'Aplicando...' : `Aplicar a ${selecaoGrupoQtd.size} selecionado(s)`}
                  </button>
                </div>

                <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>
                      <th style={{ padding: 6, width: 30 }}></th>
                      <th style={{ padding: 6 }}>Local</th>
                      <th style={{ padding: 6, width: 100 }}>Qtd. atual</th>
                    </tr>
                  </thead>
                  <tbody>
                    {listaCelulasQtd.map(item => (
                      <tr key={item.key} style={{ borderBottom: '1px solid #f3f4f6', background: selecaoGrupoQtd.has(item.key) ? '#eff6ff' : undefined }}>
                        <td style={{ padding: 6 }}>
                          <input type="checkbox" checked={selecaoGrupoQtd.has(item.key)} onChange={() => alternarSelecaoGrupoQtd(item.key)} />
                        </td>
                        <td style={{ padding: 6, cursor: 'pointer' }} onClick={() => alternarSelecaoGrupoQtd(item.key)}>{item.label}</td>
                        <td style={{ padding: 6, color: '#6b7280' }}>{quantidadesMapa[item.key] ?? 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <button className="btn-primary" style={{ marginTop: 12, width: '100%' }} onClick={fecharQuantidades}>Fechar</button>
          </div>
        </div>
      )}

      {mostrarEditarServicos && (
        <div className="modal-overlay" onClick={() => setMostrarEditarServicos(false)}>
          <div className="modal-content" style={{ width: 420, maxHeight: '85vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
            <h4>Editar serviços desta obra</h4>
            <p style={{ fontSize: 12, color: '#6b7280' }}>Marque os serviços que esta obra deve ter. Ao salvar, os desmarcados serão removidos (exceto os que já têm lançamentos).</p>

            {avisoServicos && (
              <div style={{ background: '#fef3c7', color: '#92400e', padding: 8, borderRadius: 6, fontSize: 12, marginBottom: 10 }}>
                {avisoServicos}
              </div>
            )}

            <div className="flex-col gap-2" style={{ maxHeight: 320, overflow: 'auto', marginBottom: 12 }}>
              {servicosPadrao.map(sp => (
                <label key={sp.id} className="flex gap-2" style={{ alignItems: 'center' }}>
                  <input type="checkbox" checked={selecaoServicos.has(sp.nome)} onChange={() => alternarSelecaoServico(sp.nome)} />
                  {sp.nome}
                </label>
              ))}
              {Array.from(selecaoServicos).filter(nome => !servicosPadrao.some(sp => sp.nome === nome)).map(nome => (
                <label key={nome} className="flex gap-2" style={{ alignItems: 'center' }}>
                  <input type="checkbox" checked={true} onChange={() => alternarSelecaoServico(nome)} />
                  {nome} <span style={{ fontSize: 11, color: '#9ca3af' }}>(personalizado)</span>
                </label>
              ))}
            </div>

            <div className="flex gap-2" style={{ marginBottom: 12 }}>
              <input placeholder="Personalizar: nome de novo serviço" value={novoServicoNome}
                onChange={e => setNovoServicoNome(e.target.value)} style={{ flex: 1 }} />
              <button className="btn-secondary btn-sm" onClick={adicionarServicoPersonalizado}>+ Adicionar</button>
            </div>

            <div className="flex gap-2">
              <button className="btn-secondary" style={{ flex: 1 }} onClick={() => setMostrarEditarServicos(false)}>Cancelar</button>
              <button className="btn-primary" style={{ flex: 1 }} disabled={salvandoServicos} onClick={salvarServicosEmLote}>
                {salvandoServicos ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {mostrarRevisaoObra && (
        <ObraWizard
          obraExistente={obra}
          onClose={() => setMostrarRevisaoObra(false)}
          onCriada={() => { setMostrarRevisaoObra(false); carregarObra(); }}
        />
      )}
    </div>
  );
}
