import { useEffect, useState } from 'react';
import api from '../api/api';
import { useAuth } from '../context/AuthContext';
import AssinaturaCanvas from '../components/AssinaturaCanvas';
import { MODELOS_ADVERTENCIA, MODELO_OUTRO, buscarModelo, lacunasPendentes } from '../utils/modelosAdvertencia';

// Formata uma data (Date, string ISO ou 'YYYY-MM-DD') como dd/mm/aaaa, ignorando timezone
// (usa os componentes UTC para evitar que colunas DATE do Postgres "voltem" um dia por fuso).
function formatarData(data) {
  if (!data) return '-';
  const d = new Date(data);
  if (isNaN(d.getTime())) return '-';
  const dia = String(d.getUTCDate()).padStart(2, '0');
  const mes = String(d.getUTCMonth() + 1).padStart(2, '0');
  const ano = d.getUTCFullYear();
  return `${dia}/${mes}/${ano}`;
}

function hoje() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Gravidade da medida disciplinar. A ordem reflete a escalada usual: orientação verbal ->
// advertência escrita -> suspensão.
const TIPOS = [
  { valor: 'ORIENTACAO', rotulo: '📝 Orientação verbal', cor: '#6b7280' },
  { valor: 'ADVERTENCIA', rotulo: '⚠️ Advertência escrita', cor: '#d97706' },
  { valor: 'SUSPENSAO', rotulo: '⛔ Suspensão', cor: '#dc2626' }
];

function tipoInfo(valor) {
  return TIPOS.find(t => t.valor === valor) || TIPOS[1];
}

export default function Advertencia() {
  const [aba, setAba] = useState('aplicar'); // aplicar | historico
  // Usado para recarregar o Histórico automaticamente após registrar uma nova advertência:
  // mudar esta chave remonta a aba, refazendo a busca sem precisar clicar em nada.
  const [versaoHistorico, setVersaoHistorico] = useState(0);

  return (
    <div>
      <h2>⚠️ Advertência</h2>
      <p style={{ color: '#6b7280', fontSize: 13, marginBottom: 16 }}>
        Registro das medidas disciplinares aplicadas aos colaboradores. O histórico é permanente:
        continua disponível para consulta mesmo depois do desligamento da pessoa.
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button className={aba === 'aplicar' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => setAba('aplicar')}>
          ✚ Dar advertência
        </button>
        <button className={aba === 'historico' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => setAba('historico')}>
          📜 Histórico
        </button>
      </div>

      {aba === 'aplicar' && (
        <AbaDarAdvertencia
          onRegistrada={() => { setVersaoHistorico(v => v + 1); setAba('historico'); }}
        />
      )}
      {aba === 'historico' && <AbaHistorico key={versaoHistorico} />}
    </div>
  );
}

// ---- ABA DAR ADVERTÊNCIA ----
function AbaDarAdvertencia({ onRegistrada }) {
  const { temAcessoSubaba } = useAuth();
  const podeAplicar = temAcessoSubaba('advertencia.aplicar');

  const [colaboradores, setColaboradores] = useState([]);
  const [colaboradorId, setColaboradorId] = useState('');
  const [tipo, setTipo] = useState('ADVERTENCIA');
  const [dataOcorrencia, setDataOcorrencia] = useState(hoje());
  const [motivo, setMotivo] = useState('');
  const [descricao, setDescricao] = useState('');
  const [diasSuspensao, setDiasSuspensao] = useState('');
  const [confirmado, setConfirmado] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  // Modelo pré-cadastrado escolhido ('' = nenhum ainda, MODELO_OUTRO = escrita livre).
  const [modelo, setModelo] = useState('');
  const [horaOcorrencia, setHoraOcorrencia] = useState('');

  // Assinaturas (mesmo padrão do EPI: PNG em base64 vindo do canvas).
  const [assinaturaColaborador, setAssinaturaColaborador] = useState(null);
  const [recusouAssinar, setRecusouAssinar] = useState(false);
  const [t1Nome, setT1Nome] = useState('');
  const [t1Cpf, setT1Cpf] = useState('');
  const [t1Assinatura, setT1Assinatura] = useState(null);
  const [t2Nome, setT2Nome] = useState('');
  const [t2Cpf, setT2Cpf] = useState('');
  const [t2Assinatura, setT2Assinatura] = useState(null);

  // Lacunas [assim] que ainda restam no texto do modelo escolhido.
  const pendencias = lacunasPendentes(descricao);

  // Ao escolher um modelo, preenche motivo e texto-base automaticamente. "Outro" limpa tudo e
  // deixa o usuário escrever livremente. Trocar de modelo sobrescreve o texto de propósito —
  // por isso só fazemos isso na troca explícita, nunca durante a digitação.
  function escolherModelo(codigo) {
    setModelo(codigo);
    if (codigo === MODELO_OUTRO || !codigo) {
      setMotivo('');
      setDescricao('');
      return;
    }
    const m = buscarModelo(codigo);
    if (m) {
      setMotivo(m.rotulo);
      setDescricao(m.texto);
    }
  }

  function limparFormulario() {
    setColaboradorId(''); setTipo('ADVERTENCIA'); setDataOcorrencia(hoje());
    setMotivo(''); setDescricao(''); setDiasSuspensao(''); setConfirmado(false);
    setModelo(''); setHoraOcorrencia('');
    setAssinaturaColaborador(null); setRecusouAssinar(false);
    setT1Nome(''); setT1Cpf(''); setT1Assinatura(null);
    setT2Nome(''); setT2Cpf(''); setT2Assinatura(null);
  }

  // IMPORTANTE: esta função NÃO deve ter "return" antes de api.get(...) — ela é passada
  // diretamente para useEffect(carregar, []) e o React trataria o valor retornado como a
  // função de limpeza do efeito, quebrando ao trocar de aba.
  function carregar() {
    api.get('/advertencias/colaboradores')
      .then(res => setColaboradores(res.data))
      .catch(() => setErro('Erro ao carregar a lista de colaboradores'));
  }
  useEffect(carregar, []);

  async function salvar() {
    setErro('');
    if (!colaboradorId) { setErro('Selecione o colaborador.'); return; }
    if (!dataOcorrencia) { setErro('Informe a data da ocorrência.'); return; }
    if (!motivo.trim()) { setErro('Informe o motivo.'); return; }
    if (tipo === 'SUSPENSAO' && !(Number(diasSuspensao) > 0)) { setErro('Informe quantos dias de suspensão.'); return; }

    // Bloqueia lacunas [assim] esquecidas no texto: o termo é entregue ao colaborador e pode ser
    // usado como prova depois — não pode sair com "[data]" literal no lugar do fato real.
    if (pendencias.length > 0) {
      setErro(`Complete os campos entre colchetes no texto: ${pendencias.join(', ')}`);
      return;
    }

    if (recusouAssinar) {
      const faltas = [];
      if (!t1Nome.trim() || t1Cpf.replace(/\D/g, '').length !== 11 || !t1Assinatura) faltas.push('1ª testemunha');
      if (!t2Nome.trim() || t2Cpf.replace(/\D/g, '').length !== 11 || !t2Assinatura) faltas.push('2ª testemunha');
      if (faltas.length) {
        setErro(`Na recusa de assinatura é obrigatório nome completo, CPF e assinatura de duas testemunhas. Falta: ${faltas.join(' e ')}.`);
        return;
      }
    } else if (!assinaturaColaborador) {
      setErro('Colha a assinatura do colaborador ou marque que ele se recusou a assinar.');
      return;
    }

    if (!confirmado) { setErro('Confirme que o colaborador foi comunicado desta medida.'); return; }

    setSalvando(true);
    try {
      await api.post('/advertencias', {
        colaborador_id: Number(colaboradorId),
        tipo,
        data_ocorrencia: dataOcorrencia,
        hora_ocorrencia: horaOcorrencia || null,
        motivo: motivo.trim(),
        descricao: descricao.trim(),
        dias_suspensao: tipo === 'SUSPENSAO' ? Number(diasSuspensao) : 0,
        modelo: modelo || MODELO_OUTRO,
        artigo_clt: buscarModelo(modelo)?.artigo || null,
        assinatura_colaborador: recusouAssinar ? null : assinaturaColaborador,
        recusou_assinar: recusouAssinar ? 1 : 0,
        testemunha1_nome: t1Nome.trim(),
        testemunha1_cpf: t1Cpf.trim(),
        testemunha1_assinatura: t1Assinatura,
        testemunha2_nome: t2Nome.trim(),
        testemunha2_cpf: t2Cpf.trim(),
        testemunha2_assinatura: t2Assinatura
      });
      // Limpa o formulário para evitar que um segundo registro saia duplicado por engano.
      limparFormulario();
      onRegistrada();
    } catch (err) {
      setErro(err.response?.data?.erro || 'Erro ao registrar a advertência');
    }
    setSalvando(false);
  }

  if (!podeAplicar) {
    return (
      <div className="card">
        <p style={{ color: '#9ca3af', fontSize: 13, margin: 0 }}>
          Seu perfil pode consultar o <strong>Histórico</strong>, mas não tem permissão para aplicar advertências.
        </p>
      </div>
    );
  }

  return (
    <div className="card" style={{ maxWidth: 620 }}>
      <h4 style={{ marginTop: 0 }}>Registrar medida disciplinar</h4>
      {erro && <div style={{ background: '#fee2e2', color: '#991b1b', padding: 10, borderRadius: 6, marginBottom: 12 }}>{erro}</div>}

      <div className="flex-col gap-2" style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 12 }}>Colaborador</label>
        <select value={colaboradorId} onChange={e => setColaboradorId(e.target.value)}>
          <option value="">Selecione um colaborador...</option>
          {colaboradores.map(c => (
            <option key={c.id} value={c.id}>{c.nome}{c.funcao ? ` — ${c.funcao}` : ''}</option>
          ))}
        </select>
      </div>

      <div className="flex gap-4" style={{ flexWrap: 'wrap', marginBottom: 12 }}>
        <div className="flex-col gap-2" style={{ flex: 1, minWidth: 200 }}>
          <label style={{ fontSize: 12 }}>Tipo</label>
          <select value={tipo} onChange={e => setTipo(e.target.value)}>
            {TIPOS.map(t => <option key={t.valor} value={t.valor}>{t.rotulo}</option>)}
          </select>
        </div>
        <div className="flex-col gap-2" style={{ flex: 1, minWidth: 160 }}>
          <label style={{ fontSize: 12 }}>Data da ocorrência</label>
          <input type="date" value={dataOcorrencia} onChange={e => setDataOcorrencia(e.target.value)} />
        </div>
        <div className="flex-col gap-2" style={{ width: 130 }}>
          <label style={{ fontSize: 12 }}>Hora (opcional)</label>
          <input type="time" value={horaOcorrencia} onChange={e => setHoraOcorrencia(e.target.value)} />
        </div>
        {/* Só aparece na suspensão: nos demais tipos o campo não teria significado. */}
        {tipo === 'SUSPENSAO' && (
          <div className="flex-col gap-2" style={{ width: 150 }}>
            <label style={{ fontSize: 12 }}>Dias de suspensão</label>
            <input type="number" min="1" step="1" value={diasSuspensao} onChange={e => setDiasSuspensao(e.target.value)} />
          </div>
        )}
      </div>

      {/* Modelos pré-cadastrados: escolher um preenche o motivo e o texto-base automaticamente.
          "Outro" libera a escrita livre. O texto continua sempre editável em qualquer caso. */}
      <div className="flex-col gap-2" style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 12 }}>Modelo de enquadramento</label>
        <select value={modelo} onChange={e => escolherModelo(e.target.value)}>
          <option value="">Selecione o motivo...</option>
          {MODELOS_ADVERTENCIA.map(m => (
            <option key={m.codigo} value={m.codigo}>{m.numero}. {m.rotulo}</option>
          ))}
          <option value={MODELO_OUTRO}>✏️ Outro (escrever manualmente)</option>
        </select>
        {buscarModelo(modelo) && (
          <div style={{ fontSize: 11, color: '#6b7280' }}>
            Enquadramento legal: <strong>{buscarModelo(modelo).artigo}</strong>
          </div>
        )}
      </div>

      <div className="flex-col gap-2" style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 12 }}>Motivo (resumo)</label>
        <input
          placeholder="Ex: Falta sem justificativa"
          value={motivo}
          onChange={e => setMotivo(e.target.value)}
          maxLength={200}
        />
      </div>

      <div className="flex-col gap-2" style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 12 }}>Discriminação dos fatos</label>
        <textarea
          rows={6}
          placeholder="Descreva o ocorrido, data/hora, local e eventuais testemunhas."
          value={descricao}
          onChange={e => setDescricao(e.target.value)}
          style={{ resize: 'vertical' }}
        />
        {/* Aviso visível enquanto restarem lacunas do modelo por completar. */}
        {pendencias.length > 0 && (
          <div style={{ background: '#fef3c7', color: '#92400e', padding: 8, borderRadius: 6, fontSize: 12 }}>
            ⚠️ Substitua pelos dados reais antes de salvar: <strong>{pendencias.join(', ')}</strong>
          </div>
        )}
      </div>

      {/* ---- CIÊNCIA DO COLABORADOR ----
          Mesmo padrão de assinatura usado no termo de EPI (canvas, dedo ou mouse).
          Se o colaborador se recusar a assinar, a CLT admite que duas testemunhas atestem a
          entrega do documento — por isso o bloco abaixo troca de forma para pedir as duas. */}
      <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 14, marginBottom: 14 }}>
        <h5 style={{ margin: '0 0 4px' }}>Ciência do colaborador</h5>
        <p style={{ fontSize: 12, color: '#6b7280', marginTop: 0 }}>
          Declaração de recebimento da segunda via desta notificação e ciência dos termos expostos.
        </p>

        {!recusouAssinar && (
          <div style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
              Assinatura do colaborador que está recebendo a advertência
            </label>
            <AssinaturaCanvas onChange={setAssinaturaColaborador} />
          </div>
        )}

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <input
            type="checkbox"
            checked={recusouAssinar}
            onChange={e => {
              setRecusouAssinar(e.target.checked);
              // Troca de modo: descarta a assinatura do colaborador para não ficarem as duas
              // situações gravadas ao mesmo tempo (assinou E recusou seria contraditório).
              if (e.target.checked) setAssinaturaColaborador(null);
            }}
          />
          ⚠️ O colaborador <strong>recusou-se a assinar</strong>
        </label>
      </div>

      {recusouAssinar && (
        <div style={{ background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 8, padding: 12, marginBottom: 14 }}>
          <p style={{ fontSize: 12, color: '#92400e', marginTop: 0 }}>
            Havendo recusa, <strong>duas testemunhas</strong> que presenciaram a entrega devem se
            identificar e assinar, certificando que o colaborador tomou conhecimento desta
            advertência e recusou-se a assinar o ciente.
          </p>

          <CamposTestemunha
            ordem="1ª"
            nome={t1Nome} setNome={setT1Nome}
            cpf={t1Cpf} setCpf={setT1Cpf}
            onAssinatura={setT1Assinatura}
          />
          <CamposTestemunha
            ordem="2ª"
            nome={t2Nome} setNome={setT2Nome}
            cpf={t2Cpf} setCpf={setT2Cpf}
            onAssinatura={setT2Assinatura}
          />
        </div>
      )}

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 16 }}>
        <input type="checkbox" checked={confirmado} onChange={e => setConfirmado(e.target.checked)} />
        Confirmo que o colaborador foi comunicado desta medida.
      </label>

      <button className="btn-success" onClick={salvar} disabled={salvando} style={{ fontWeight: 700 }}>
        {salvando ? 'Registrando...' : '✔ Registrar advertência'}
      </button>
    </div>
  );
}

// Aplica a máscara 000.000.000-00 conforme o usuário digita, ignorando qualquer caractere que
// não seja dígito (permite colar um CPF já formatado sem quebrar o campo).
function formatarCpf(valor) {
  const d = String(valor || '').replace(/\D/g, '').slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

// Bloco de identificação + assinatura de uma testemunha (usado duas vezes na recusa).
function CamposTestemunha({ ordem, nome, setNome, cpf, setCpf, onAssinatura }) {
  const cpfCompleto = cpf.replace(/\D/g, '').length === 11;

  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, padding: 10, marginBottom: 10 }}>
      <strong style={{ fontSize: 13 }}>{ordem} testemunha</strong>

      <div className="flex gap-4" style={{ flexWrap: 'wrap', marginTop: 8, marginBottom: 8 }}>
        <div className="flex-col gap-2" style={{ flex: 1, minWidth: 200 }}>
          <label style={{ fontSize: 12 }}>Nome completo</label>
          <input value={nome} onChange={e => setNome(e.target.value)} placeholder="Nome completo da testemunha" />
        </div>
        <div className="flex-col gap-2" style={{ width: 170 }}>
          <label style={{ fontSize: 12 }}>CPF</label>
          <input
            value={cpf}
            onChange={e => setCpf(formatarCpf(e.target.value))}
            placeholder="000.000.000-00"
            inputMode="numeric"
            style={cpf && !cpfCompleto ? { border: '1px solid #f59e0b' } : undefined}
          />
        </div>
      </div>

      <label style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>Assinatura da {ordem} testemunha</label>
      <AssinaturaCanvas onChange={onAssinatura} />
    </div>
  );
}

// ---- ABA HISTÓRICO ----
function AbaHistorico() {
  const { usuario } = useAuth();
  const ehAdm = usuario?.perfil === 'ADM';

  const [lista, setLista] = useState([]);
  const [colaboradores, setColaboradores] = useState([]);
  const [filtroColaborador, setFiltroColaborador] = useState('');
  const [filtroTipo, setFiltroTipo] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  // Sem "return" antes do api.get: ver a nota na aba anterior (cleanup do useEffect).
  function carregar() {
    setCarregando(true);
    const params = {};
    if (filtroColaborador) params.colaborador_id = filtroColaborador;
    if (filtroTipo) params.tipo = filtroTipo;
    api.get('/advertencias', { params })
      .then(res => setLista(res.data))
      .catch(() => setErro('Erro ao carregar o histórico de advertências'))
      .finally(() => setCarregando(false));
  }
  useEffect(carregar, [filtroColaborador, filtroTipo]);

  // incluir_desligados=1: o filtro do histórico precisa listar também quem já saiu da empresa
  // mas tem advertência registrada — do contrário não haveria como consultar esses casos.
  useEffect(() => {
    api.get('/advertencias/colaboradores', { params: { incluir_desligados: 1 } })
      .then(res => setColaboradores(res.data))
      .catch(() => {});
  }, []);

  async function excluir(item) {
    if (!confirm(`Excluir a advertência de ${item.colaborador_nome} (${formatarData(item.data_ocorrencia)})?`)) return;
    try {
      await api.delete(`/advertencias/${item.id}`);
      carregar();
    } catch (err) {
      setErro(err.response?.data?.erro || 'Erro ao excluir a advertência');
    }
  }

  return (
    <div className="card">
      <h4 style={{ marginTop: 0 }}>Histórico de advertências</h4>

      <div className="flex gap-4" style={{ flexWrap: 'wrap', marginBottom: 16 }}>
        <div className="flex-col gap-2" style={{ minWidth: 240 }}>
          <label style={{ fontSize: 12 }}>Colaborador</label>
          <select value={filtroColaborador} onChange={e => setFiltroColaborador(e.target.value)}>
            <option value="">Todos os colaboradores</option>
            {colaboradores.map(c => (
              <option key={c.id} value={c.id}>{c.nome}{c.ativo === 0 ? ' (desligado)' : ''}</option>
            ))}
          </select>
        </div>
        <div className="flex-col gap-2" style={{ minWidth: 200 }}>
          <label style={{ fontSize: 12 }}>Tipo</label>
          <select value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)}>
            <option value="">Todos os tipos</option>
            {TIPOS.map(t => <option key={t.valor} value={t.valor}>{t.rotulo}</option>)}
          </select>
        </div>
      </div>

      {erro && <div style={{ background: '#fee2e2', color: '#991b1b', padding: 10, borderRadius: 6, marginBottom: 12 }}>{erro}</div>}
      {carregando && <p style={{ color: '#9ca3af' }}>Carregando...</p>}

      {!carregando && lista.length === 0 && (
        <p style={{ color: '#9ca3af', fontSize: 13 }}>Nenhuma advertência registrada para este filtro.</p>
      )}

      {!carregando && lista.length > 0 && <TabelaHistorico lista={lista} ehAdm={ehAdm} onExcluir={excluir} />}
    </div>
  );
}

// Tabela do histórico, extraída em um componente próprio só para manter a aba legível.
function TabelaHistorico({ lista, ehAdm, onExcluir }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table>
        <thead>
          <tr>
            <th>Colaborador</th>
            <th>Tipo</th>
            <th>Data</th>
            <th>Motivo</th>
            <th>Ciência</th>
            <th>Aplicada por</th>
            {ehAdm && <th>Ações</th>}
          </tr>
        </thead>
        <tbody>
          {lista.map(item => {
            const info = tipoInfo(item.tipo);
            return (
              <tr key={item.id}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 3, background: item.colaborador_cor, display: 'inline-block' }}></span>
                    {item.colaborador_nome}
                    {item.colaborador_funcao && (
                      <span style={{ color: '#9ca3af', fontSize: 11 }}>· {item.colaborador_funcao}</span>
                    )}
                    {/* Deixa claro que a pessoa já saiu, sem esconder o registro do histórico. */}
                    {item.colaborador_ativo === 0 && (
                      <span style={{ color: '#9ca3af', fontSize: 11 }}>(desligado)</span>
                    )}
                  </div>
                </td>
                <td>
                  <span style={{
                    background: info.cor, color: '#fff', fontSize: 11, fontWeight: 700,
                    padding: '2px 8px', borderRadius: 10, whiteSpace: 'nowrap'
                  }}>
                    {info.rotulo}
                  </span>
                  {item.tipo === 'SUSPENSAO' && item.dias_suspensao > 0 && (
                    <span style={{ color: '#6b7280', fontSize: 11, marginLeft: 6 }}>
                      {item.dias_suspensao} dia{item.dias_suspensao === 1 ? '' : 's'}
                    </span>
                  )}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>{formatarData(item.data_ocorrencia)}</td>
                <td>
                  {item.motivo}
                  {item.descricao && (
                    <div style={{ color: '#6b7280', fontSize: 12, marginTop: 2 }}>{item.descricao}</div>
                  )}
                </td>
                {/* Estado da ciência: assinada pelo colaborador, recusada (com testemunhas) ou
                    sem registro (advertências lançadas antes deste campo existir). */}
                <td>
                  {item.recusou_assinar ? (
                    <span
                      title={`Testemunhas: ${item.testemunha1_nome || '-'} e ${item.testemunha2_nome || '-'}`}
                      style={{ color: '#b45309', fontSize: 12, fontWeight: 700 }}
                    >
                      ⚠️ Recusou assinar
                    </span>
                  ) : item.assinatura_colaborador ? (
                    <img
                      src={item.assinatura_colaborador}
                      alt="Assinatura do colaborador"
                      style={{ height: 34, maxWidth: 130, objectFit: 'contain', border: '1px solid #e5e7eb', borderRadius: 4, background: '#fff' }}
                    />
                  ) : (
                    <span style={{ color: '#9ca3af', fontSize: 12 }}>Sem registro</span>
                  )}
                </td>
                <td style={{ color: '#6b7280' }}>{item.aplicada_por_nome || '-'}</td>
                {ehAdm && (
                  <td>
                    <button className="btn-danger btn-sm" onClick={() => onExcluir(item)}>Excluir</button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
