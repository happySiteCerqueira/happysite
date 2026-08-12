import { useRef, useState, useEffect } from 'react';

// Componente de assinatura livre em canvas (mouse ou toque).
// Expõe o valor via callback onChange(dataUrlPngOuNull) sempre que a assinatura muda.
// O canvas é responsivo: mede a largura real do container (via ResizeObserver) e recalcula
// a altura proporcionalmente, de forma que ao girar o celular para a horizontal (landscape) o
// espaço de assinatura fique maior/mais confortável, em vez de ficar travado num tamanho fixo.
// Ao redimensionar, o desenho já feito é preservado (reaproveitado e escalado no novo tamanho).
//
// Observação importante sobre iOS/Safari: os eventos de toque são registrados manualmente via
// addEventListener com { passive: false }. Os handlers sintéticos onTouchStart/Move/End do React
// podem ser tratados como passivos pelo navegador em certas condições, fazendo o preventDefault()
// ser ignorado — nesse caso o Safari interpreta o gesto como rolagem da página em vez de desenho,
// e a assinatura simplesmente não aparece. Registrando manualmente com passive:false garantimos
// que o preventDefault funcione e o toque seja sempre tratado como desenho.
export default function AssinaturaCanvas({ onChange, largura = 500, altura = 180, proporcao = 0.36, alturaMinima = 120, alturaMaxima = 260 }) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const desenhando = useRef(false);
  const vazioRef = useRef(true); // ref para evitar closures desatualizadas dentro dos handlers de toque/mouse
  const [vazio, setVazioState] = useState(true);
  const [tamanho, setTamanho] = useState({ largura, altura });

  function setVazio(valor) {
    vazioRef.current = valor;
    setVazioState(valor);
  }

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
    if (canvas.width > 0 && canvas.height > 0 && !vazioRef.current) {
      try { imagemAnterior = canvas.toDataURL('image/png'); } catch { imagemAnterior = null; }
    }

    canvas.width = tamanho.largura;
    canvas.height = tamanho.altura;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#111827';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (imagemAnterior) {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        // Reafirma as propriedades de traço após desenhar a imagem (algumas engines resetam o contexto)
        ctx.strokeStyle = '#111827';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        emitirValor();
      };
      img.src = imagemAnterior;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tamanho.largura, tamanho.altura]);

  function posicaoDe(clientX, clientY) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) * (canvas.width / rect.width),
      y: (clientY - rect.top) * (canvas.height / rect.height)
    };
  }

  function iniciarEm(clientX, clientY) {
    desenhando.current = true;
    const ctx = canvasRef.current.getContext('2d');
    const { x, y } = posicaoDe(clientX, clientY);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function moverPara(clientX, clientY) {
    if (!desenhando.current) return;
    const ctx = canvasRef.current.getContext('2d');
    const { x, y } = posicaoDe(clientX, clientY);
    ctx.lineTo(x, y);
    ctx.stroke();
    if (vazioRef.current) setVazio(false);
  }

  function finalizar() {
    if (!desenhando.current) return;
    desenhando.current = false;
    emitirValor();
  }

  function emitirValor() {
    const canvas = canvasRef.current;
    onChange(vazioRef.current ? null : canvas.toDataURL('image/png'));
  }

  // Handlers de mouse (desktop) continuam via props sintéticas do React normalmente
  function onMouseDown(e) { e.preventDefault(); iniciarEm(e.clientX, e.clientY); }
  function onMouseMove(e) { if (!desenhando.current) return; e.preventDefault(); moverPara(e.clientX, e.clientY); }
  function onMouseUp() { finalizar(); }
  function onMouseLeave() { finalizar(); }

  // Handlers de toque registrados manualmente com passive:false (necessário para o iOS/Safari
  // respeitar o preventDefault e não tratar o gesto como rolagem da página).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function onTouchStart(e) {
      e.preventDefault();
      const t = e.touches[0];
      if (t) iniciarEm(t.clientX, t.clientY);
    }
    function onTouchMove(e) {
      if (!desenhando.current) return;
      e.preventDefault();
      const t = e.touches[0];
      if (t) moverPara(t.clientX, t.clientY);
    }
    function onTouchEnd(e) {
      e.preventDefault();
      finalizar();
    }

    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd, { passive: false });
    canvas.addEventListener('touchcancel', onTouchEnd, { passive: false });

    return () => {
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('touchend', onTouchEnd);
      canvas.removeEventListener('touchcancel', onTouchEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tamanho.largura, tamanho.altura]);

  function limpar() {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setVazio(true);
    onChange(null);
  }

  return (
    <div ref={containerRef} style={{ width: '100%', touchAction: 'none' }}>
      <canvas
        ref={canvasRef}
        width={tamanho.largura}
        height={tamanho.altura}
        style={{
          border: '1px solid #d1d5db', borderRadius: 6, background: '#fff',
          touchAction: 'none', overscrollBehavior: 'contain', userSelect: 'none',
          WebkitUserSelect: 'none', WebkitTouchCallout: 'none',
          width: '100%', display: 'block', cursor: 'crosshair'
        }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseLeave}
      />
      <div style={{ marginTop: 6 }}>
        <button type="button" className="btn-secondary btn-sm" onClick={limpar}>🧹 Limpar assinatura</button>
      </div>
    </div>
  );
}
