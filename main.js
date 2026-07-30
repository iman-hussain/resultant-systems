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
  /** Phone landscape / short browser chrome — compact layout only below this height */
  const SHORT_HEIGHT = 500;
  // Mobile: blurb + button chrome lock to the wordmark size (one shared scale)
  const MOBILE_TYPE = {
    blurb: 0.235,
    btn: 0.235,
    btnH: 0.92,
    btnPadX: 0.22,
    btnGap: 0.11,
    company: 0.175,
  };
  /** Slightly tighter type scale when viewport height is short (landscape phones) */
  const MOBILE_TYPE_SHORT = {
    blurb: 0.2,
    btn: 0.2,
    btnH: 0.82,
    btnPadX: 0.18,
    btnGap: 0.09,
    company: 0.15,
  };
  const DESKTOP_MAX_SPAN = 1800;
  const STACK_GAP_PX = 22;
  const STACK_GAP_SHORT_PX = 12;
  const ROAM_MS = 1000;
  const SNAP_MS = 1000;
  const GRAB_RADIUS = 48;
  const MAX_SPEED = 42;
  /** Underdamped spring for drag-release snap-back (overshoots, then settles). */
  const RETURN_STIFFNESS = 260;
  const RETURN_DAMPING = 14;

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
  let pendingLayout = false;
  /** At snap start: were any free dots still in/below the content band? */
  let snapHadDotsInContent = false;
  const wordmarkSelect = document.getElementById("wordmark-select");
  const wordmarkSelectText = wordmarkSelect?.querySelector(".wordmark-select-text");
  const DRAG_THRESHOLD = 8;

  function viewportSize() {
    const vv = window.visualViewport;
    return {
      w: Math.round(vv?.width || window.innerWidth),
      h: Math.round(vv?.height || window.innerHeight),
    };
  }

  function isMobileLayout() {
    return viewportSize().w < LAYOUT_BREAKPOINT;
  }

  function isShortViewport() {
    return viewportSize().h < SHORT_HEIGHT;
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

  const THEME_CYCLE = ["auto", "dark", "sepia", "light"];
  const THEME_LABELS = { auto: "Auto", dark: "Dark", sepia: "Sepia", light: "Light" };
  const themeToggle = document.getElementById("theme-toggle");
  const themeColorMeta = document.getElementById("theme-color-dynamic");

  function normalizeTheme(value) {
    return THEME_CYCLE.includes(value) ? value : "auto";
  }

  function currentTheme() {
    return normalizeTheme(document.documentElement.dataset.theme);
  }

  function updateThemeChrome(mode) {
    if (themeToggle) {
      const label = THEME_LABELS[mode];
      const valueEl = themeToggle.querySelector(".theme-toggle-value");
      if (valueEl) valueEl.textContent = label;
      themeToggle.setAttribute(
        "aria-label",
        `Colour theme: ${label}. Click to cycle Auto, Dark, Sepia, Light.`
      );
    }
    if (themeColorMeta) {
      readColors();
      themeColorMeta.setAttribute("content", colors.bg);
    }
  }

  function applyTheme(mode, { persist = true } = {}) {
    const next = normalizeTheme(mode);
    document.documentElement.dataset.theme = next;
    if (persist) {
      try {
        localStorage.setItem("theme", next);
      } catch (_) {
        /* private mode */
      }
    }
    updateThemeChrome(next);
    readColors();
  }

  function cycleTheme() {
    const idx = THEME_CYCLE.indexOf(currentTheme());
    applyTheme(THEME_CYCLE[(idx + 1) % THEME_CYCLE.length]);
  }

  /** Soft start, decisive settle — reads better on a longer snap. */
  function easeInOutCubic(t) {
    const x = Math.min(1, Math.max(0, t));
    return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
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

  /** Radius of the tittle on lowercase “i” at the wordmark size (scales with content). */
  const iDotRadiusCache = new Map();
  function iDotRadius(fontSize) {
    const key = Math.round(fontSize * 4) / 4;
    const cached = iDotRadiusCache.get(key);
    if (cached != null) return cached;

    const pad = Math.ceil(key * 1.4);
    const size = Math.max(8, pad * 2);
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    const octx = c.getContext("2d", { willReadFrequently: true });
    if (!octx) {
      const fallback = Math.max(2, key * 0.07);
      iDotRadiusCache.set(key, fallback);
      return fallback;
    }

    const cx = size / 2;
    const cy = size / 2;
    octx.font = `700 ${key}px ${WORDMARK_FONT}`;
    octx.textAlign = "center";
    octx.textBaseline = "middle";

    octx.clearRect(0, 0, size, size);
    octx.fillStyle = "#fff";
    octx.fillText("i", cx, cy);
    const withDot = octx.getImageData(0, 0, size, size).data;

    octx.clearRect(0, 0, size, size);
    octx.fillText("ı", cx, cy);
    const withoutDot = octx.getImageData(0, 0, size, size).data;

    let minX = size;
    let minY = size;
    let maxX = 0;
    let maxY = 0;
    let found = false;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        // Ink present on “i” but not on dotless “ı” → tittle
        if (withDot[i] > 40 && withoutDot[i] < 40) {
          found = true;
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }

    const r = found
      ? Math.max(2, (Math.max(maxX - minX, maxY - minY) + 1) / 2)
      : Math.max(2, key * 0.07);
    iDotRadiusCache.set(key, r);
    return r;
  }

  function widestLineWidth(probe, lines, size) {
    probe.font = `700 ${size}px ${WORDMARK_FONT}`;
    return Math.max(...lines.map((l) => measureLine(probe, l, size)));
  }

  /** Emergency phone-landscape: wordmark left, blurb + buttons right */
  function buildShortLandscapeLetterTargets(padX) {
    const lines = MOBILE_LINES;
    const colGap = Math.max(16, width * 0.025);
    const band = width - padX * 2;
    const leftMax = band * 0.44;
    const availableH = height - Math.max(12, height * 0.06);
    const stackGap = STACK_GAP_SHORT_PX;
    const probe = document.createElement("canvas").getContext("2d");

    let fontSize = (availableH / (lines.length * 1.15)) * 0.92;
    let widest = widestLineWidth(probe, lines, fontSize);
    if (widest > leftMax && widest > 0) {
      fontSize *= leftMax / widest;
      widest = widestLineWidth(probe, lines, fontSize);
    }
    fontSize *= 0.98;
    widest = widestLineWidth(probe, lines, fontSize);

    const lineHeight = fontSize * 1.15;
    const blockH = lineHeight * lines.length;
    const leftColW = Math.ceil(widest);
    const leftColStart = padX;
    const startY = height / 2 - blockH / 2 + lineHeight / 2;
    const glyphBottom = startY + (lines.length - 1) * lineHeight + fontSize * 0.5;
    const glyphTop = startY - fontSize * 0.5;

    const letters = [];
    let maxLineW = 0;
    lines.forEach((line, lineIndex) => {
      const lineW = measureLine(probe, line, fontSize);
      maxLineW = Math.max(maxLineW, lineW);
      const lineStart = leftColStart + leftColW - lineW;
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

    const contentLeft = leftColStart + leftColW + colGap;
    const contentWidth = Math.max(120, width - contentLeft - padX);

    titleLayout = {
      fontSize,
      width: maxLineW,
      top: glyphTop,
      bottom: glyphBottom,
    };

    const root = document.documentElement.style;
    root.setProperty("--title-width", `${Math.round(contentWidth)}px`);
    root.setProperty("--title-bottom", `${Math.round(glyphBottom)}px`);
    root.setProperty("--stack-gap", `${stackGap}px`);
    root.setProperty("--content-top", "0px");
    root.setProperty("--content-left", `${Math.round(contentLeft)}px`);
    root.setProperty("--content-width", `${Math.round(contentWidth)}px`);
    root.setProperty("--page-pad", `${Math.round(padX)}px`);
    root.setProperty("--wordmark-size", `${fontSize}px`);
    document.documentElement.classList.add("is-short-viewport");

    syncMobileType(fontSize, contentWidth, true);
    syncWordmarkSelect(true, fontSize, glyphTop, maxLineW, {
      left: leftColStart,
      width: leftColW,
    });

    return letters;
  }

  function buildLetterTargets() {
    const padX = Math.max(20, width * 0.04);
    const band = width - padX * 2;
    const maxWidth = isMobileLayout() ? band : Math.min(band, DESKTOP_MAX_SPAN);
    const mobile = isMobileLayout();
    const short = mobile && isShortViewport();
    if (short) {
      return buildShortLandscapeLetterTargets(padX);
    }

    document.documentElement.classList.remove("is-short-viewport");
    document.documentElement.style.removeProperty("--content-left");
    document.documentElement.style.removeProperty("--content-width");

    const lines = mobile ? MOBILE_LINES : [FULL_TEXT];
    const stackGap = STACK_GAP_PX;
    const availableH = height * (mobile ? 0.36 : 0.28);

    let fontSize = mobile
      ? Math.min(width * 0.2, availableH / (lines.length * 1.15))
      : Math.min(maxWidth * 0.085, availableH);

    const probe = document.createElement("canvas").getContext("2d");

    let widest = widestLineWidth(probe, lines, fontSize);
    if (widest > 0) {
      fontSize *= maxWidth / widest;
      widest = widestLineWidth(probe, lines, fontSize);
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
    document.documentElement.style.setProperty("--stack-gap", `${stackGap}px`);
    document.documentElement.style.setProperty(
      "--content-top",
      `${Math.round(glyphBottom + stackGap)}px`
    );
    document.documentElement.style.setProperty("--page-pad", `${Math.round(padX)}px`);
    document.documentElement.style.setProperty("--wordmark-size", `${fontSize}px`);
    if (mobile) {
      syncMobileType(fontSize, maxLineW, false);
    } else {
      clearMobileTypeOverrides();
      fitBlurbToTitle(maxLineW);
    }
    syncWordmarkSelect(mobile, fontSize, titleLayout.top, maxLineW, null);

    return letters;
  }

  function syncWordmarkSelect(mobile, fontSize, top, maxLineW, shortLayout) {
    if (!wordmarkSelect || !wordmarkSelectText) return;
    wordmarkSelectText.classList.toggle("is-stacked", !!mobile);
    wordmarkSelectText.innerHTML = mobile
      ? "Resultant<br />Systems<br />Limited"
      : "Resultant Systems Limited";
    wordmarkSelect.style.top = `${Math.max(0, top)}px`;
    document.documentElement.style.setProperty("--wordmark-size", `${fontSize}px`);

    if (shortLayout) {
      wordmarkSelect.style.left = `${shortLayout.left}px`;
      wordmarkSelect.style.transform = "none";
      wordmarkSelect.style.width = `${Math.ceil(shortLayout.width)}px`;
      wordmarkSelect.style.maxWidth = "none";
    } else {
      wordmarkSelect.style.left = "";
      wordmarkSelect.style.transform = "";
      wordmarkSelect.style.width = `${Math.ceil(maxLineW)}px`;
      wordmarkSelect.style.maxWidth = "";
    }
  }

  function setWordmarkSelectActive(active) {
    if (!wordmarkSelect) return;
    wordmarkSelect.hidden = !active;
    wordmarkSelect.classList.toggle("is-active", active);
    wordmarkSelect.setAttribute("aria-hidden", active ? "false" : "true");
    const pageTitle = document.getElementById("page-title");
    if (pageTitle) pageTitle.hidden = !!active;
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

  function syncMobileType(titleFont, titleWidth, short = false) {
    const blurb = content.querySelector(".blurb");
    const mobileBlurb = content.querySelector(".blurb-mobile");
    const root = document.documentElement.style;
    const type = short ? MOBILE_TYPE_SHORT : MOBILE_TYPE;
    let blurbPx = titleFont * type.blurb;
    const btnPx = titleFont * type.btn;

    if (short) {
      // Landscape right column: wrap naturally; size for readability in the column
      blurbPx = Math.min(Math.max(titleFont * 0.28, 14), 21);
      if (blurb) blurb.style.fontSize = `${blurbPx.toFixed(2)}px`;
      const btnH = Math.min(Math.max(titleFont * 0.58, 36), 52);
      root.setProperty("--btn-font", `${Math.min(btnPx, 15).toFixed(2)}px`);
      root.setProperty("--btn-h", `${btnH.toFixed(2)}px`);
      root.setProperty("--btn-pad-x", `${(btnH * 0.35).toFixed(2)}px`);
      root.setProperty("--btn-gap", `${Math.max(8, titleFont * 0.12).toFixed(2)}px`);
      root.setProperty("--company-font", `${Math.min(titleFont * 0.12, 9).toFixed(2)}px`);
      return;
    }

    // Keep the three hard lines from wrapping (which would become 4+ visual lines)
    if (blurb && mobileBlurb && titleWidth > 0) {
      const lines = mobileBlurb.innerHTML
        .split(/<br\s*\/?>/i)
        .map((s) =>
          s
            .replace(/<[^>]+>/g, "")
            .replace(/&amp;/g, "&")
            .replace(/\s+/g, " ")
            .trim()
        )
        .filter(Boolean);
      const { fontFamily, fontWeight } = getComputedStyle(blurb);
      const probe = document.createElement("canvas").getContext("2d");
      const fits = (size) => {
        probe.font = `${fontWeight} ${size}px ${fontFamily}`;
        return lines.every((line) => probe.measureText(line).width <= titleWidth);
      };
      if (!fits(blurbPx)) {
        let lo = 8;
        let hi = blurbPx;
        for (let i = 0; i < 18; i++) {
          const mid = (lo + hi) / 2;
          if (fits(mid)) lo = mid;
          else hi = mid;
        }
        blurbPx = lo;
      }
      blurb.style.fontSize = `${blurbPx.toFixed(2)}px`;
    } else if (blurb) {
      blurb.style.fontSize = `${blurbPx.toFixed(2)}px`;
    }

    root.setProperty("--btn-font", `${btnPx.toFixed(2)}px`);
    root.setProperty("--btn-h", `${(titleFont * type.btnH).toFixed(2)}px`);
    root.setProperty("--btn-pad-x", `${(titleFont * type.btnPadX).toFixed(2)}px`);
    root.setProperty("--btn-gap", `${(titleFont * type.btnGap).toFixed(2)}px`);
    root.setProperty("--company-font", `${(titleFont * type.company).toFixed(2)}px`);
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
      const speed = 14 + Math.random() * 22;
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
    const nextDpr = Math.min(window.devicePixelRatio || 1, 2);
    const { w: newW, h: newH } = viewportSize();
    const bufW = Math.floor(newW * nextDpr);
    const bufH = Math.floor(newH * nextDpr);
    const sizeChanged = canvas.width !== bufW || canvas.height !== bufH;

    if (sizeChanged) {
      canvas.width = bufW;
      canvas.height = bufH;
      ctx.setTransform(nextDpr, 0, 0, nextDpr, 0, 0);
    } else if (nextDpr !== dpr) {
      ctx.setTransform(nextDpr, 0, 0, nextDpr, 0, 0);
    }

    dpr = nextDpr;
    canvas.style.width = `${newW}px`;
    canvas.style.height = `${newH}px`;
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

  function ensureLayout() {
    const nextDpr = Math.min(window.devicePixelRatio || 1, 2);
    const { w: newW, h: newH } = viewportSize();
    if (
      !pendingLayout &&
      newW === width &&
      newH === height &&
      nextDpr === dpr
    ) {
      return;
    }
    pendingLayout = false;
    fullRelayout();
  }

  function revealContent() {
    if (revealed) return;
    revealed = true;
    content.dataset.revealed = "true";
    setWordmarkSelectActive(true);
    // Allow vertical scroll fallback on short viewports after the intro settles
    canvas.style.touchAction = "pan-y";
  }

  function selectFullWordmark(e) {
    if (!wordmarkSelectText) return;
    e.preventDefault();
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(wordmarkSelectText);
    selection.removeAllRanges();
    selection.addRange(range);
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
        p.vx = 0;
        p.vy = 0;
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
      p.vx += (Math.random() - 0.5) * 28 * dt;
      p.vy += (Math.random() - 0.5) * 28 * dt;
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
    const stackGap =
      isMobileLayout() && isShortViewport() ? STACK_GAP_SHORT_PX : STACK_GAP_PX;
    const contentTop = titleLayout.bottom + stackGap;
    snapHadDotsInContent = particles.some((p) => !p.held && p.y > contentTop);
  }

  /** True once free dots have mostly left the blurb/button band below the wordmark. */
  function dotsClearedContentZone() {
    const stackGap =
      isMobileLayout() && isShortViewport() ? STACK_GAP_SHORT_PX : STACK_GAP_PX;
    const contentTop = titleLayout.bottom + stackGap;
    let free = 0;
    let inZone = 0;
    for (const p of particles) {
      if (p.held) continue;
      free++;
      if (p.y > contentTop) inZone++;
    }
    if (free === 0) return true;
    return inZone / free <= 0.1;
  }

  function updateSnap(t) {
    const e = easeInOutCubic(t);
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
        const ax = (p.tx - p.x) * RETURN_STIFFNESS - p.vx * RETURN_DAMPING;
        const ay = (p.ty - p.y) * RETURN_STIFFNESS - p.vy * RETURN_DAMPING;
        p.vx += ax * dt;
        p.vy += ay * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.morph = Math.min(1, p.morph + dt * 6);
        const dist = Math.hypot(p.x - p.tx, p.y - p.ty);
        const speed = Math.hypot(p.vx, p.vy);
        if (dist < 0.6 && speed < 12 && p.morph >= 0.98) {
          p.x = p.tx;
          p.y = p.ty;
          p.vx = 0;
          p.vy = 0;
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

    const tittleR = iDotRadius(p.fontSize);
    const asDot = p.morph <= 0.02 || p.held;
    if (asDot) {
      const r = p.held ? Math.max(tittleR, p.fontSize * 0.18) : tittleR;
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
      ctx.arc(p.x, p.y, tittleR * (1 - p.morph), 0, Math.PI * 2);
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
    ensureLayout();
    const dt = Math.min(0.033, (now - (tick.prev || now)) / 1000) || 0.016;
    tick.prev = now;

    if (phase === PHASE.ROAM) {
      updateRoam(dt);
      if (now - startTime >= ROAM_MS) beginSnap();
    } else if (phase === PHASE.SNAP) {
      const t = (now - phaseStart) / SNAP_MS;
      updateSnap(t);
      // Fade content in once dots have flown past the blurb/button band
      if (!revealed) {
        const cleared = dotsClearedContentZone();
        if (snapHadDotsInContent ? cleared || t >= 0.9 : t >= 0.55) {
          revealContent();
        }
      }
      if (t >= 1) {
        phase = PHASE.SETTLE;
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
      ensureLayout();
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

  const markPendingLayout = () => {
    pendingLayout = true;
  };

  /** iOS often reports stale sizes on orientationchange — pulse layout after metrics settle */
  function onOrientationChange() {
    markPendingLayout();
    requestAnimationFrame(() => {
      markPendingLayout();
      requestAnimationFrame(markPendingLayout);
    });
    setTimeout(markPendingLayout, 100);
    setTimeout(markPendingLayout, 300);
  }

  window.addEventListener("resize", markPendingLayout);
  window.addEventListener("orientationchange", onOrientationChange);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", markPendingLayout);
  }

  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (currentTheme() === "auto") {
      updateThemeChrome("auto");
      readColors();
    }
  });
  window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
    if (currentTheme() === "auto") {
      updateThemeChrome("auto");
      readColors();
    }
  });

  if (themeToggle) {
    themeToggle.addEventListener("click", cycleTheme);
  }
  applyTheme(currentTheme(), { persist: false });

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
    wordmarkSelect.addEventListener("dblclick", selectFullWordmark);
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
