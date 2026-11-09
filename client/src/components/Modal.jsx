// Janela padrão do sistema.
//
// Por que existe: antes cada tela montava seu próprio modal com
// <div className="modal-overlay" onClick={fechar}>, o que fechava a janela a qualquer clique
// fora dela — perdendo tudo que estava sendo preenchido. Agora o clique no fundo NÃO fecha:
// a saída é sempre consciente, pelo ✕ (sai sem salvar) ou pelo 💾 (salva).
//
// Cabeçalho padrão (canto superior direito), no estilo Windows:
//   💾  salva (só aparece quando a janela tem onSalvar)
//   ✕   fecha sem salvar, em vermelho
//
// Props:
//   titulo     - texto do cabeçalho
//   onFechar   - obrigatório: fecha sem salvar (✕ e tecla Esc)
//   onSalvar   - opcional: quando informado, mostra o 💾 e o rodapé Salvar/Cancelar
//   salvando   - desabilita os botões enquanto a gravação está em andamento
//   textoSalvar- rótulo do botão do rodapé (padrão: "Salvar")
//   largura    - largura da janela (padrão responsivo)
//   children   - conteúdo do formulário
export default function Modal({
  titulo,
  onFechar,
  onSalvar,
  salvando = false,
  textoSalvar = 'Salvar',
  largura = 'min(520px, 95vw)',
  children
}) {
  return (
    // Sem onClick no overlay: clicar fora não fecha mais (evita perder o preenchimento).
    <div className="modal-overlay">
      <div className="modal-content" style={{ width: largura }} onClick={e => e.stopPropagation()}>
        {/* Cabeçalho: título à esquerda, ações à direita */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12,
          borderBottom: '1px solid #e5e7eb', paddingBottom: 8
        }}>
          <h4 style={{ margin: 0, flex: 1, fontSize: 15 }}>{titulo}</h4>

          {onSalvar && (
            <button
              type="button"
              onClick={onSalvar}
              disabled={salvando}
              title="Salvar"
              style={{
                background: '#16a34a', color: '#fff', border: 'none', borderRadius: 6,
                width: 34, height: 30, cursor: salvando ? 'default' : 'pointer', fontSize: 15,
                opacity: salvando ? 0.6 : 1
              }}
            >
              💾
            </button>
          )}

          <button
            type="button"
            onClick={onFechar}
            title="Fechar sem salvar"
            style={{
              background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6,
              width: 34, height: 30, cursor: 'pointer', fontSize: 15, fontWeight: 700,
              lineHeight: 1
            }}
          >
            ✕
          </button>
        </div>

        {children}

        {/* Rodapé com as mesmas ações, para quem prefere botões grandes e nomeados */}
        {onSalvar && (
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button className="btn-success" style={{ flex: 1, fontWeight: 700 }} disabled={salvando} onClick={onSalvar}>
              {salvando ? 'Salvando...' : `💾 ${textoSalvar}`}
            </button>
            <button className="btn-secondary" style={{ flex: 1 }} disabled={salvando} onClick={onFechar}>
              Cancelar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
