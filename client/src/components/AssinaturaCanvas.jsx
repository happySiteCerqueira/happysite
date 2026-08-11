import { useRef, useState, useEffect } from 'react';

// Componente de assinatura livre em canvas (mouse ou toque).
// Expõe o valor via callback onChange(dataUrlPngOuNull) sempre que a assinatura muda.
// O canvas é responsivo: mede a largura real do container (via ResizeObserver) e recalcula
// a altura proporcionalmente, de forma que ao girar o celular para a horizontal (landscape) o
// espaço de assinatura fique maior/mais confortável, em vez de ficar travado num tamanho fixo.
// Ao redimensionar, o desenho já feito é preservado (reaproveitado e escalado no novo tamanho).
export default function AssinaturaCanvas({ onChange, largura = 500, altura = 180, proporcao = 0.36, alturaMinima = 120, alturaMaxima = 260 }) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const desenhando = useRef(false);
  const [vazio, setVazio] = useState(true);
  const [tamanho, setTamanho] = useState({ largura, altura });

  // Observa o tamanho do container e recalcula a altura do canvas proporcionalmente à largura
  // disponível, respeitando um mínimo/máximo. Isso é o que faz o canvas aproveitar bem o espaço
  // extra quando o celular é girado para a horizontal.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function recalcular(larguraContainer) {
      const novaLargura = Math.max(200, Math.round(larguraContainer));
      const novaAltura = Math.min(alturaMaxima, Math.max(alturaMinima, Math.round(novaLargura * proporcao)));
      setTamanho(prev => {
        if (prev.largura === novaLargura && prev.altura === novaAltura) return prev;
        return { largura: novaLargura, altura: novaAltura };
      });
    }

    recalcular(container.clientWidth);

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(entries => {
        for (const entry of entries) {
          recalcular(entry.contentRect.width);
        }
      });
      observer.observe(container);
      return () => observer.disconnect();
    } else {
      // Fallback (navegadores muito antigos): recalcula em resize/orientationchange.
      const handler = () => recalcular(container.clientWidth);
      window.addEventListener('resize', handler);
      window.addEventListener('orientationchange', handler);
      return () => {
        window.removeEventListener('resize', handler);
        window.removeEventListener('orientationchange', handler);
      };
    }
  }, [proporcao, alturaMinima, alturaMaxima]);

  // Sempre que o tamanho (largura/altura) do canvas mudar, preserva o desenho já feito
  // (redimensiona a imagem existente para o novo tamanho) em vez de simplesmente limpar tudo.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    let imagemAnterior = null;
    if (canvas.width > 0 && canvas.height > 0 && !vazio) {
      try { imagemAnterior = canvas.toDataURL('image/png'); } catch { imagemAnterior = null; }
    }

    canvas.width = tamanho.largura;
    canvas.height = tamanho.altura;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#111827';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';

    if (imagemAnterior) {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        emitirValor();
      };
      img.src = imagemAnterior;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tamanho.largura, tamanho.altura]);

  function posicao(e) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: (clientX - rect.left) * (canvas.width / rect.width),
      y: (clientY - rect.top) * (canvas.height / rect.height)
    };
  }


  function iniciar(e) {
    e.preventDefault();
    desenhando.current = true;
    const ctx = canvasRef.current.getContext('2d');
    const { x, y } = posicao(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function mover(e) {
    if (!desenhando.current) return;
    e.preventDefault();
    const ctx = canvasRef.current.getContext('2d');
    const { x, y } = posicao(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    if (vazio) setVazio(false);
  }

  function finalizar() {
    if (!desenhando.current) return;
    desenhando.current = false;
    emitirValor();
  }

  function emitirValor() {
    const canvas = canvasRef.current;
    onChange(vazio ? null : canvas.toDataURL('image/png'));
  }

  function limpar() {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setVazio(true);
    onChange(null);
  }

  return (
    <div ref={containerRef} style={{ width: '100%' }}>
      <canvas
        ref={canvasRef}
        width={tamanho.largura}
        height={tamanho.altura}
        style={{
          border: '1px solid #d1d5db', borderRadius: 6, background: '#fff',
          touchAction: 'none', overscrollBehavior: 'contain',
          width: '100%', display: 'block', cursor: 'crosshair'
        }}
        onMouseDown={iniciar}
        onMouseMove={mover}
        onMouseUp={finalizar}
        onMouseLeave={finalizar}
        onTouchStart={iniciar}
        onTouchMove={mover}
        onTouchEnd={finalizar}
      />
      <div style={{ marginTop: 6 }}>
        <button type="button" className="btn-secondary btn-sm" onClick={limpar}>🧹 Limpar assinatura</button>
      </div>
    </div>
  );
}


