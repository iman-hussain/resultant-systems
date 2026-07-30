(() => {
  const canvas = document.getElementById("field");
  const content = document.getElementById("content");
  if (!canvas || !content) return;

  const ctx = canvas.getContext("2d", { alpha: false });
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const isNarrow = () => window.matchMedia("(max-width: 720px)").matches;

  const ROAM_MS = 500;
  const SINGULARITY_MS = 450;
  const BANG_MS = 700;
  const GRAB_RADIUS = 28;

  const PHASE = {
    ROAM: "roam",
    SINGULARITY: "singularity",
    BANG: "bang",
    SETTLE: "settle",
  };

  let width = 0;
  let height = 0;
  let dpr = 1;
  let particles = [];
  let phase = PHASE.ROAM;
  let phaseStart = 0;
  let startTime = 0;
  let center = { x: 0, y: 0 };
  let letterTargets = [];
  let grabbed = null;
  let pointer = { x: -9999, y: -9999, active: false };
  let colors = { bg: "#0a0a0a", dot: "#f2f2f0", hot: "#9ec8ff" };
  let revealed = false;
  let raf = 0;

  function readColors() {
    const styles = getComputedStyle(document.documentElement);
    colors = {
      bg: styles.getPropertyValue("--bg").trim() || "#0a0a0a",
      dot: styles.getPropertyValue("--dot").trim() || "#f2f2f0",
      hot: styles.getPropertyValue("--dot-hot").trim() || "#9ec8ff",
    };
  }

  function particleCount() {
    const area = width * height;
    const base = Math.round(area / 1400);
    return Math.max(350, Math.min(isNarrow() ? 900 : 1400, base));
  }

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function sampleLetterTargets() {
    const off = document.createElement("canvas");
    const octx = off.getContext("2d");
    const padX = Math.max(24, width * 0.06);
    const topPad = Math.max(40, height * 0.12);
    const availableH = height * 0.48;

    off.width = Math.max(1, Math.floor(width));
    off.height = Math.max(1, Math.floor(height));
    octx.clearRect(0, 0, off.width, off.height);
    octx.fillStyle = "#fff";
    octx.textAlign = "center";
    octx.textBaseline = "middle";

    const lines = isNarrow()
      ? ["Resultant", "Systems", "Limited"]
      : ["Resultant Systems Limited"];

    const maxWidth = width - padX * 2;
    let fontSize = isNarrow()
      ? Math.min(width * 0.18, availableH / (lines.length * 1.15))
      : Math.min(width * 0.09, availableH * 0.55);

    octx.font = `700 ${fontSize}px "Instrument Sans", "Segoe UI", sans-serif`;

    if (!isNarrow()) {
      while (fontSize > 18 && octx.measureText(lines[0]).width > maxWidth) {
        fontSize -= 2;
        octx.font = `700 ${fontSize}px "Instrument Sans", "Segoe UI", sans-serif`;
      }
    } else {
      const widest = Math.max(...lines.map((l) => octx.measureText(l).width));
      if (widest > maxWidth) {
        fontSize *= maxWidth / widest;
        octx.font = `700 ${fontSize}px "Instrument Sans", "Segoe UI", sans-serif`;
      }
    }

    const lineHeight = fontSize * 1.12;
    const blockH = lineHeight * lines.length;
    const startY = topPad + (availableH - blockH) / 2 + lineHeight / 2;

    lines.forEach((line, i) => {
      octx.fillText(line, width / 2, startY + i * lineHeight);
    });

    const image = octx.getImageData(0, 0, off.width, off.height).data;
    const points = [];
    const step = Math.max(2, Math.floor(Math.min(width, height) / 280));

    for (let y = 0; y < off.height; y += step) {
      for (let x = 0; x < off.width; x += step) {
        const i = (y * off.width + x) * 4;
        if (image[i + 3] > 128) {
          points.push({
            x: x + (Math.random() - 0.5) * step * 0.35,
            y: y + (Math.random() - 0.5) * step * 0.35,
          });
        }
      }
    }

    if (!points.length) {
      points.push({ x: width / 2, y: height * 0.3 });
    }

    return points;
  }

  function assignTargets() {
    letterTargets = sampleLetterTargets();
    const count = particles.length;
    for (let i = 0; i < count; i++) {
      const t = letterTargets[i % letterTargets.length];
      particles[i].tx = t.x;
      particles[i].ty = t.y;
    }
  }

  function createParticles() {
    const count = particleCount();
    const list = [];
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 80 + Math.random() * 160;
      list.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        ox: null,
        oy: null,
        tx: width / 2,
        ty: height / 2,
        r: 0.8 + Math.random() * 1.4,
        heat: 0,
        held: false,
        captured: false,
      });
    }
    particles = list;
    assignTargets();
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    center = { x: width / 2, y: height * 0.38 };
    readColors();

    if (!particles.length) {
      createParticles();
    } else {
      assignTargets();
    }
  }

  function revealContent() {
    if (revealed) return;
    revealed = true;
    content.dataset.revealed = "true";
  }

  function nearestParticle(x, y) {
    let best = null;
    let bestDist = GRAB_RADIUS * GRAB_RADIUS;
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const dx = p.x - x;
      const dy = p.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestDist) {
        bestDist = d2;
        best = p;
      }
    }
    return best;
  }

  function pointerPos(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  function onPointerDown(e) {
    if (phase === PHASE.SETTLE || phase === PHASE.BANG) return;
    const pos = pointerPos(e);
    pointer.x = pos.x;
    pointer.y = pos.y;
    pointer.active = true;
    const hit = nearestParticle(pos.x, pos.y);
    if (hit) {
      grabbed = hit;
      hit.held = true;
      canvas.setPointerCapture?.(e.pointerId);
    }
  }

  function onPointerMove(e) {
    const pos = pointerPos(e);
    pointer.x = pos.x;
    pointer.y = pos.y;
    pointer.active = true;
    if (grabbed) {
      grabbed.x = pos.x;
      grabbed.y = pos.y;
      grabbed.vx = 0;
      grabbed.vy = 0;
    }
  }

  function onPointerUp() {
    if (grabbed) {
      grabbed.held = false;
      if (phase === PHASE.SINGULARITY && !grabbed.captured) {
        grabbed.ox = grabbed.x;
        grabbed.oy = grabbed.y;
        grabbed.captured = true;
      }
      grabbed = null;
    }
  }

  function onPointerLeave() {
    pointer.active = false;
    pointer.x = -9999;
    pointer.y = -9999;
  }

  function applyPointerForce(p, dt) {
    if (!pointer.active || p.held) return;
    const dx = p.x - pointer.x;
    const dy = p.y - pointer.y;
    const dist = Math.hypot(dx, dy) || 1;
    const radius = 120;
    if (dist < radius) {
      const force = (1 - dist / radius) * 220;
      const nx = -dy / dist;
      const ny = dx / dist;
      p.vx += nx * force * dt;
      p.vy += ny * force * dt;
      p.heat = Math.min(1, p.heat + (1 - dist / radius) * 0.15);
    }
  }

  function updateRoam(dt) {
    for (const p of particles) {
      if (p.held) continue;
      applyPointerForce(p, dt);
      p.vx += (Math.random() - 0.5) * 90 * dt;
      p.vy += (Math.random() - 0.5) * 90 * dt;
      const speed = Math.hypot(p.vx, p.vy);
      const maxSpeed = 220;
      if (speed > maxSpeed) {
        p.vx = (p.vx / speed) * maxSpeed;
        p.vy = (p.vy / speed) * maxSpeed;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.x < 0 || p.x > width) p.vx *= -1;
      if (p.y < 0 || p.y > height) p.vy *= -1;
      p.x = Math.max(0, Math.min(width, p.x));
      p.y = Math.max(0, Math.min(height, p.y));
      p.heat *= 0.92;
    }
  }

  function updateSingularity(t, dt) {
    const e = easeInOutCubic(Math.min(1, Math.max(0, t)));
    for (const p of particles) {
      if (p.held) {
        p.heat = 1;
        continue;
      }
      if (!p.captured) {
        p.ox = p.x;
        p.oy = p.y;
        p.captured = true;
      }
      applyPointerForce(p, dt);
      const fromX = p.ox ?? p.x;
      const fromY = p.oy ?? p.y;
      // After the timed collapse, keep pulling stragglers into the point
      const progress = t >= 1 ? 1 : e;
      const sx = fromX + (center.x - fromX) * progress;
      const sy = fromY + (center.y - fromY) * progress;
      const pull = t >= 1 ? Math.min(1, 20 * dt) : Math.min(1, 14 * dt);
      p.x += (sx - p.x) * pull;
      p.y += (sy - p.y) * pull;
      if (t >= 1) {
        p.x += (center.x - p.x) * Math.min(1, 16 * dt);
        p.y += (center.y - p.y) * Math.min(1, 16 * dt);
      }
      p.heat = Math.max(p.heat * 0.9, e * 0.6);
    }
  }

  function beginSingularity() {
    phase = PHASE.SINGULARITY;
    phaseStart = performance.now();
    for (const p of particles) {
      if (!p.held) {
        p.ox = p.x;
        p.oy = p.y;
        p.captured = true;
      } else {
        p.captured = false;
      }
    }
  }

  function beginBang() {
    phase = PHASE.BANG;
    phaseStart = performance.now();
    assignTargets();
    for (const p of particles) {
      p.ox = p.held ? p.x : center.x;
      p.oy = p.held ? p.y : center.y;
      p.x = p.ox;
      p.y = p.oy;
      p.held = false;
    }
    grabbed = null;
  }

  function updateBang(t) {
    const e = easeOutCubic(Math.min(1, t));
    for (const p of particles) {
      // Overshoot outward then settle into letter — big-bang feel
      const mid = Math.sin(Math.min(1, t) * Math.PI);
      const burstX = center.x + (p.tx - center.x) * (1.25 + mid * 0.35);
      const burstY = center.y + (p.ty - center.y) * (1.25 + mid * 0.35);
      const finalX = p.ox + (p.tx - p.ox) * e;
      const finalY = p.oy + (p.ty - p.oy) * e;
      const blend = Math.min(1, Math.max(0, (t - 0.35) / 0.65));
      p.x = burstX * (1 - blend) + finalX * blend;
      p.y = burstY * (1 - blend) + finalY * blend;
      p.heat = Math.max(0, 1 - t) * 0.85;
    }
  }

  function updateSettle(dt) {
    for (const p of particles) {
      applyPointerForce(p, dt);
      const jx = (Math.random() - 0.5) * 0.35;
      const jy = (Math.random() - 0.5) * 0.35;
      p.x += (p.tx + jx - p.x) * Math.min(1, 8 * dt);
      p.y += (p.ty + jy - p.y) * Math.min(1, 8 * dt);
      p.heat *= 0.9;
    }
  }

  function draw() {
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, width, height);

    for (const p of particles) {
      const r = p.held ? p.r * 1.8 : p.r;
      ctx.beginPath();
      ctx.fillStyle = p.heat > 0.05 ? mix(colors.dot, colors.hot, p.heat) : colors.dot;
      ctx.globalAlpha = p.held ? 1 : 0.85;
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function mix(a, b, t) {
    const pa = hexToRgb(a);
    const pb = hexToRgb(b);
    if (!pa || !pb) return a;
    const r = Math.round(pa.r + (pb.r - pa.r) * t);
    const g = Math.round(pa.g + (pb.g - pa.g) * t);
    const bl = Math.round(pa.b + (pb.b - pa.b) * t);
    return `rgb(${r},${g},${bl})`;
  }

  function hexToRgb(hex) {
    const h = hex.trim();
    if (h.startsWith("rgb")) {
      const m = h.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
      if (!m) return null;
      return { r: +m[1], g: +m[2], b: +m[3] };
    }
    let raw = h.replace("#", "");
    if (raw.length === 3) {
      raw = raw
        .split("")
        .map((c) => c + c)
        .join("");
    }
    if (raw.length !== 6) return null;
    return {
      r: parseInt(raw.slice(0, 2), 16),
      g: parseInt(raw.slice(2, 4), 16),
      b: parseInt(raw.slice(4, 6), 16),
    };
  }

  function tick(now) {
    const dt = Math.min(0.033, (now - (tick.prev || now)) / 1000) || 0.016;
    tick.prev = now;

    if (phase === PHASE.ROAM) {
      updateRoam(dt);
      if (now - startTime >= ROAM_MS) beginSingularity();
    } else if (phase === PHASE.SINGULARITY) {
      const t = (now - phaseStart) / SINGULARITY_MS;
      updateSingularity(t, dt);
      const anyHeld = particles.some((p) => p.held);
      const allNearCenter =
        !anyHeld &&
        particles.every((p) => Math.hypot(p.x - center.x, p.y - center.y) < 6);
      if (t >= 1 && !anyHeld && (allNearCenter || t >= 1.35)) beginBang();
    } else if (phase === PHASE.BANG) {
      const t = (now - phaseStart) / BANG_MS;
      updateBang(t);
      if (t >= 1) {
        phase = PHASE.SETTLE;
        revealContent();
      }
    } else {
      updateSettle(dt);
    }

    draw();
    raf = requestAnimationFrame(tick);
  }

  function runReduced() {
    resize();
    phase = PHASE.SETTLE;
    for (const p of particles) {
      p.x = p.tx;
      p.y = p.ty;
      p.heat = 0;
    }
    draw();
    revealContent();

    function quietLoop(now) {
      const dt = Math.min(0.033, (now - (quietLoop.prev || now)) / 1000) || 0.016;
      quietLoop.prev = now;
      for (const p of particles) {
        p.x += (p.tx - p.x) * Math.min(1, 6 * dt);
        p.y += (p.ty - p.y) * Math.min(1, 6 * dt);
      }
      draw();
      raf = requestAnimationFrame(quietLoop);
    }
    raf = requestAnimationFrame(quietLoop);
  }

  function start() {
    readColors();
    resize();
    startTime = performance.now();
    phaseStart = startTime;
    phase = PHASE.ROAM;

    if (reducedMotion) {
      runReduced();
      return;
    }

    raf = requestAnimationFrame(tick);
  }

  window.addEventListener("resize", () => {
    cancelAnimationFrame(raf);
    const wasPhase = phase;
    resize();
    if (reducedMotion || wasPhase === PHASE.SETTLE) {
      for (const p of particles) {
        p.x = p.tx;
        p.y = p.ty;
      }
      draw();
      revealContent();
      if (reducedMotion) {
        runReduced();
      } else {
        phase = PHASE.SETTLE;
        raf = requestAnimationFrame(tick);
      }
      return;
    }
    // Keep animation going after resize mid-flight
    raf = requestAnimationFrame(tick);
  });

  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    readColors();
  });
  window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
    readColors();
  });

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("pointerleave", onPointerLeave);

  // Content sits above canvas for clicks on buttons; title area is canvas
  start();
})();
