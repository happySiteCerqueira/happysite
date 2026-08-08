import { useEffect, useRef, useState } from 'react';
import api from '../api/api';

function baixarBlob(blob, nomeArquivo) {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeArquivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

const COLABORADOR_VAZIO = {
  tipo: 'CPF', nome: '', documento: '', telefone: '', email: '', endereco: '',
  funcao: '', contato_responsavel: '', banco: '', agencia: '', conta: '', pix: '', valor_diaria: ''
};


export default function Cadastro() {
  const [menuAberto, setMenuAberto] = useState(null); // 'exportar' | 'modelo' | 'importar' | 'manual' | null
  const [obras, setObras] = useState([]);
  const [obraSelecionada, setObraSelecionada] = useState('');
  const [msg, setMsg] = useState('');
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);
  const inputImportarRef = useRef();
  const [tipoImportarPendente, setTipoImportarPendente] = useState(null);

  // ---- Cadastro manual ----
  const [subAbaManual, setSubAbaManual] = useState('pessoa'); // 'pessoa' | 'preco'
  const [novoColab, setNovoColab] = useState(COLABORADOR_VAZIO);
  const [salvandoColab, setSalvandoColab] = useState(false);

  const [servicosDaObra, setServicosDaObra] = useState([]);
  const [colaboradores, setColaboradores] = useState([]);
  const [precoServicoId, setPrecoServicoId] = useState('');
  const [precoColaboradorId, setPrecoColaboradorId] = useState('');
  const [precoValor, setPrecoValor] = useState('');
  const [salvandoPreco, setSalvandoPreco] = useState(false);

  useEffect(() => {
    api.get('/obras').then(res => setObras(res.data));
    api.get('/colaboradores').then(res => setColaboradores(res.data));
  }, []);

  useEffect(() => {
    if (obraSelecionada) {
      api.get(`/obras/${obraSelecionada}`).then(res => setServicosDaObra(res.data.servicos || []));
    } else {
      setServicosDaObra([]);
    }
  }, [obraSelecionada]);

  function precisaObra(tipo) {
    return tipo === 'servicos' || tipo === 'precos';
  }

  async function exportar(tipo) {
    setErro(''); setMsg('');
    if (precisaObra(tipo) && !obraSelecionada) {
      setErro('Selecione uma obra primeiro.');
      return;
    }
    setCarregando(true);
    try {
      let res, nome;
      if (tipo === 'colaboradores') {
        res = await api.get('/colaboradores/exportar', { params: { tipo: 'CPF' }, responseType: 'blob' });
        nome = 'colaboradores.xlsx';
      } else if (tipo === 'empreiteiros') {
        res = await api.get('/colaboradores/exportar', { params: { tipo: 'PJ' }, responseType: 'blob' });
        nome = 'empreiteiros.xlsx';
      } else if (tipo === 'servicos') {
        res = await api.get(`/obras/${obraSelecionada}/servicos/exportar`, { responseType: 'blob' });
        nome = 'servicos-da-obra.xlsx';
      } else if (tipo === 'precos') {
        res = await api.get(`/obras/${obraSelecionada}/precos/exportar`, { responseType: 'blob' });
        nome = 'precos-da-obra.xlsx';
      }
      baixarBlob(res.data, nome);
      setMsg('Exportado com sucesso!');
    } catch (e) {
      setErro(e.response?.data?.erro || 'Erro ao exportar');
    }
    setCarregando(false);
  }

  async function baixarModelo(tipo) {
    setErro(''); setMsg('');
    setCarregando(true);
    try {
      let res, nome;
      if (tipo === 'colaboradores') {
        res = await api.get('/colaboradores/modelo', { responseType: 'blob' });
        nome = 'modelo-colaboradores.xlsx';
      } else if (tipo === 'servicos') {
        res = await api.get('/obras/servicos/modelo', { responseType: 'blob' });
        nome = 'modelo-servicos-obra.xlsx';
      }
      baixarBlob(res.data, nome);
      setMsg('Modelo baixado com sucesso!');
    } catch (e) {
      setErro(e.response?.data?.erro || 'Erro ao baixar modelo');
    }
    setCarregando(false);
  }

  function iniciarImportar(tipo) {
    setErro(''); setMsg('');
    if (precisaObra(tipo) && !obraSelecionada) {
      setErro('Selecione uma obra primeiro.');
      return;
    }
    setTipoImportarPendente(tipo);
    inputImportarRef.current.click();
  }

  async function arquivoSelecionado(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCarregando(true);
    setErro(''); setMsg('');
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = reader.result.split(',')[1];
      try {
        let res;
        if (tipoImportarPendente === 'colaboradores') {
          res = await api.post('/colaboradores/importar', { arquivo_base64: base64 });
        } else if (tipoImportarPendente === 'servicos') {
          res = await api.post(`/obras/${obraSelecionada}/servicos/importar`, { arquivo_base64: base64 });
        }
        const d = res.data;
        setMsg(`Importação concluída! Criados: ${d.criados ?? 0} • Atualizados: ${d.atualizados ?? 0}${d.erros ? ` • Ignorados: ${d.erros}` : ''}`);
        api.get('/colaboradores').then(r => setColaboradores(r.data));
      } catch (err) {
        setErro(err.response?.data?.erro || 'Erro ao importar planilha');
      }
      setCarregando(false);
      e.target.value = '';
    };
    reader.readAsDataURL(file);
  }

  // ---- Cadastro manual: pessoa/empresa ----
  async function salvarColaboradorManual() {
    setErro(''); setMsg('');
    if (!novoColab.nome.trim()) { setErro('Informe o nome.'); return; }
    setSalvandoColab(true);
    try {
      await api.post('/colaboradores', { ...novoColab, valor_diaria: Number(novoColab.valor_diaria) || 0 });

      setMsg(`${novoColab.tipo === 'PJ' ? 'Empreiteiro' : 'Colaborador'} "${novoColab.nome}" cadastrado com sucesso!`);
      setNovoColab(COLABORADOR_VAZIO);
      api.get('/colaboradores').then(r => setColaboradores(r.data));
    } catch (err) {
      setErro(err.response?.data?.erro || 'Erro ao salvar cadastro');
    }
    setSalvandoColab(false);
  }

  // ---- Cadastro manual: preço de um serviço específico da obra ----
  async function salvarPrecoManual() {
    setErro(''); setMsg('');
    if (!obraSelecionada) { setErro('Selecione uma obra.'); return; }
    if (!precoServicoId) { setErro('Selecione o serviço.'); return; }
    if (precoValor === '' || isNaN(Number(precoValor))) { setErro('Informe um valor válido.'); return; }
    setSalvandoPreco(true);
    try {
      if (precoColaboradorId) {
        // preço específico para um colaborador/empreiteiro nesse serviço
        await api.post(`/colaboradores/${precoColaboradorId}/precos`, {
          obra_servico_id: precoServicoId,
          valor_unitario: Number(precoValor)
        });
        setMsg('Preço específico salvo com sucesso!');
      } else {
        // preço padrão do serviço na obra
        await api.put(`/obras/servicos/${precoServicoId}`, { valor_unitario: Number(precoValor) });
        setMsg('Valor unitário do serviço atualizado com sucesso!');
      }
      setPrecoValor('');
    } catch (err) {
      setErro(err.response?.data?.erro || 'Erro ao salvar preço');
    }
    setSalvandoPreco(false);
  }

  const opcao = (label, onClick, desc) => (
    <button className="btn-secondary" style={{ width: '100%', textAlign: 'left', marginBottom: 6 }} onClick={onClick} disabled={carregando}>
      <div style={{ fontWeight: 600 }}>{label}</div>
      {desc && <div style={{ fontSize: 11, color: '#6b7280' }}>{desc}</div>}
    </button>
  );

  const campo = (label, valor, onChange, tipo = 'text') => (
    <div className="flex-col gap-2">
      <label style={{ fontSize: 12 }}>{label}</label>
      <input type={tipo} value={valor} onChange={onChange} />
    </div>
  );

  return (
    <div>
      <h2>📋 Cadastro</h2>
      <p style={{ color: '#6b7280', fontSize: 13, marginBottom: 16 }}>
        Use planilhas Excel para cadastrar em lote, ou cadastre manualmente um item por vez.
      </p>

      <div className="card" style={{ marginBottom: 16 }}>
        <label style={{ fontSize: 13, fontWeight: 600 }}>Obra (necessária para Serviços/Preços da obra)</label>
        <select value={obraSelecionada} onChange={e => setObraSelecionada(e.target.value)} style={{ marginTop: 6 }}>
          <option value="">Selecione uma obra...</option>
          {obras.map(o => <option key={o.id} value={o.id}>{o.nome}</option>)}
        </select>
      </div>

      {msg && <div style={{ background: '#dcfce7', color: '#166534', padding: 10, borderRadius: 6, marginBottom: 12 }}>{msg}</div>}
      {erro && <div style={{ background: '#fee2e2', color: '#991b1b', padding: 10, borderRadius: 6, marginBottom: 12 }}>{erro}</div>}

      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <button className={menuAberto === 'manual' ? 'btn-primary' : 'btn-secondary'} onClick={() => setMenuAberto(menuAberto === 'manual' ? null : 'manual')}>
          ✍️ Cadastro manual
        </button>
        <button className={menuAberto === 'exportar' ? 'btn-primary' : 'btn-secondary'} onClick={() => setMenuAberto(menuAberto === 'exportar' ? null : 'exportar')}>
          📥 Exportar
        </button>
        <button className={menuAberto === 'modelo' ? 'btn-primary' : 'btn-secondary'} onClick={() => setMenuAberto(menuAberto === 'modelo' ? null : 'modelo')}>
          📄 Modelo
        </button>
        <button className={menuAberto === 'importar' ? 'btn-primary' : 'btn-secondary'} onClick={() => setMenuAberto(menuAberto === 'importar' ? null : 'importar')}>
          📤 Importar
        </button>
      </div>

      <input type="file" accept=".xlsx,.xls" ref={inputImportarRef} style={{ display: 'none' }} onChange={arquivoSelecionado} />

      {menuAberto === 'manual' && (
        <div className="card">
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            <button className={subAbaManual === 'pessoa' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => setSubAbaManual('pessoa')}>
              Colaborador/Empreiteiro
            </button>
            <button className={subAbaManual === 'preco' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => setSubAbaManual('preco')}>
              Preço de serviço
            </button>
          </div>

          {subAbaManual === 'pessoa' && (
            <div>
              <h4>Novo colaborador ou empreiteiro</h4>
              <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div className="flex-col gap-2">
                  <label style={{ fontSize: 12 }}>Tipo</label>
                  <select value={novoColab.tipo} onChange={e => setNovoColab({ ...novoColab, tipo: e.target.value })}>
                    <option value="CPF">Pessoa Física (CPF)</option>
                    <option value="PJ">Pessoa Jurídica / Empreiteiro (PJ)</option>
                  </select>
                </div>
                {campo('Nome / Razão Social', novoColab.nome, e => setNovoColab({ ...novoColab, nome: e.target.value }))}
                {campo('CPF/CNPJ', novoColab.documento, e => setNovoColab({ ...novoColab, documento: e.target.value }))}
                {campo('Telefone', novoColab.telefone, e => setNovoColab({ ...novoColab, telefone: e.target.value }))}
                {campo('E-mail', novoColab.email, e => setNovoColab({ ...novoColab, email: e.target.value }))}
                {campo('Endereço', novoColab.endereco, e => setNovoColab({ ...novoColab, endereco: e.target.value }))}
                {novoColab.tipo === 'CPF'
                  ? campo('Função', novoColab.funcao, e => setNovoColab({ ...novoColab, funcao: e.target.value }))
                  : campo('Contato Responsável', novoColab.contato_responsavel, e => setNovoColab({ ...novoColab, contato_responsavel: e.target.value }))}
                {campo('Banco', novoColab.banco, e => setNovoColab({ ...novoColab, banco: e.target.value }))}
                {campo('Agência', novoColab.agencia, e => setNovoColab({ ...novoColab, agencia: e.target.value }))}
                {campo('Conta', novoColab.conta, e => setNovoColab({ ...novoColab, conta: e.target.value }))}
                {campo('PIX', novoColab.pix, e => setNovoColab({ ...novoColab, pix: e.target.value }))}
                <div className="flex-col gap-2">
                  <label style={{ fontSize: 12 }}>Valor da Diária (R$) — opcional</label>
                  <input type="number" step="0.01" value={novoColab.valor_diaria}
                    onChange={e => setNovoColab({ ...novoColab, valor_diaria: e.target.value })} />
                  <span style={{ fontSize: 11, color: '#9ca3af' }}>Não é obrigatório agora; pode ser definido/editado depois na aba Diárias.</span>
                </div>
              </div>

              <button className="btn-primary" disabled={salvandoColab} onClick={salvarColaboradorManual}>
                {salvandoColab ? 'Salvando...' : '💾 Salvar cadastro'}
              </button>
            </div>
          )}

          {subAbaManual === 'preco' && (
            <div>
              <h4>Definir preço de um serviço</h4>
              <p style={{ fontSize: 12, color: '#6b7280' }}>
                Selecione a obra acima, o serviço e (opcionalmente) um colaborador/empreiteiro específico para dar um preço diferenciado.
                Se deixar "colaborador" em branco, altera o valor padrão do serviço na obra.
              </p>
              <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div className="flex-col gap-2">
                  <label style={{ fontSize: 12 }}>Serviço da obra</label>
                  <select value={precoServicoId} onChange={e => setPrecoServicoId(e.target.value)} disabled={!obraSelecionada}>
                    <option value="">{obraSelecionada ? 'Selecione o serviço...' : 'Selecione uma obra primeiro'}</option>
                    {servicosDaObra.map(s => <option key={s.id} value={s.id}>{s.nome} (atual: R$ {s.valor_unitario})</option>)}
                  </select>
                </div>
                <div className="flex-col gap-2">
                  <label style={{ fontSize: 12 }}>Colaborador/Empreiteiro (opcional)</label>
                  <select value={precoColaboradorId} onChange={e => setPrecoColaboradorId(e.target.value)}>
                    <option value="">— Valor padrão do serviço —</option>
                    {colaboradores.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                  </select>
                </div>
                {campo('Valor unitário (R$)', precoValor, e => setPrecoValor(e.target.value), 'number')}
              </div>
              <button className="btn-primary" disabled={salvandoPreco} onClick={salvarPrecoManual}>
                {salvandoPreco ? 'Salvando...' : '💾 Salvar preço'}
              </button>
            </div>
          )}
        </div>
      )}

      {menuAberto === 'exportar' && (
        <div className="card">
          <h4>Exportar planilha</h4>
          {opcao('Colaboradores', () => exportar('colaboradores'), 'Baixa todos os colaboradores (CPF) cadastrados')}
          {opcao('Empreiteiros', () => exportar('empreiteiros'), 'Baixa todos os empreiteiros/empresas (PJ) cadastrados')}
          {opcao('Serviços da obra', () => exportar('servicos'), 'Baixa os serviços cadastrados na obra selecionada acima')}
          {opcao('Preços da obra', () => exportar('precos'), 'Baixa os valores unitários dos serviços da obra selecionada acima')}
        </div>
      )}

      {menuAberto === 'modelo' && (
        <div className="card">
          <h4>Baixar planilha modelo (vazia, com exemplo)</h4>
          {opcao('Colaboradores / Empreiteiros', () => baixarModelo('colaboradores'), 'Modelo único: preencha "Tipo" como CPF ou PJ em cada linha')}
          {opcao('Serviços da obra', () => baixarModelo('servicos'), 'Modelo com colunas: Nome, Modo de Medição, Modo de Execução, Quantidade, Unidade (m²/m³/metro/un), Valor Unitário')}
        </div>
      )}

      {menuAberto === 'importar' && (
        <div className="card">
          <h4>Importar planilha preenchida</h4>
          {opcao('Colaboradores / Empreiteiros', () => iniciarImportar('colaboradores'), 'Cria novos e atualiza existentes (por nome + documento)')}
          {opcao('Serviços da obra', () => iniciarImportar('servicos'), 'Cria novos serviços ou atualiza os existentes (por ID) na obra selecionada acima')}
        </div>
      )}

      {carregando && <div style={{ marginTop: 10, color: '#6b7280', fontSize: 13 }}>Processando...</div>}
    </div>
  );
}
