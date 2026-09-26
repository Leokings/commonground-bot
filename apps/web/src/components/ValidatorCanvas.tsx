import { useEffect, useRef } from "react";

type Node = {
  x: number;
  y: number;
  phase: number;
  speed: number;
  radius: number;
};

export function ValidatorCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const pointer = { x: -1_000, y: -1_000 };
    let width = 0;
    let height = 0;
    let frame = 0;
    let animationFrame = 0;
    let nodes: Node[] = [];

    const makeNodes = () => {
      const count = Math.max(18, Math.min(34, Math.round(width / 35)));
      nodes = Array.from({ length: count }, (_, index) => ({
        x: ((index * 83 + 29) % 997) / 997,
        y: ((index * 137 + 71) % 991) / 991,
        phase: (index * 0.81) % (Math.PI * 2),
        speed: 0.32 + (index % 5) * 0.055,
        radius: 2.4 + (index % 4) * 0.8,
      }));
    };

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const density = Math.min(window.devicePixelRatio || 1, 2);
      width = bounds.width;
      height = bounds.height;
      canvas.width = Math.round(width * density);
      canvas.height = Math.round(height * density);
      context.setTransform(density, 0, 0, density, 0, 0);
      makeNodes();
    };

    const draw = (timestamp = 0) => {
      context.clearRect(0, 0, width, height);
      context.fillStyle = "#efe9ff";
      context.fillRect(0, 0, width, height);

      const points = nodes.map((node) => {
        const drift = reducedMotion.matches ? 0 : timestamp * 0.00035 * node.speed;
        const x = node.x * width + Math.sin(node.phase + drift) * 16;
        const y = node.y * height + Math.cos(node.phase * 1.3 + drift) * 12;
        const distance = Math.hypot(pointer.x - x, pointer.y - y);
        const pull = distance < 150 ? (150 - distance) / 150 : 0;
        return {
          x: x + (pointer.x - x) * pull * 0.08,
          y: y + (pointer.y - y) * pull * 0.08,
          radius: node.radius + pull * 2,
        };
      });

      for (let first = 0; first < points.length; first += 1) {
        for (let second = first + 1; second < points.length; second += 1) {
          const a = points[first];
          const b = points[second];
          if (!a || !b) continue;
          const distance = Math.hypot(a.x - b.x, a.y - b.y);
          if (distance > 125) continue;
          context.beginPath();
          context.moveTo(a.x, a.y);
          context.lineTo(b.x, b.y);
          context.strokeStyle = `rgba(108, 75, 244, ${0.2 * (1 - distance / 125)})`;
          context.lineWidth = 1.2;
          context.stroke();
        }
      }

      points.forEach((point, index) => {
        context.beginPath();
        context.arc(point.x, point.y, point.radius, 0, Math.PI * 2);
        context.fillStyle = index % 3 === 0 ? "#ff6d5a" : "#6c4bf4";
        context.fill();
      });

      if (!reducedMotion.matches) {
        animationFrame = window.requestAnimationFrame(draw);
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      const bounds = canvas.getBoundingClientRect();
      pointer.x = event.clientX - bounds.left;
      pointer.y = event.clientY - bounds.top;
    };
    const onPointerLeave = () => {
      pointer.x = -1_000;
      pointer.y = -1_000;
    };
    const onMotionChange = () => {
      window.cancelAnimationFrame(animationFrame);
      frame += 1;
      draw(frame);
    };

    const observer = new ResizeObserver(() => {
      resize();
      if (reducedMotion.matches) draw(frame);
    });
    observer.observe(canvas);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerleave", onPointerLeave);
    reducedMotion.addEventListener("change", onMotionChange);
    resize();
    draw();

    return () => {
      observer.disconnect();
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      reducedMotion.removeEventListener("change", onMotionChange);
      window.cancelAnimationFrame(animationFrame);
    };
  }, []);

  return <canvas ref={canvasRef} className="validator-canvas" aria-hidden="true" />;
}
