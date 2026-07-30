(() => {
  const canvas = document.getElementById("field");
  const content = document.getElementById("content");
  if (!canvas || !content) return;

  const ctx = canvas.getContext("2d", { alpha: false });
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const isNarrow = () => window.matchMedia("(max-width: 720px)").matches;

  const WORDMARK_FONT = '"Google Sans", "Google Sans Variable", "Segoe UI", sans-serif';
  const FULL_TEXT = "Resultant Systems Limited";
  const MOBILE_LINES = ["Resultant", "Systems", "Limited"];

  const ROAM_MS = 900;
  const SNAP_MS = 100;
  const GRAB_RADIUS = 48;
  const MAX_SPEED = 55;

  const PHASE = {
    ROAM: "roam",
    SNAP: "snap",
    SETTLE: "settle",
  };

  let width = 0;
  let height = 0;
  let dpr = 1;
  let particles = [];
  let phase = PHASE.ROAM;
  let phaseStart = 0;
  let startTime = 0;
  let titleLayout = { fontSize: 48, width: 0, bottom: 0 };
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

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
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

  function measureLine(octx, text, fontSize) {
    octx.font = `700 ${fontSize}px ${WORDMARK_FONT}`;
    return octx.measureText(text).width;
  }

  function buildLetterTargets() {
    const padX = Math.max(20, width * 0.04);
    const maxWidth = width - padX * 2;
    const lines = isNarrow() ? MOBILE_LINES : [FULL_TEXT];
    const availableH = height * (isNarrow() ? 0.36 : 0.28);

    let fontSize = isNarrow()
      ? Math.min(width * 0.16, availableH / (lines.length * 1.15))
      : Math.min(width * 0.085, availableH);

    const probe = document.createElement("canvas").getContext("2d");
    probe.font = `700 ${fontSize}px ${WORDMARK_FONT}`;

    const fit = () => {
      const widest = Math.max(...lines.map((l) => measureLine(probe, l, fontSize)));
      if (widest > maxWidth) {
        fontSize *= maxWidth / widest;
        probe.font = `700 ${fontSize}px ${WORDMARK_FONT}`;
      }
    };
    fit();
    // Extra safety shrink so nothing clips
    fontSize *= 0.98;
    probe.font = `700 ${fontSize}px ${WORDMARK_FONT}`;

    const lineHeight = fontSize * 1.15;
    const blockH = lineHeight * lines.length;
    const startY = height * (isNarrow() ? 0.22 : 0.3) - blockH / 2 + lineHeight / 2;

    const letters = [];
    let maxLineW = 0;

    lines.forEach((line, lineIndex) => {
      const lineW = measureLine(probe, line, fontSize);
      maxLineW = Math.max(maxLineW, lineW);
      const lineStart = width / 2 - lineW / 2;
      const y = startY + lineIndex * lineHeight;

      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === " ") continue;
        const before = measureLine(probe, line.slice(0, i), fontSize);
        const after = measureLine(probe, line.slice(0, i + 1), fontSize);
        letters.push({
          char,
          tx: lineStart + (before + after) / 2,
          ty: y,
          fontSize,
        });
      }
    });

    titleLayout = {
      fontSize,
      width: maxLineW,
      bottom: startY + (lines.length - 1) * lineHeight + fontSize * 0.55,
    };

    document.documentElement.style.setProperty("--title-width", `${Math.ceil(maxLineW)}px`);
    document.documentElement.style.setProperty("--title-bottom", `${Math.ceil(titleLayout.bottom)}px`);

    return letters;
  }

  function createParticles() {
    const targets = buildLetterTargets();
    particles = targets.map((t) => {
      const angle = Math.random() * Math.PI * 2;
      const speed = 25 + Math.random() * 30;
      return {
        char: t.char,
        tx: t.tx,
        ty: t.ty,
        fontSize: t.fontSize,
        x: Math.random() * width,
        y: Math.random() * height,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        ox: null,
        oy: null,
        heat: 0,
        held: false,
        formed: false,
        morph: 0,
      };
    });
  }

  function refreshTargets() {
    const targets = buildLetterTargets();
    particles.forEach((p, i) => {
      const t = targets[i];
      if (!t) return;
      p.tx = t.tx;
      p.ty = t.ty;
      p.fontSize = t.fontSize;
      if (phase === PHASE.SETTLE && p.formed) {
        p.x = p.tx;
        p.y = p.ty;
        p.morph = 1;
      }
    });
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
    readColors();

    if (!particles.length) createParticles();
    else refreshTargets();
  }

  function revealContent() {
    if (revealed) return;
    revealed = true;
    content.dataset.revealed = "true";
  }

  function nearestParticle(x, y) {
    let best = null;
    let bestDist = GRAB_RADIUS * GRAB_RADIUS;
    for (const p of particles) {
      if (p.formed && phase === PHASE.SETTLE) continue;
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
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onPointerDown(e) {
    if (phase === PHASE.SETTLE) return;
    const pos = pointerPos(e);
    pointer.x = pos.x;
    pointer.y = pos.y;
    pointer.active = true;
    const hit = nearestParticle(pos.x, pos.y);
    if (hit && !hit.formed) {
      grabbed = hit;
      hit.held = true;
      hit.formed = false;
      hit.morph = 0;
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
      if (phase === PHASE.SNAP || phase === PHASE.SETTLE) {
        grabbed.ox = grabbed.x;
        grabbed.oy = grabbed.y;
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
    if (!pointer.active || p.held || p.formed) return;
    const dx = p.x - pointer.x;
    const dy = p.y - pointer.y;
    const dist = Math.hypot(dx, dy) || 1;
    const radius = 110;
    if (dist < radius) {
      const force = (1 - dist / radius) * 90;
      p.vx += (-dy / dist) * force * dt;
      p.vy += (dx / dist) * force * dt;
      p.heat = Math.min(1, p.heat + (1 - dist / radius) * 0.12);
    }
  }

  function updateRoam(dt) {
    for (const p of particles) {
      if (p.held) continue;
      applyPointerForce(p, dt);
      p.vx += (Math.random() - 0.5) * 40 * dt;
      p.vy += (Math.random() - 0.5) * 40 * dt;
      const speed = Math.hypot(p.vx, p.vy);
      if (speed > MAX_SPEED) {
        p.vx = (p.vx / speed) * MAX_SPEED;
        p.vy = (p.vy / speed) * MAX_SPEED;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.x < 8 || p.x > width - 8) p.vx *= -1;
      if (p.y < 8 || p.y > height - 8) p.vy *= -1;
      p.x = Math.max(8, Math.min(width - 8, p.x));
      p.y = Math.max(8, Math.min(height - 8, p.y));
      p.heat *= 0.94;
      p.morph = 0;
    }
  }

  function beginSnap() {
    phase = PHASE.SNAP;
    phaseStart = performance.now();
    for (const p of particles) {
      if (!p.held) {
        p.ox = p.x;
        p.oy = p.y;
      }
    }
  }

  function updateSnap(t) {
    const e = easeOutCubic(t);
    for (const p of particles) {
      if (p.held) {
        p.morph = 0;
        p.formed = false;
        continue;
      }
      if (p.ox == null || p.oy == null) {
        p.ox = p.x;
        p.oy = p.y;
      }
      p.x = p.ox + (p.tx - p.ox) * e;
      p.y = p.oy + (p.ty - p.oy) * e;
      p.morph = e;
      p.heat *= 0.9;
      if (t >= 1) {
        p.x = p.tx;
        p.y = p.ty;
        p.morph = 1;
        p.formed = true;
      }
    }
  }

  function updateSettle(dt) {
    for (const p of particles) {
      if (p.held) continue;
      if (!p.formed) {
        // Late release: rush home and form
        p.x += (p.tx - p.x) * Math.min(1, 18 * dt);
        p.y += (p.ty - p.y) * Math.min(1, 18 * dt);
        p.morph = Math.min(1, p.morph + dt * 10);
        if (Math.hypot(p.x - p.tx, p.y - p.ty) < 1.5 && p.morph >= 1) {
          p.formed = true;
          p.x = p.tx;
          p.y = p.ty;
        }
        continue;
      }
      applyPointerForce(p, dt);
      const jx = (Math.random() - 0.5) * 0.25;
      const jy = (Math.random() - 0.5) * 0.25;
      p.x += (p.tx + jx - p.x) * Math.min(1, 10 * dt);
      p.y += (p.ty + jy - p.y) * Math.min(1, 10 * dt);
      p.heat *= 0.92;
      p.morph = 1;
    }
  }

  function drawParticle(p) {
    const fill = p.heat > 0.04 ? mix(colors.dot, colors.hot, p.heat) : colors.dot;
    ctx.fillStyle = fill;
    ctx.globalAlpha = 1;

    if (p.morph <= 0.02) {
      const r = p.held ? 5.5 : 4.2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    const size = p.fontSize * (0.15 + 0.85 * p.morph);
    ctx.font = `700 ${size}px ${WORDMARK_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.globalAlpha = 0.35 + 0.65 * p.morph;
    ctx.fillText(p.char, p.x, p.y);

    if (p.morph < 0.85) {
      ctx.globalAlpha = 1 - p.morph;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4.2 * (1 - p.morph), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function draw() {
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, width, height);
    for (const p of particles) drawParticle(p);
  }

  function allFormedOrHeld() {
    return particles.every((p) => p.formed || p.held);
  }

  function tick(now) {
    const dt = Math.min(0.033, (now - (tick.prev || now)) / 1000) || 0.016;
    tick.prev = now;

    if (phase === PHASE.ROAM) {
      updateRoam(dt);
      if (now - startTime >= ROAM_MS) beginSnap();
    } else if (phase === PHASE.SNAP) {
      const t = (now - phaseStart) / SNAP_MS;
      updateSnap(t);
      if (t >= 1) {
        phase = PHASE.SETTLE;
        // Held letters stay as dots until released
        revealContent();
      }
    } else {
      updateSettle(dt);
      if (!revealed && allFormedOrHeld()) revealContent();
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
      p.morph = 1;
      p.formed = true;
      p.heat = 0;
    }
    draw();
    revealContent();

    function quietLoop(now) {
      const dt = Math.min(0.033, (now - (quietLoop.prev || now)) / 1000) || 0.016;
      quietLoop.prev = now;
      for (const p of particles) {
        p.x += (p.tx - p.x) * Math.min(1, 8 * dt);
        p.y += (p.ty - p.y) * Math.min(1, 8 * dt);
      }
      draw();
      raf = requestAnimationFrame(quietLoop);
    }
    raf = requestAnimationFrame(quietLoop);
  }

  async function start() {
    readColors();
    try {
      await document.fonts.load(`700 64px ${WORDMARK_FONT}`);
      await document.fonts.ready;
    } catch (_) {
      /* fall back to system metrics */
    }
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
    resize();
    if (reducedMotion || phase === PHASE.SETTLE) {
      for (const p of particles) {
        if (p.formed || reducedMotion) {
          p.x = p.tx;
          p.y = p.ty;
          p.morph = 1;
          p.formed = true;
        }
      }
      draw();
      revealContent();
      phase = PHASE.SETTLE;
      raf = requestAnimationFrame(tick);
      return;
    }
    raf = requestAnimationFrame(tick);
  });

  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", readColors);
  window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", readColors);

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("pointerleave", onPointerLeave);

  start();
})();
