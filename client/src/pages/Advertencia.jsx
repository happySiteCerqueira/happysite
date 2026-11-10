import { useEffect, useState } from 'react';
import api from '../api/api';
import { useAuth } from '../context/AuthContext';
import AssinaturaCanvas from '../components/AssinaturaCanvas';
import { gerarTermoAdvertenciaPdf } from '../utils/termoAdvertenciaPdf';

// Código reservado no seletor para "nenhum modelo existente serve": libera a digitação de um
// motivo novo, que o sistema passa a oferecer nas próximas vezes.
const MODELO_OUTRO = 'OUTRO';

// Substitui os marcadores do texto-base pelos dados reais do formulário, em tempo real.
// Marcadores desconhecidos ficam como estão — melhor um {x} visível do que texto sumindo.
function interpolarTexto(textoBase, { colaborador, data, hora }) {
  return String(textoBase || '')
    .replace(/\{colaborador\}/g, colaborador || '')
    .replace(/\{data\}/g, data || '')
    .replace(/\{hora\}/g, hora || 'horário não informado');
}

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

  // Modelo escolhido: id numérico (como texto) vindo do banco, ou MODELO_OUTRO.
  const [modelos, setModelos] = useState([]);
  const [modelo, setModelo] = useState('');
  const [horaOcorrencia, setHoraOcorrencia] = useState('');
  const [artigoClt, setArtigoClt] = useState('');
  const [observacoes, setObservacoes] = useState('');

  // Obra onde o fato ocorreu e dados completos do colaborador selecionado (CPF, admissão),
  // buscados sob demanda para compor o termo.
  const [obras, setObras] = useState([]);
  const [obraId, setObraId] = useState('');
  const [colaboradorDados, setColaboradorDados] = useState(null);

  // Modal de sucesso exibido após salvar, com a opção de imprimir o PDF na hora.
  const [registroSalvo, setRegistroSalvo] = useState(null);

  // Assinaturas (mesmo padrão do EPI: PNG em base64 vindo do canvas).
  const [assinaturaColaborador, setAssinaturaColaborador] = useState(null);
  const [recusouAssinar, setRecusouAssinar] = useState(false);
  const [t1Nome, setT1Nome] = useState('');
  const [t1Cpf, setT1Cpf] = useState('');
  const [t1Assinatura, setT1Assinatura] = useState(null);
  const [t2Nome, setT2Nome] = useState('');
  const [t2Cpf, setT2Cpf] = useState('');
  const [t2Assinatura, setT2Assinatura] = useState(null);

  const colaboradorSelecionado = colaboradores.find(c => String(c.id) === String(colaboradorId));
  const modeloSelecionado = modelos.find(m => String(m.id) === String(modelo));
  const obraSelecionada = obras.find(o => String(o.id) === String(obraId));

  // Dados usados na interpolação do texto-base.
  const dadosInterpolacao = {
    colaborador: colaboradorSelecionado?.nome || '',
    data: formatarData(dataOcorrencia),
    hora: horaOcorrencia
  };

  // Reinterpola o texto sempre que o modelo, o colaborador, a data ou a hora mudarem — é isto
  // que dispensa o usuário de preencher lacunas à mão. Só atua quando há um modelo escolhido:
  // no modo "Outro" o texto é inteiramente do usuário e não pode ser sobrescrito.
  useEffect(() => {
    if (!modeloSelecionado) return;
    setDescricao(interpolarTexto(modeloSelecionado.texto_base, dadosInterpolacao));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelo, colaboradorId, dataOcorrencia, horaOcorrencia]);

  // Ao escolher um modelo, preenche motivo, texto-base e artigo automaticamente.
  // "Outro" limpa os campos para o usuário escrever um motivo novo — que será aprendido.
  function escolherModelo(valor) {
    setModelo(valor);
    if (valor === MODELO_OUTRO || !valor) {
      setMotivo('');
      setDescricao('');
      setArtigoClt('');
      return;
    }
    const m = modelos.find(x => String(x.id) === String(valor));
    if (m) {
      setMotivo(m.motivo);
      setArtigoClt(m.artigo_clt || '');
      setDescricao(interpolarTexto(m.texto_base, dadosInterpolacao));
    }
  }

  function limparFormulario() {
    setColaboradorId(''); setTipo('ADVERTENCIA'); setDataOcorrencia(hoje());
    setMotivo(''); setDescricao(''); setDiasSuspensao(''); setConfirmado(false);
    setModelo(''); setHoraOcorrencia(''); setArtigoClt(''); setObservacoes('');
    setObraId(''); setColaboradorDados(null);
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
    // Modelos vêm do banco: os 10 padrão mais os que o sistema aprendeu com o motivo "Outro".
    api.get('/advertencias/modelos')
      .then(res => setModelos(res.data))
      .catch(() => setErro('Erro ao carregar os modelos de advertência'));
    api.get('/advertencias/obras')
      .then(res => setObras(res.data))
      .catch(() => setErro('Erro ao carregar as obras'));
  }
  useEffect(carregar, []);

  // Busca CPF, função e data de admissão da pessoa escolhida — dados que só o termo usa e que
  // não valeria a pena trazer na listagem inteira.
  useEffect(() => {
    if (!colaboradorId) { setColaboradorDados(null); return; }
    api.get(`/advertencias/colaboradores/${colaboradorId}`)
      .then(res => setColaboradorDados(res.data))
      .catch(() => setColaboradorDados(null));
  }, [colaboradorId]);

  async function salvar() {
    setErro('');
    if (!colaboradorId) { setErro('Selecione o colaborador.'); return; }
    if (!dataOcorrencia) { setErro('Informe a data da ocorrência.'); return; }
    if (!motivo.trim()) { setErro('Informe o motivo.'); return; }
    if (tipo === 'SUSPENSAO' && !(Number(diasSuspensao) > 0)) { setErro('Informe quantos dias de suspensão.'); return; }

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

    // As observações adicionais são concatenadas ao texto-base, formando a discriminação
    // definitiva dos fatos — é esse texto único que vai para o banco e para o PDF.
    const descricaoFinal = [descricao.trim(), observacoes.trim()].filter(Boolean).join('\n\n');

    setSalvando(true);
    try {
      const resposta = await api.post('/advertencias', {
        colaborador_id: Number(colaboradorId),
        obra_id: obraId ? Number(obraId) : null,
        tipo,
        data_ocorrencia: dataOcorrencia,
        hora_ocorrencia: horaOcorrencia || null,
        motivo: motivo.trim(),
        descricao: descricaoFinal,
        dias_suspensao: tipo === 'SUSPENSAO' ? Number(diasSuspensao) : 0,
        modelo: modeloSelecionado ? String(modeloSelecionado.id) : MODELO_OUTRO,
        artigo_clt: artigoClt.trim() || null,
        // Só aprende quando o motivo foi digitado à mão (opção "Outro").
        salvar_como_modelo: modelo === MODELO_OUTRO,
        assinatura_colaborador: recusouAssinar ? null : assinaturaColaborador,
        recusou_assinar: recusouAssinar ? 1 : 0,
        testemunha1_nome: t1Nome.trim(),
        testemunha1_cpf: t1Cpf.trim(),
        testemunha1_assinatura: t1Assinatura,
        testemunha2_nome: t2Nome.trim(),
        testemunha2_cpf: t2Cpf.trim(),
        testemunha2_assinatura: t2Assinatura
      });

      // Monta a versão "impressa" do registro recém-criado a partir do que já temos em tela,
      // evitando uma segunda ida ao servidor só para poder gerar o PDF imediatamente.
      setRegistroSalvo({
        id: resposta.data?.id,
        tipo,
        data_ocorrencia: dataOcorrencia,
        hora_ocorrencia: horaOcorrencia || null,
        motivo: motivo.trim(),
        descricao: descricaoFinal,
        artigo_clt: artigoClt.trim() || null,
        dias_suspensao: tipo === 'SUSPENSAO' ? Number(diasSuspensao) : 0,
        obra_nome: obraSelecionada?.nome || null,
        obra_endereco: obraSelecionada?.endereco || null,
        obra_cidade: obraSelecionada?.cidade || null,
        obra_estado: obraSelecionada?.estado || null,
        colaborador_nome: colaboradorDados?.nome || colaboradorSelecionado?.nome || '',
        colaborador_funcao: colaboradorDados?.funcao || '',
        colaborador_documento: colaboradorDados?.documento || '',
        colaborador_admissao: colaboradorDados?.data_admissao || null,
        assinatura_colaborador: recusouAssinar ? null : assinaturaColaborador,
        recusou_assinar: recusouAssinar ? 1 : 0,
        testemunha1_nome: t1Nome.trim(), testemunha1_cpf: t1Cpf.trim(), testemunha1_assinatura: t1Assinatura,
        testemunha2_nome: t2Nome.trim(), testemunha2_cpf: t2Cpf.trim(), testemunha2_assinatura: t2Assinatura
      });

      // Limpa o formulário para evitar que um segundo registro saia duplicado por engano.
      // (A navegação para o Histórico acontece pelo modal de sucesso, não aqui.)
      limparFormulario();

      // Modelos são recarregados: se o motivo foi digitado à mão, ele já estará na lista.
      api.get('/advertencias/modelos').then(res => setModelos(res.data)).catch(() => {});
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
        {/* Confirmação visual dos dados que irão para o termo, puxados do cadastro. */}
        {colaboradorDados && (
          <div style={{ fontSize: 11, color: '#6b7280', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: 8 }}>
            <strong>CPF:</strong> {colaboradorDados.documento || '—'}
            {'  ·  '}
            <strong>Função:</strong> {colaboradorDados.funcao || '—'}
            {'  ·  '}
            <strong>Admissão:</strong> {colaboradorDados.data_admissao ? formatarData(colaboradorDados.data_admissao) : '—'}
          </div>
        )}
      </div>

      <div className="flex-col gap-2" style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 12 }}>Obra / Local</label>
        <select value={obraId} onChange={e => setObraId(e.target.value)}>
          <option value="">Selecione a obra...</option>
          {obras.map(o => <option key={o.id} value={o.id}>{o.nome}</option>)}
        </select>
        {/* O "Local" do termo é o endereço cadastrado na obra — nada a digitar aqui. */}
        {obraSelecionada && (
          <div style={{ fontSize: 11, color: '#6b7280', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: 8 }}>
            📍 <strong>Local:</strong>{' '}
            {obraSelecionada.endereco
              ? obraSelecionada.endereco
              : <span style={{ color: '#b45309' }}>
                  esta obra está sem endereço no cadastro — o termo sairá com a linha em branco.
                </span>}
            <div style={{ marginTop: 2 }}>
              🏙️ <strong>Cidade/UF:</strong>{' '}
              {(obraSelecionada.cidade || obraSelecionada.estado)
                ? [obraSelecionada.cidade, obraSelecionada.estado].filter(Boolean).join('/')
                : <span style={{ color: '#b45309' }}>
                    não cadastrada — preencha no cadastro da obra para o termo sair com o local
                    de assinatura preenchido.
                  </span>}
            </div>
          </div>
        )}
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
          {modelos.map(m => (
            <option key={m.id} value={m.id}>{m.motivo}</option>
          ))}
          <option value={MODELO_OUTRO}>✏️ Outro (cadastrar novo motivo)</option>
        </select>
        {modeloSelecionado?.artigo_clt && (
          <div style={{ fontSize: 11, color: '#6b7280' }}>
            Enquadramento legal: <strong>{modeloSelecionado.artigo_clt}</strong>
          </div>
        )}
        {modelo === MODELO_OUTRO && (
          <div style={{ fontSize: 11, color: '#1d4ed8', background: '#dbeafe', borderRadius: 6, padding: 8 }}>
            💡 Este motivo será <strong>salvo automaticamente</strong> e ficará disponível na lista
            para todos os usuários nas próximas advertências.
          </div>
        )}
      </div>

      <div className="flex-col gap-2" style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 12 }}>
          {modelo === MODELO_OUTRO ? 'Título do novo motivo' : 'Motivo (resumo)'}
        </label>
        <input
          placeholder="Ex: Falta sem justificativa"
          value={motivo}
          onChange={e => setMotivo(e.target.value)}
          maxLength={200}
        />
      </div>

      {/* Artigo da CLT só é editável ao cadastrar um motivo novo; nos modelos existentes ele
          vem do catálogo e é exibido logo acima, junto ao seletor. */}
      {modelo === MODELO_OUTRO && (
        <div className="flex-col gap-2" style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12 }}>Artigo da CLT (opcional)</label>
          <input
            placeholder='Ex: Art. 482, "e" (desídia) da CLT'
            value={artigoClt}
            onChange={e => setArtigoClt(e.target.value)}
            maxLength={200}
          />
        </div>
      )}

      <div className="flex-col gap-2" style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 12 }}>Discriminação dos fatos</label>
        <textarea
          rows={6}
          placeholder="Descreva o ocorrido, data/hora, local e eventuais testemunhas."
          value={descricao}
          onChange={e => setDescricao(e.target.value)}
          style={{ resize: 'vertical' }}
        />
        {modeloSelecionado && (
          <div style={{ fontSize: 11, color: '#6b7280' }}>
            Preenchido automaticamente com o nome do colaborador, a data e a hora informados acima.
            Pode editar livremente.
          </div>
        )}
      </div>

      {/* Texto livre acrescentado ao final da discriminação dos fatos no momento de salvar. */}
      <div className="flex-col gap-2" style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 12 }}>Observações Adicionais (Opcional)</label>
        <textarea
          rows={3}
          placeholder="Detalhes complementares: local exato, testemunhas presentes, consequências do ato..."
          value={observacoes}
          onChange={e => setObservacoes(e.target.value)}
          style={{ resize: 'vertical' }}
        />
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

      {registroSalvo && (
        <ModalSucesso
          registro={registroSalvo}
          onImprimir={() => gerarTermoAdvertenciaPdf(registroSalvo)}
          onFechar={() => { setRegistroSalvo(null); onRegistrada(); }}
        />
      )}
    </div>
  );
}

// Modal exibido logo após o registro: o documento já está salvo e imutável no banco, então aqui
// só resta decidir se imprime agora ou segue para o histórico (onde pode imprimir depois).
function ModalSucesso({ registro, onImprimir, onFechar }) {
  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ width: 'min(420px, 95vw)' }} onClick={e => e.stopPropagation()}>
        <h4 style={{ marginTop: 0 }}>✅ Advertência registrada</h4>
        <p style={{ fontSize: 13, color: '#6b7280' }}>
          O registro de <strong>{registro.colaborador_nome}</strong> foi salvo e já está disponível
          no histórico. Você pode imprimir o termo agora ou a qualquer momento depois.
        </p>
        <div className="flex gap-2" style={{ marginTop: 16 }}>
          <button className="btn-primary" style={{ flex: 1 }} onClick={onImprimir}>
            🖨️ Imprimir PDF agora
          </button>
          <button className="btn-secondary" style={{ flex: 1 }} onClick={onFechar}>
            Voltar ao Histórico
          </button>
        </div>
      </div>
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
            <th>Obra</th>
            <th>Motivo</th>
            <th>Ciência</th>
            <th>Aplicada por</th>
            <th>Termo</th>
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
                <td style={{ color: '#6b7280', fontSize: 12 }} title={item.obra_endereco || ''}>
                  {item.obra_nome || '-'}
                  {item.obra_endereco && (
                    <div style={{ fontSize: 11, color: '#9ca3af' }}>📍 {item.obra_endereco}</div>
                  )}
                </td>
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
                {/* O termo é sempre reconstruído a partir do que está gravado, de modo que o
                    documento baixado hoje é idêntico ao emitido no dia do lançamento. */}
                <td>
                  <button
                    className="btn-secondary btn-sm"
                    title="Imprimir / baixar o termo de advertência em PDF"
                    onClick={() => gerarTermoAdvertenciaPdf(item)}
                  >
                    🖨️ PDF
                  </button>
                </td>
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
