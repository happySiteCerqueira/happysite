import { Component } from 'react';

// Rede de segurança contra "tela branca": sem isso, qualquer erro de JavaScript não tratado
// durante a renderização de um componente (ex: "TypeError: l is not a function", um bug em algum
// gráfico, uma função undefined sendo chamada, etc.) faz o React desmontar a aplicação inteira
// silenciosamente — a página fica em branco e só um F5/Ctrl+Shift+R resolve, porque o React não
// tenta renderizar de novo sozinho.
//
// Este Error Boundary captura esse tipo de erro e, em vez de deixar a tela em branco, recarrega
// a página automaticamente uma única vez (evita loop infinito se o erro persistir). Também loga o
// erro no console com detalhes, para facilitar identificar a causa raiz depois.
const CHAVE_RECARGA_ERRO = 'hs_recarga_apos_erro_render_em';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { comErro: false };
  }

  static getDerivedStateFromError() {
    return { comErro: true };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary] Erro de renderização capturado:', error, info?.componentStack);

    // Evita loop infinito de recarga: só recarrega automaticamente se a última tentativa foi há
    // mais de 10 segundos (se o erro persistir mesmo após recarregar, mostra a tela de erro real).
    const ultima = Number(sessionStorage.getItem(CHAVE_RECARGA_ERRO) || 0);
    if (Date.now() - ultima > 10000) {
      sessionStorage.setItem(CHAVE_RECARGA_ERRO, String(Date.now()));
      window.location.reload();
    }
  }

  render() {
    if (this.state.comErro) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          height: '100vh', padding: 24, textAlign: 'center', fontFamily: 'Segoe UI, sans-serif'
        }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
          <h2 style={{ margin: 0, color: '#1f2937' }}>Ocorreu um erro inesperado</h2>
          <p style={{ color: '#6b7280', marginTop: 8 }}>
            Estamos recarregando a página automaticamente. Se isso continuar acontecendo,
            atualize manualmente (F5) ou entre em contato com o suporte.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: 16, padding: '10px 20px', background: '#2563eb', color: '#fff',
              border: 'none', borderRadius: 8, fontWeight: 600, cursor: 'pointer'
            }}
          >
            Recarregar agora
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
