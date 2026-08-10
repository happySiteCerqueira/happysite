import { useRef, useState, useEffect } from 'react';

// Componente de assinatura livre em canvas (mouse ou toque).
// Expõe o valor via callback onChange(dataUrlPngOuNull) sempre que a assinatura muda.
export default function AssinaturaCanvas({ onChange, largura = 500, altura = 180 }) {
  const canvasRef = useRef(null);
  const desenhando = useRef(false);
  const [vazio, setVazio] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#111827';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
  }, []);

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
    <div>
      <canvas
        ref={canvasRef}
        width={largura}
        height={altura}
        style={{ border: '1px solid #d1d5db', borderRadius: 6, background: '#fff', touchAction: 'none', width: '100%', maxWidth: largura, cursor: 'crosshair' }}
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
