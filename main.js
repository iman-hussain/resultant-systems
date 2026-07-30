(() => {
  const canvas = document.getElementById("field");
  const content = document.getElementById("content");
  if (!canvas || !content) return;

  const ctx = canvas.getContext("2d", { alpha: false });
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const WORDMARK_FONT = '"Google Sans", "Google Sans Variable", "Segoe UI", sans-serif';
  const FULL_TEXT = "Resultant Systems Limited";
  const MOBILE_LINES = ["Resultant", "Systems", "Limited"];
  const LAYOUT_BREAKPOINT = 900;
  // Mobile: blurb + button chrome lock to the wordmark size (one shared scale)
  const MOBILE_TYPE = {
    blurb: 0.235,
    btn: 0.235,
    btnH: 0.78,
    btnPadX: 0.22,
    btnGap: 0.11,
    company: 0.175,
  };
  const DESKTOP_MAX_SPAN = 1800;
  const STACK_GAP_PX = 22;
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
  let titleLayout = { fontSize: 48, width: 0, bottom: 0, top: 0 };
  let layoutMode = null;
  let pointer = { x: -9999, y: -9999, active: false };
  /** @type {Map<number, { particle: object, startX: number, startY: number, dragging: boolean }>} */
  let pointers = new Map();
  let colors = { bg: "#0a0a0a", dot: "#f2f2f0", hot: "#9ec8ff" };
  let revealed = false;
  let raf = 0;
  const wordmarkSelect = document.getElementById("wordmark-select");
  const wordmarkSelectText = wordmarkSelect?.querySelector(".wordmark-select-text");
  const DRAG_THRESHOLD = 8;

  function isMobileLayout() {
    return window.innerWidth < LAYOUT_BREAKPOINT;
  }

  function currentLayoutMode() {
    return isMobileLayout() ? "mobile" : "desktop";
  }

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
    const band = width - padX * 2;
    const maxWidth = isMobileLayout() ? band : Math.min(band, DESKTOP_MAX_SPAN);
    const mobile = isMobileLayout();
    const lines = mobile ? MOBILE_LINES : [FULL_TEXT];
    const availableH = height * (mobile ? 0.36 : 0.28);

    let fontSize = mobile
      ? Math.min(width * 0.2, availableH / (lines.length * 1.15))
      : Math.min(maxWidth * 0.085, availableH);

    const probe = document.createElement("canvas").getContext("2d");

    const widestAt = (size) => {
      probe.font = `700 ${size}px ${WORDMARK_FONT}`;
      return Math.max(...lines.map((l) => measureLine(probe, l, size)));
    };

    let widest = widestAt(fontSize);
    if (widest > 0) {
      fontSize *= maxWidth / widest;
      widest = widestAt(fontSize);
    }
    fontSize *= 0.98;
    probe.font = `700 ${fontSize}px ${WORDMARK_FONT}`;

    const lineHeight = fontSize * 1.15;
    const blockH = lineHeight * lines.length;

    let startY;
    if (mobile) {
      // Vertically center the wordmark in the top half of the viewport
      const halfH = height * 0.5;
      const centerY = halfH * 0.5;
      startY = centerY - blockH / 2 + lineHeight / 2;
      let titleBottom = startY + (lines.length - 1) * lineHeight + fontSize * 0.5;
      const maxBottom = halfH - 10;
      if (titleBottom > maxBottom) {
        startY -= titleBottom - maxBottom;
        titleBottom = startY + (lines.length - 1) * lineHeight + fontSize * 0.5;
      }
      startY = Math.max(lineHeight * 0.55, startY);
    } else {
      startY = height * 0.3 - blockH / 2 + lineHeight / 2;
    }

    // Middle baseline: glyph extends ±fontSize/2 from each line centre
    const glyphBottom = startY + (lines.length - 1) * lineHeight + fontSize * 0.5;

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
      top: startY - fontSize * 0.5,
      bottom: glyphBottom,
    };

    // Content/blurb match the actual rendered title width (not the full pad band)
    document.documentElement.style.setProperty("--title-width", `${Math.round(maxLineW)}px`);
    document.documentElement.style.setProperty("--title-bottom", `${Math.round(glyphBottom)}px`);
    document.documentElement.style.setProperty("--stack-gap", `${STACK_GAP_PX}px`);
    document.documentElement.style.setProperty(
      "--content-top",
      `${Math.round(glyphBottom + STACK_GAP_PX)}px`
    );
    document.documentElement.style.setProperty("--page-pad", `${Math.round(padX)}px`);
    document.documentElement.style.setProperty("--wordmark-size", `${fontSize}px`);
    if (mobile) {
      syncMobileType(fontSize);
    } else {
      clearMobileTypeOverrides();
      fitBlurbToTitle(maxLineW);
    }
    syncWordmarkSelect(mobile, fontSize, titleLayout.top, maxLineW);

    return letters;
  }

  function syncWordmarkSelect(mobile, fontSize, top, maxLineW) {
    if (!wordmarkSelect || !wordmarkSelectText) return;
    wordmarkSelectText.classList.toggle("is-stacked", !!mobile);
    wordmarkSelectText.innerHTML = mobile
      ? "Resultant<br />Systems<br />Limited"
      : "Resultant Systems Limited";
    wordmarkSelect.style.top = `${Math.max(0, top)}px`;
    wordmarkSelect.style.width = `${Math.ceil(maxLineW)}px`;
    document.documentElement.style.setProperty("--wordmark-size", `${fontSize}px`);
  }

  function setWordmarkSelectActive(active) {
    if (!wordmarkSelect) return;
    wordmarkSelect.hidden = !active;
    wordmarkSelect.classList.toggle("is-active", active);
    wordmarkSelect.setAttribute("aria-hidden", active ? "false" : "true");
  }

  function updateWordmarkDraggingState() {
    if (!wordmarkSelect) return;
    const anyDrag = [...pointers.values()].some((d) => d.dragging);
    wordmarkSelect.classList.toggle("is-dragging", anyDrag);
  }

  function clearMobileTypeOverrides() {
    const blurb = content.querySelector(".blurb");
    if (blurb) blurb.style.fontSize = "";
    const root = document.documentElement.style;
    root.removeProperty("--btn-font");
    root.removeProperty("--btn-h");
    root.removeProperty("--btn-pad-x");
    root.removeProperty("--btn-gap");
    root.removeProperty("--company-font");
  }

  function syncMobileType(titleFont) {
    const blurb = content.querySelector(".blurb");
    const root = document.documentElement.style;
    const blurbPx = titleFont * MOBILE_TYPE.blurb;
    const btnPx = titleFont * MOBILE_TYPE.btn;

    if (blurb) blurb.style.fontSize = `${blurbPx.toFixed(2)}px`;
    root.setProperty("--btn-font", `${btnPx.toFixed(2)}px`);
    root.setProperty("--btn-h", `${(titleFont * MOBILE_TYPE.btnH).toFixed(2)}px`);
    root.setProperty("--btn-pad-x", `${(titleFont * MOBILE_TYPE.btnPadX).toFixed(2)}px`);
    root.setProperty("--btn-gap", `${(titleFont * MOBILE_TYPE.btnGap).toFixed(2)}px`);
    root.setProperty("--company-font", `${(titleFont * MOBILE_TYPE.company).toFixed(2)}px`);
  }

  function fitBlurbToTitle(titleWidth) {
    const blurb = content.querySelector(".blurb");
    const desktop = content.querySelector(".blurb-desktop");
    if (!blurb || !desktop) return;

    const text = (desktop.textContent || "").replace(/\s+/g, " ").trim();
    const { fontFamily, fontWeight } = getComputedStyle(blurb);
    const probe = document.createElement("canvas").getContext("2d");

    let lo = 8;
    let hi = 64;
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      probe.font = `${fontWeight} ${mid}px ${fontFamily}`;
      if (probe.measureText(text).width > titleWidth) hi = mid;
      else lo = mid;
    }
    blurb.style.fontSize = `${lo.toFixed(2)}px`;
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
        returning: false,
      };
    });
  }

  /** Greedy unique matching: each dot takes the nearest free letter slot. */
  function assignNearestLetters(targets) {
    const slots = targets.map((t) => ({ ...t, taken: false }));
    const pairs = [];
    for (let pi = 0; pi < particles.length; pi++) {
      for (let ti = 0; ti < slots.length; ti++) {
        const p = particles[pi];
        const t = slots[ti];
        const dx = p.x - t.tx;
        const dy = p.y - t.ty;
        pairs.push({ pi, ti, d: dx * dx + dy * dy });
      }
    }
    pairs.sort((a, b) => a.d - b.d);

    const usedP = new Set();
    for (const { pi, ti } of pairs) {
      if (usedP.has(pi) || slots[ti].taken) continue;
      const p = particles[pi];
      const t = slots[ti];
      p.char = t.char;
      p.tx = t.tx;
      p.ty = t.ty;
      p.fontSize = t.fontSize;
      slots[ti].taken = true;
      usedP.add(pi);
      if (usedP.size === particles.length) break;
    }
  }

  function applyTargetsInOrder(targets) {
    particles.forEach((p, i) => {
      const t = targets[i];
      if (!t) return;
      p.char = t.char;
      p.tx = t.tx;
      p.ty = t.ty;
      p.fontSize = t.fontSize;
      if (p.formed || phase === PHASE.SETTLE) {
        p.x = p.tx;
        p.y = p.ty;
        p.morph = 1;
        p.formed = true;
      }
    });
  }

  function resizeCanvasOnly() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const newW = window.innerWidth;
    const newH = window.innerHeight;
    canvas.width = Math.floor(newW * dpr);
    canvas.height = Math.floor(newH * dpr);
    canvas.style.width = `${newW}px`;
    canvas.style.height = `${newH}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { newW, newH };
  }

  function fullRelayout() {
    const { newW, newH } = resizeCanvasOnly();
    width = newW;
    height = newH;
    readColors();
    layoutMode = currentLayoutMode();

    if (!particles.length) {
      createParticles();
      return;
    }

    const targets = buildLetterTargets();
    if (phase === PHASE.SNAP) {
      applyTargetsInOrder(targets);
      assignNearestLetters(targets);
    } else {
      applyTargetsInOrder(targets);
    }
  }

  function handleResize() {
    fullRelayout();
  }

  function revealContent() {
    if (revealed) return;
    revealed = true;
    content.dataset.revealed = "true";
    setWordmarkSelectActive(true);
  }

  function nearestParticle(x, y, { forSettleDrag = false } = {}) {
    let best = null;
    let bestDist = Infinity;
    for (const p of particles) {
      if (isParticleClaimed(p)) continue;
      if (forSettleDrag) {
        if (p.returning || p.held) continue;
        if (!p.formed) continue;
      } else if (p.formed) {
        continue;
      }
      const radius = forSettleDrag ? Math.max(GRAB_RADIUS, p.fontSize * 0.45) : GRAB_RADIUS;
      const dx = p.x - x;
      const dy = p.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < radius * radius && d2 < bestDist) {
        bestDist = d2;
        best = p;
      }
    }
    return best;
  }

  function isParticleClaimed(p) {
    for (const d of pointers.values()) {
      if (d.particle === p) return true;
    }
    return false;
  }

  function pointerPos(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onPointerDown(e) {
    const pos = pointerPos(e);
    pointer.x = pos.x;
    pointer.y = pos.y;
    pointer.active = true;

    if (phase === PHASE.SETTLE) {
      const hit = nearestParticle(pos.x, pos.y, { forSettleDrag: true });
      if (!hit) return;
      pointers.set(e.pointerId, {
        particle: hit,
        startX: pos.x,
        startY: pos.y,
        dragging: false,
      });
      try {
        (e.currentTarget || wordmarkSelect || canvas).setPointerCapture?.(e.pointerId);
      } catch (_) {
        /* ignore */
      }
      return;
    }

    const hit = nearestParticle(pos.x, pos.y);
    if (hit && !hit.formed) {
      pointers.set(e.pointerId, {
        particle: hit,
        startX: pos.x,
        startY: pos.y,
        dragging: true,
      });
      hit.held = true;
      hit.formed = false;
      hit.morph = 0;
      try {
        canvas.setPointerCapture?.(e.pointerId);
      } catch (_) {
        /* ignore */
      }
    }
  }

  function onPointerMove(e) {
    const pos = pointerPos(e);
    pointer.x = pos.x;
    pointer.y = pos.y;
    pointer.active = true;

    const entry = pointers.get(e.pointerId);
    if (!entry) return;

    const p = entry.particle;

    if (phase === PHASE.SETTLE && !entry.dragging) {
      const dist = Math.hypot(pos.x - entry.startX, pos.y - entry.startY);
      if (dist < DRAG_THRESHOLD) return;
      entry.dragging = true;
      p.held = true;
      p.formed = false;
      p.morph = 0;
      p.returning = false;
      window.getSelection()?.removeAllRanges();
      updateWordmarkDraggingState();
    }

    if (entry.dragging || phase !== PHASE.SETTLE) {
      p.x = pos.x;
      p.y = pos.y;
      p.vx = 0;
      p.vy = 0;
      if (phase === PHASE.SETTLE) {
        p.morph = 0;
        p.held = true;
        p.formed = false;
      }
    }
  }

  function onPointerUp(e) {
    const entry = pointers.get(e.pointerId);
    if (!entry) {
      if (pointers.size === 0) {
        pointer.active = false;
        pointer.x = -9999;
        pointer.y = -9999;
      }
      return;
    }

    const p = entry.particle;
    pointers.delete(e.pointerId);
    updateWordmarkDraggingState();

    if (phase === PHASE.SETTLE) {
      if (entry.dragging) {
        p.held = false;
        p.returning = true;
        p.formed = false;
        p.ox = p.x;
        p.oy = p.y;
      }
      // Tap without drag: leave letter in place (selection may copy)
    } else {
      p.held = false;
      if (phase === PHASE.SNAP) {
        p.ox = p.x;
        p.oy = p.y;
      }
    }

    if (pointers.size === 0) {
      pointer.active = false;
      pointer.x = -9999;
      pointer.y = -9999;
    }
  }

  function onPointerLeave() {
    if (pointers.size > 0) return;
    pointer.active = false;
    pointer.x = -9999;
    pointer.y = -9999;
  }

  function applyPointerForce(p, dt) {
    if (!pointer.active || p.held || p.formed || p.returning) return;
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
    const targets = buildLetterTargets();
    assignNearestLetters(targets);
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

      if (p.returning) {
        p.x += (p.tx - p.x) * Math.min(1, 16 * dt);
        p.y += (p.ty - p.y) * Math.min(1, 16 * dt);
        p.morph = Math.min(1, p.morph + dt * 8);
        if (Math.hypot(p.x - p.tx, p.y - p.ty) < 1.2 && p.morph >= 0.98) {
          p.x = p.tx;
          p.y = p.ty;
          p.morph = 1;
          p.formed = true;
          p.returning = false;
        }
        continue;
      }

      if (!p.formed) {
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
      p.x = p.tx;
      p.y = p.ty;
      p.heat *= 0.92;
      p.morph = 1;
    }
  }

  function drawParticle(p) {
    const fill = p.heat > 0.04 ? mix(colors.dot, colors.hot, p.heat) : colors.dot;
    ctx.fillStyle = fill;
    ctx.globalAlpha = 1;

    const asDot = p.morph <= 0.02 || p.held;
    if (asDot) {
      const r = p.held ? Math.max(6, p.fontSize * 0.18) : 4.2;
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
    fullRelayout();
    phase = PHASE.SETTLE;
    for (const p of particles) {
      p.x = p.tx;
      p.y = p.ty;
      p.morph = 1;
      p.formed = true;
      p.heat = 0;
      p.returning = false;
    }
    draw();
    revealContent();

    function quietLoop(now) {
      const dt = Math.min(0.033, (now - (quietLoop.prev || now)) / 1000) || 0.016;
      quietLoop.prev = now;
      updateSettle(dt);
      draw();
      raf = requestAnimationFrame(quietLoop);
    }
    raf = requestAnimationFrame(quietLoop);
  }

  async function start() {
    readColors();
    try {
      await document.fonts.load(`700 64px ${WORDMARK_FONT}`);
      await document.fonts.load('500 18px "Instrument Sans"');
      await document.fonts.ready;
    } catch (_) {
      /* fall back */
    }
    fullRelayout();
    startTime = performance.now();
    phaseStart = startTime;
    phase = PHASE.ROAM;

    if (reducedMotion) {
      runReduced();
      return;
    }
    raf = requestAnimationFrame(tick);
  }

  let resizeRaf = 0;
  window.addEventListener("resize", () => {
    if (resizeRaf) return;
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = 0;
      handleResize();
    });
  });

  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", readColors);
  window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", readColors);

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("pointerleave", onPointerLeave);

  if (wordmarkSelect) {
    wordmarkSelect.addEventListener("pointerdown", onPointerDown);
    wordmarkSelect.addEventListener("pointermove", onPointerMove);
    wordmarkSelect.addEventListener("pointerup", onPointerUp);
    wordmarkSelect.addEventListener("pointercancel", onPointerUp);
  }

  // Keep drag tracking if capture moves off the original target
  window.addEventListener("pointermove", (e) => {
    if (pointers.has(e.pointerId)) onPointerMove(e);
  });
  window.addEventListener("pointerup", (e) => {
    if (pointers.has(e.pointerId)) onPointerUp(e);
  });
  window.addEventListener("pointercancel", (e) => {
    if (pointers.has(e.pointerId)) onPointerUp(e);
  });

  start();
})();
