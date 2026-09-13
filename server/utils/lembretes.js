const db = require('../db/database');
const { enviarParaUsuario, enviarParaPerfis, marcarComoEnviada, pushHabilitado } = require('./push');
const { listarVencimentosAso } = require('./aso');

// Agendador de notificações. Roda a cada minuto e decide o que precisa ser avisado:
//   1) Lembretes da Agenda  -> configurados pelo usuário no próprio compromisso
//   2) ASO e Experiência    -> regra fixa, sempre 08:00, com ajuste de fim de semana
//
// IMPORTANTE (fuso horário): o servidor roda em us-east-1 (Virginia), então NÃO podemos usar a
// hora local da máquina. Todo cálculo é feito explicitamente no fuso de São Paulo (UTC-3), que é
// o horário que as pessoas enxergam no sistema.
const FUSO_BR = -3; // UTC-3 (horário de Brasília, sem horário de verão desde 2019)
const HORA_AVISO_FIXO = 8; // ASO e Experiência avisam sempre às 08:00 (hora de Brasília)

// "Agora" convertido para o fuso de Brasília.
function agoraBrasilia() {
  const agora = new Date();
  return new Date(agora.getTime() + FUSO_BR * 60 * 60 * 1000);
}

// Converte um Date (já em horário de Brasília) para 'YYYY-MM-DD'.
function paraChaveData(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

// Recua uma data para o dia útil anterior, se ela cair em sábado ou domingo.
// Regra definida para ASO/Experiência: nada é avisado no fim de semana — o aviso "sobe"
// para a sexta-feira anterior.
//   vence domingo -> avisa sexta | vence sábado -> avisa sexta | vence segunda -> segue segunda
function recuarParaDiaUtil(chave) {
  const [a, m, d] = chave.split('-').map(Number);
  const data = new Date(Date.UTC(a, m - 1, d));
  const diaSemana = data.getUTCDay(); // 0 = domingo, 6 = sábado
  if (diaSemana === 0) data.setUTCDate(data.getUTCDate() - 2); // domingo -> sexta
  else if (diaSemana === 6) data.setUTCDate(data.getUTCDate() - 1); // sábado -> sexta
  return paraChaveData(data);
}

// Data do LEMBRETE prévio (24h antes do vencimento), também ajustada para dia útil.
// Ex: vence segunda -> 24h antes seria domingo -> recua para sexta.
function dataLembretePrevio(chaveVencimento) {
  const [a, m, d] = chaveVencimento.split('-').map(Number);
  const data = new Date(Date.UTC(a, m - 1, d));
  data.setUTCDate(data.getUTCDate() - 1);
  return recuarParaDiaUtil(paraChaveData(data));
}

// ---- 1) LEMBRETES DA AGENDA (configurados pelo usuário) ----

// Converte data + período do compromisso no horário-base para contagem do lembrete.
// Compromissos sem hora exata (dia inteiro / manhã / tarde / noite) usam um horário de
// referência, para que "24h antes" continue fazendo sentido.
const HORA_POR_PERIODO = { DIA_INTEIRO: 8, MANHA: 8, TARDE: 13, NOITE: 18 };

function momentoDoCompromisso(evento) {
  const chave = typeof evento.data === 'string'
    ? evento.data.slice(0, 10)
    : paraChaveData(new Date(evento.data));
  const [a, m, d] = chave.split('-').map(Number);

  let hora = HORA_POR_PERIODO[evento.periodo] ?? 8;
  let minuto = 0;
  if (evento.periodo === 'HORA' && evento.hora) {
    const [h, min] = evento.hora.split(':').map(Number);
    hora = h; minuto = min;
  }
  return new Date(Date.UTC(a, m - 1, d, hora, minuto));
}

async function processarLembretesAgenda(agora) {
  // Só compromissos futuros (ou de hoje) e não concluídos precisam de lembrete.
  const hojeChave = paraChaveData(agora);
  const eventos = await db.all(
    `SELECT e.*, l.minutos_antes
     FROM agenda_eventos e
     JOIN agenda_lembretes l ON l.evento_id = e.id
     WHERE e.concluido = 0 AND e.data >= ?::date - INTERVAL '1 day'`,
    hojeChave
  );

  for (const ev of eventos) {
    const alvo = momentoDoCompromisso(ev);
    const momentoLembrete = new Date(alvo.getTime() - ev.minutos_antes * 60 * 1000);

    // Dispara quando o horário do lembrete já chegou, mas ainda está dentro de uma janela
    // de 1 hora (evita "ressuscitar" lembretes muito antigos se o servidor ficou fora do ar).
    const diffMin = (agora - momentoLembrete) / 60000;
    if (diffMin < 0 || diffMin > 60) continue;

    const chave = `agenda:${ev.id}:${ev.minutos_antes}`;
    if (!(await marcarComoEnviada(chave))) continue;

    const quando = ev.periodo === 'HORA' && ev.hora
      ? `às ${ev.hora}`
      : ({ DIA_INTEIRO: '(dia inteiro)', MANHA: '(manhã)', TARDE: '(tarde)', NOITE: '(noite)' }[ev.periodo] || '');

    const payload = {
      titulo: '🗓️ Lembrete de compromisso',
      corpo: `${ev.titulo} — ${formatarAntecedencia(ev.minutos_antes)} ${quando}`,
      url: '/agenda'
    };

    // Notifica quem criou + quem foi marcado (por nome e por categoria/perfil).
    await enviarParaUsuario(ev.criado_por, payload);

    const marcados = await db.all('SELECT usuario_id FROM agenda_evento_usuarios WHERE evento_id = ?', ev.id);
    for (const m of marcados) {
      if (m.usuario_id !== ev.criado_por) await enviarParaUsuario(m.usuario_id, payload);
    }

    const perfis = await db.all('SELECT perfil FROM agenda_evento_perfis WHERE evento_id = ?', ev.id);
    if (perfis.length) await enviarParaPerfis(perfis.map(p => p.perfil), payload);

    console.log(`[lembretes] Agenda: "${ev.titulo}" (${ev.minutos_antes} min antes)`);
  }
}

function formatarAntecedencia(minutos) {
  if (minutos >= 1440) {
    const dias = Math.round(minutos / 1440);
    return dias === 1 ? 'amanhã' : `em ${dias} dias`;
  }
  if (minutos >= 60) {
    const horas = Math.round(minutos / 60);
    return `em ${horas}h`;
  }
  return `em ${minutos} min`;
}

// ---- 2) ASO E EXPERIÊNCIA (regra fixa, sem configuração do usuário) ----
//
// Para cada vencimento são enviados DOIS avisos, sempre às 08:00 (hora de Brasília):
//   - LEMBRETE  : 24h antes (dia anterior ao vencimento)
//   - DIA       : no próprio dia do vencimento
// Ambos recuam para sexta-feira se caírem em sábado/domingo. Exemplos:
//   vence domingo -> lembrete quinta, aviso sexta
//   vence sábado  -> lembrete quinta, aviso sexta
//   vence segunda -> lembrete sexta,  aviso segunda
//
// Destinatários: RH (responsável por ASO e experiência) e ADM.
const PERFIS_ALERTA_RH = ['RH', 'ADM'];

async function processarAvisosAso(agora, hojeChave) {
  const lista = await listarVencimentosAso();

  for (const c of lista) {
    if (c.sem_aso || !c.data_vencimento) continue;
    const vencimento = c.data_vencimento.slice(0, 10);

    const diaAviso = recuarParaDiaUtil(vencimento);
    const diaLembrete = dataLembretePrevio(vencimento);

    if (hojeChave === diaLembrete) {
      const chave = `aso:${c.id}:${vencimento}:lembrete`;
      if (await marcarComoEnviada(chave)) {
        await enviarParaPerfis(PERFIS_ALERTA_RH, {
          titulo: '🩺 ASO a vencer',
          corpo: `${c.nome} — ASO vence em ${formatarBr(vencimento)}`,
          url: '/aso'
        });
        console.log(`[lembretes] ASO lembrete: ${c.nome}`);
      }
    }

    if (hojeChave === diaAviso) {
      const chave = `aso:${c.id}:${vencimento}:dia`;
      if (await marcarComoEnviada(chave)) {
        await enviarParaPerfis(PERFIS_ALERTA_RH, {
          titulo: '🩺 ASO vence hoje',
          corpo: `${c.nome} — vencimento em ${formatarBr(vencimento)}`,
          url: '/aso'
        });
        console.log(`[lembretes] ASO dia: ${c.nome}`);
      }
    }
  }
}

// Marcos do período de experiência: 45 e 90 dias corridos a partir da admissão (o próprio dia
// da admissão conta como 1º dia, por isso +44 e +89 — mesma lógica já usada no Painel).
function marcoExperiencia(dataAdmissao, dias) {
  const d = new Date(dataAdmissao);
  d.setUTCDate(d.getUTCDate() + dias - 1);
  return paraChaveData(d);
}

async function processarAvisosExperiencia(agora, hojeChave) {
  const colaboradores = await db.all(
    `SELECT id, nome, data_admissao, confirmado_45_dias
     FROM colaboradores
     WHERE ativo = 1 AND experiencia_status = 'EM_EXPERIENCIA' AND data_admissao IS NOT NULL`
  );

  for (const c of colaboradores) {
    // Os DOIS marcos geram aviso (45 e 90 dias), conforme definido.
    for (const dias of [45, 90]) {
      const vencimento = marcoExperiencia(c.data_admissao, dias);
      const diaAviso = recuarParaDiaUtil(vencimento);
      const diaLembrete = dataLembretePrevio(vencimento);

      if (hojeChave === diaLembrete) {
        const chave = `exp:${c.id}:${dias}:${vencimento}:lembrete`;
        if (await marcarComoEnviada(chave)) {
          await enviarParaPerfis(PERFIS_ALERTA_RH, {
            titulo: `⏳ Experiência (${dias} dias)`,
            corpo: `${c.nome} — completa ${dias} dias em ${formatarBr(vencimento)}`,
            url: '/'
          });
          console.log(`[lembretes] Experiência ${dias}d lembrete: ${c.nome}`);
        }
      }

      if (hojeChave === diaAviso) {
        const chave = `exp:${c.id}:${dias}:${vencimento}:dia`;
        if (await marcarComoEnviada(chave)) {
          await enviarParaPerfis(PERFIS_ALERTA_RH, {
            titulo: `⏳ Experiência vence hoje (${dias} dias)`,
            corpo: `${c.nome} — decisão necessária (${formatarBr(vencimento)})`,
            url: '/'
          });
          console.log(`[lembretes] Experiência ${dias}d dia: ${c.nome}`);
        }
      }
    }
  }
}

function formatarBr(chave) {
  const [a, m, d] = chave.split('-');
  return `${d}/${m}/${a}`;
}

// ---- CICLO PRINCIPAL ----

let ultimaRodadaFixa = null; // controla para os avisos de 08:00 rodarem uma vez por dia

async function rodarCiclo() {
  if (!pushHabilitado) return;
  try {
    const agora = agoraBrasilia();
    const hojeChave = paraChaveData(agora);

    // Lembretes da Agenda: verificados a cada minuto (dependem da hora do compromisso).
    await processarLembretesAgenda(agora);

    // ASO/Experiência: só a partir das 08:00, uma vez por dia. Se o servidor estiver fora do ar
    // às 08:00, o aviso sai assim que ele voltar (ainda no mesmo dia).
    if (agora.getUTCHours() >= HORA_AVISO_FIXO && ultimaRodadaFixa !== hojeChave) {
      ultimaRodadaFixa = hojeChave;
      await processarAvisosAso(agora, hojeChave);
      await processarAvisosExperiencia(agora, hojeChave);
    }
  } catch (e) {
    console.error('[lembretes] Erro no ciclo:', e.message);
  }
}

// Inicia o agendador (chamado pelo server.js). Verifica a cada minuto.
function iniciarAgendadorLembretes() {
  if (!pushHabilitado) {
    console.log('[lembretes] Agendador não iniciado (push desabilitado).');
    return;
  }
  setInterval(rodarCiclo, 60 * 1000);
  setTimeout(rodarCiclo, 20 * 1000); // primeira verificação logo após subir
  console.log('[lembretes] Agendador iniciado (verifica a cada minuto).');
}

module.exports = {
  iniciarAgendadorLembretes, rodarCiclo,
  processarLembretesAgenda, recuarParaDiaUtil, dataLembretePrevio, agoraBrasilia, paraChaveData
};
