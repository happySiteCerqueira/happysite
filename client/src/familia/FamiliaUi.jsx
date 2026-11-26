export function Painel({ titulo, descricao, acao, children, classe = '' }) {
  return <section className={`fam-painel ${classe}`}>
    {(titulo || acao) && <header className="fam-painel-cabecalho">
      <div>{titulo && <h2>{titulo}</h2>}{descricao && <p>{descricao}</p>}</div>
      {acao}
    </header>}
    {children}
  </section>;
}

export function Modal({ titulo, onClose, children, amplo = false }) {
  return <div className="fam-modal-fundo" onMouseDown={e => {
    if (e.currentTarget === e.target) onClose();
  }}>
    <section className={`fam-modal ${amplo ? 'amplo' : ''}`} role="dialog" aria-modal="true">
      <header><h2>{titulo}</h2><button className="fam-icone" onClick={onClose} aria-label="Fechar">×</button></header>
      {children}
    </section>
  </div>;
}

export function Vazio({ titulo = 'Nada por aqui ainda', texto = 'Os dados aparecerão assim que houver registros.' }) {
  return <div className="fam-vazio"><span>◇</span><strong>{titulo}</strong><p>{texto}</p></div>;
}

export function Carregando({ texto = 'Carregando informações…' }) {
  return <div className="fam-carregando"><i />{texto}</div>;
}

export function ErroDados({ texto, tentarNovamente }) {
  return <div className="familia-alerta erro">
    <span>{texto}</span>
    {tentarNovamente && <button className="familia-botao texto" onClick={tentarNovamente}>Tentar novamente</button>}
  </div>;
}

export function Seletor({ dados, value, onChange, placeholder = 'Selecione', ...props }) {
  return <select value={value || ''} onChange={onChange} {...props}>
    <option value="">{placeholder}</option>
    {dados.map(item => <option key={item.id} value={item.id}>{item.nome || item.descricao || item.titulo}</option>)}
  </select>;
}

export function MesInput({ value, onChange, label = 'Mês' }) {
  return <label className="fam-filtro">{label}<input type="month" value={value} onChange={onChange} /></label>;
}

export function BotoesAcao({ onEditar, onExcluir, desabilitado }) {
  return <span className="fam-acoes-linha">
    <button className="fam-icone" disabled={desabilitado} onClick={onEditar} title="Editar" aria-label="Editar">✎</button>
    <button className="fam-icone perigo" disabled={desabilitado} onClick={onExcluir} title="Excluir" aria-label="Excluir">⌫</button>
  </span>;
}

export function ConfirmarExclusao({ nome }) {
  return window.confirm(`Excluir "${nome || 'este registro'}"? Esta ação não pode ser desfeita.`);
}
