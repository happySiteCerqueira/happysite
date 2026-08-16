import { useEffect, useState } from 'react';
import api from '../api/api';

const NOMES_MODULOS = {
  obras: '🏢 Obras',
  medicao: '💰 Medição',
  diarias: '📅 Diárias',
  prestadores: '📇 Prestadores',
  epi: '🦺 EPI',
  financeiro: '💵 Financeiro'
};

// Sub-abas granulares, agrupadas visualmente sob o módulo pai correspondente.
// Cada entrada aparece como uma linha extra recuada logo abaixo da linha do módulo pai.
const SUBABAS_POR_MODULO = {
  financeiro: [
    { chave: 'financeiro.receita', rotulo: '📥 Receita' },
    { chave: 'financeiro.pagamentos', rotulo: '🧾 Pagtos. Antecipados' },
    { chave: 'financeiro.gastos', rotulo: '💸 Gastos' },
    { chave: 'financeiro.relatorios', rotulo: '📈 Relatórios' },
    { chave: 'financeiro.resumo', rotulo: '📊 Resumo' }
  ],
  prestadores: [
    { chave: 'prestadores.cadastro', rotulo: '📋 Cadastro' }
  ],
  epi: [
    { chave: 'epi.cadastrar', rotulo: '➕ Cadastrar / Entrada' }
  ]
};

// Ordem em que os módulos (com suas sub-abas) devem aparecer na tabela
const ORDEM_MODULOS = ['obras', 'medicao', 'diarias', 'prestadores', 'epi', 'financeiro'];

export default function ControleAcesso() {
  const [modulos, setModulos] = useState([]);
  const [perfis, setPerfis] = useState([]);
  const [permissoes, setPermissoes] = useState([]); // [{ perfil, modulo, permitido }]
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState('');
  const [erro, setErro] = useState('');

  function carregar() {
    setCarregando(true);
    api.get('/permissoes')
      .then(res => {
        setModulos(res.data.modulos);
        setPerfis(res.data.perfis);
        setPermissoes(res.data.permissoes);
      })
      .catch(() => setErro('Erro ao carregar permissões'))
      .finally(() => setCarregando(false));
  }
  useEffect(carregar, []);

  function estaPermitido(perfil, modulo) {
    const linha = permissoes.find(p => p.perfil === perfil && p.modulo === modulo);
    return linha ? !!linha.permitido : false;
  }

  function alternar(perfil, modulo) {
    setPermissoes(prev => {
      const existe = prev.find(p => p.perfil === perfil && p.modulo === modulo);
      if (existe) {
        return prev.map(p => (p.perfil === perfil && p.modulo === modulo) ? { ...p, permitido: p.permitido ? 0 : 1 } : p);
      }
      return [...prev, { perfil, modulo, permitido: 1 }];
    });
  }

  async function salvar() {
    setSalvando(true);
    setMsg(''); setErro('');
    try {
      await api.put('/permissoes', { permissoes });
      setMsg('Permissões salvas com sucesso!');
    } catch (err) {
      setErro(err.response?.data?.erro || 'Erro ao salvar permissões');
    }
    setSalvando(false);
  }

  if (carregando) return <p style={{ color: '#9ca3af' }}>Carregando...</p>;

  // Monta as linhas na ordem desejada: módulo pai seguido das suas sub-abas (se existirem no backend)
  const linhas = [];
  for (const modulo of ORDEM_MODULOS) {
    if (!modulos.includes(modulo)) continue;
    linhas.push({ chave: modulo, rotulo: NOMES_MODULOS[modulo] || modulo, ehSubaba: false });
    const subabas = SUBABAS_POR_MODULO[modulo] || [];
    for (const sub of subabas) {
      if (modulos.includes(sub.chave)) {
        linhas.push({ chave: sub.chave, rotulo: sub.rotulo, ehSubaba: true });
      }
    }
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>🔒 Controle de Acesso por Perfil</h3>
        <p style={{ color: '#6b7280', fontSize: 13 }}>
          Marque quais módulos cada perfil pode acessar. As linhas recuadas são sub-abas dentro do módulo
          (ex: dentro de Financeiro, é possível liberar só "Pagtos. Antecipados" para um perfil).
          O perfil <strong>ADM</strong> sempre tem acesso total e não aparece aqui.
        </p>

        {erro && <div style={{ background: '#fee2e2', color: '#991b1b', padding: 10, borderRadius: 6, marginBottom: 12 }}>{erro}</div>}
        {msg && <div style={{ background: '#dcfce7', color: '#166534', padding: 10, borderRadius: 6, marginBottom: 12 }}>{msg}</div>}

        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Perfil</th>
                {linhas.map(l => (
                  <th key={l.chave} style={{ textAlign: 'center', fontSize: l.ehSubaba ? 12 : undefined, color: l.ehSubaba ? '#6b7280' : undefined }}>
                    {l.ehSubaba ? `↳ ${l.rotulo}` : l.rotulo}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {perfis.map(perfil => (
                <tr key={perfil}>
                  <td><strong>{perfil}</strong></td>
                  {linhas.map(l => (
                    <td key={l.chave} style={{ textAlign: 'center', background: l.ehSubaba ? '#fafafa' : undefined }}>
                      <input
                        type="checkbox"
                        checked={estaPermitido(perfil, l.chave)}
                        onChange={() => alternar(perfil, l.chave)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <button
          className="btn-success"
          onClick={salvar}
          disabled={salvando}
          style={{ marginTop: 16, fontWeight: 700, boxShadow: '0 1px 3px rgba(0,0,0,0.15)' }}
        >
          {salvando ? 'Salvando...' : '✔ Salvar permissões'}
        </button>
      </div>
    </div>
  );
}
