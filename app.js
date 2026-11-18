/* ==========================================================================
   Volt Architecture & Design Hub — Interactive App & Multi-Touch SVG Engine
   ========================================================================== */

(function () {
  'use strict';

  const DATA = window.VOLT_DOCS_DATA;
  if (!DATA) return;

  const DOCS_BY_ID = new Map(DATA.docs.map((d) => [d.id, d]));
  const DIAGRAMS_BY_ID = new Map(DATA.diagrams.map((d) => [d.id, d]));

  // Cache rendered SVG strings per `${theme}:${diagramId}`
  const svgRenderCache = new Map();
  // Active inline camera instances so we can resize/destroy cleanly
  let activeInlineCameras = [];
  let fullscreenCamera = null;
  let currentFullscreenIndex = -1;
  let hasDismissedFsToast = false;

  const state = {
    mode: 'docs', // 'docs' | 'diagrams' | 'decisions'
    currentDocId: 'overview',
    diagramFilter: 'all',
    decisionFilter: 'all',
    decisionQuery: '',
    atlasRenderedTheme: null
  };

  /* ------------------------------------------------------------------------
     1. Theme Management & Mermaid Configuration
     ------------------------------------------------------------------------ */

  function getTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  function configureMermaid(theme) {
    const isDark = theme === 'dark';
    window.mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
      flowchart: {
        htmlLabels: false,
        useMaxWidth: false,
        curve: 'basis',
        padding: 14,
        nodeSpacing: 42,
        rankSpacing: 52
      },
      sequence: {
        useMaxWidth: false,
        diagramMarginX: 28,
        diagramMarginY: 20,
        actorMargin: 48,
        boxMargin: 10,
        noteMargin: 10,
        messageMargin: 34,
        mirrorActors: true
      },
      er: {
        useMaxWidth: false,
        layoutDirection: 'TB',
        minEntityWidth: 110,
        minEntityHeight: 70,
        entityPadding: 14
      },
      themeVariables: isDark
        ? {
            darkMode: true,
            background: '#0e1524',
            primaryColor: '#172542',
            primaryTextColor: '#ecf3ff',
            primaryBorderColor: '#4c8dff',
            secondaryColor: '#142b2b',
            secondaryTextColor: '#e6f7f5',
            secondaryBorderColor: '#2dd4bf',
            tertiaryColor: '#192236',
            tertiaryTextColor: '#dbe7fb',
            tertiaryBorderColor: '#3b4f73',
            lineColor: '#7ea6e0',
            textColor: '#e7eef8',
            mainBkg: '#172542',
            nodeBorder: '#4c8dff',
            clusterBkg: '#111a2e',
            clusterBorder: '#31466b',
            titleColor: '#f1f5f9',
            edgeLabelBackground: '#131d33',
            actorBkg: '#172542',
            actorBorder: '#5b9aff',
            actorTextColor: '#f1f5f9',
            actorLineColor: '#58739c',
            signalColor: '#9ec2ff',
            signalTextColor: '#f1f5f9',
            labelBoxBkgColor: '#16223b',
            labelBoxBorderColor: '#415a85',
            labelTextColor: '#e7eef8',
            loopTextColor: '#e7eef8',
            noteBkgColor: '#262112',
            noteTextColor: '#fde68a',
            noteBorderColor: '#d97706',
            activationBkgColor: '#1e3a6e',
            activationBorderColor: '#69a5ff',
            sequenceNumberColor: '#0b101b',
            attributeBackgroundColorOdd: '#141e33',
            attributeBackgroundColorEven: '#19253f'
          }
        : {
            darkMode: false,
            background: '#f9fbfe',
            primaryColor: '#eaf2ff',
            primaryTextColor: '#0f172a',
            primaryBorderColor: '#0b57d0',
            secondaryColor: '#e6f7f2',
            secondaryTextColor: '#0f172a',
            secondaryBorderColor: '#0f766e',
            tertiaryColor: '#f1f5f9',
            tertiaryTextColor: '#1e293b',
            tertiaryBorderColor: '#94a3b8',
            lineColor: '#3b5984',
            textColor: '#0f172a',
            mainBkg: '#eaf2ff',
            nodeBorder: '#0b57d0',
            clusterBkg: '#f2f6fc',
            clusterBorder: '#b6c7e3',
            titleColor: '#0f172a',
            edgeLabelBackground: '#ffffff',
            actorBkg: '#eaf2ff',
            actorBorder: '#0b57d0',
            actorTextColor: '#0f172a',
            actorLineColor: '#64748b',
            signalColor: '#1e3a8a',
            signalTextColor: '#0f172a',
            labelBoxBkgColor: '#f1f5f9',
            labelBoxBorderColor: '#94a3b8',
            labelTextColor: '#0f172a',
            loopTextColor: '#0f172a',
            noteBkgColor: '#fef9c3',
            noteTextColor: '#422006',
            noteBorderColor: '#ca8a04',
            activationBkgColor: '#dbeafe',
            activationBorderColor: '#0b57d0',
            sequenceNumberColor: '#ffffff',
            attributeBackgroundColorOdd: '#ffffff',
            attributeBackgroundColorEven: '#f1f5fb'
          }
    });
  }

  let renderSeqCounter = 0;
  async function renderDiagramSvg(diagram) {
    const theme = getTheme();
    const cacheKey = `${theme}:${diagram.id}`;
    if (svgRenderCache.has(cacheKey)) {
      return svgRenderCache.get(cacheKey);
    }
    renderSeqCounter += 1;
    const tempId = `mmd-svg-${diagram.id}-${theme}-${renderSeqCounter}`;
    const { svg } = await window.mermaid.render(tempId, diagram.code);
    svgRenderCache.set(cacheKey, svg);
    return svg;
  }

  /* ------------------------------------------------------------------------
     2. Precision Vector SVG Camera (Multi-Touch Pinch-Zoom, Pan & Inertia)
     ------------------------------------------------------------------------ */

  function parseInitialSvgBounds(svgEl) {
    let x = 0;
    let y = 0;
    let w = 800;
    let h = 600;

    const vb = svgEl.viewBox && svgEl.viewBox.baseVal;
    if (vb && vb.width > 0 && vb.height > 0) {
      x = vb.x;
      y = vb.y;
      w = vb.width;
      h = vb.height;
    } else {
      try {
        const bbox = svgEl.getBBox();
        if (bbox && bbox.width > 0 && bbox.height > 0) {
          x = bbox.x;
          y = bbox.y;
          w = bbox.width;
          h = bbox.height;
        }
      } catch (_) {}
    }

    // Add comfortable breathing margin around diagram edges
    const padX = Math.max(24, w * 0.025);
    const padY = Math.max(24, h * 0.025);
    return {
      x: x - padX,
      y: y - padY,
      w: w + padX * 2,
      h: h + padY * 2
    };
  }

  function createDiagramCamera(stageEl, svgEl, opts = {}) {
    const alwaysPan = Boolean(opts.alwaysPan);
    const onStateChange = opts.onStateChange || function () {};
    const getSafeInsets =
      opts.getSafeInsets ||
      function () {
        return { top: 8, bottom: 8, left: 8, right: 8 };
      };

    // Normalize SVG attributes so our viewBox camera has 100% deterministic 1:1 control
    svgEl.removeAttribute('width');
    svgEl.removeAttribute('height');
    svgEl.style.maxWidth = 'none';
    svgEl.style.width = '100%';
    svgEl.style.height = '100%';
    svgEl.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    const baseBox = parseInitialSvgBounds(svgEl);

    let panLocked = alwaysPan;
    let cx = baseBox.x + baseBox.w / 2;
    let cy = baseBox.y + baseBox.h / 2;
    let zoom = 1.0; // 1.0 == Fit All

    let animRaf = 0;
    let inertiaRaf = 0;
    let destroyed = false;

    function getMetrics() {
      const rect = stageEl.getBoundingClientRect();
      const Cw = Math.max(1, rect.width);
      const Ch = Math.max(1, rect.height);
      const insets = getSafeInsets(Cw, Ch);
      const usableW = Math.max(80, Cw - insets.left - insets.right);
      const usableH = Math.max(80, Ch - insets.top - insets.bottom);
      const fitScale = Math.min(usableW / baseBox.w, usableH / baseBox.h);
      // Max zoom lets even huge 3000px ERDs zoom until 1 SVG unit == 5.5 CSS px!
      const maxZoom = Math.max(12, 5.5 / Math.max(0.02, fitScale));
      const minZoom = 0.55;
      // Visual center offset when topbar & bottom dock have asymmetric heights
      const offsetCenterX = (insets.left - insets.right) / 2;
      const offsetCenterY = (insets.top - insets.bottom) / 2;
      return { rect, Cw, Ch, usableW, usableH, fitScale, minZoom, maxZoom, offsetCenterX, offsetCenterY };
    }

    function clampCenter(nextCx, nextCy, nextZoom, m) {
      const pxPerUnit = m.fitScale * nextZoom;
      const halfVw = (m.Cw / pxPerUnit) * 0.35;
      const halfVh = (m.Ch / pxPerUnit) * 0.35;
      const minX = baseBox.x - halfVw;
      const maxX = baseBox.x + baseBox.w + halfVw;
      const minY = baseBox.y - halfVh;
      const maxY = baseBox.y + baseBox.h + halfVh;
      return {
        x: Math.min(maxX, Math.max(minX, nextCx)),
        y: Math.min(maxY, Math.max(minY, nextCy))
      };
    }

    function applyViewBox() {
      if (destroyed) return;
      const m = getMetrics();
      zoom = Math.min(m.maxZoom, Math.max(m.minZoom, zoom));
      const clamped = clampCenter(cx, cy, zoom, m);
      cx = clamped.x;
      cy = clamped.y;

      const pxPerUnit = m.fitScale * zoom;
      const vw = m.Cw / pxPerUnit;
      const vh = m.Ch / pxPerUnit;
      const vx = cx - vw / 2 - m.offsetCenterX / pxPerUnit;
      const vy = cy - vh / 2 - m.offsetCenterY / pxPerUnit;

      svgEl.setAttribute('viewBox', `${vx.toFixed(2)} ${vy.toFixed(2)} ${vw.toFixed(2)} ${vh.toFixed(2)}`);

      const isPanActive = alwaysPan || panLocked || zoom > 1.03;
      stageEl.classList.toggle('is-pan-active', isPanActive);
      onStateChange({ zoom, panLocked, isPanActive, pxPerUnit });
    }

    function stopAnimations() {
      if (animRaf) {
        cancelAnimationFrame(animRaf);
        animRaf = 0;
      }
      if (inertiaRaf) {
        cancelAnimationFrame(inertiaRaf);
        inertiaRaf = 0;
      }
    }

    function animateTo(targetCx, targetCy, targetZoom, durationMs = 210) {
      stopAnimations();
      if (!durationMs) {
        cx = targetCx;
        cy = targetCy;
        zoom = targetZoom;
        applyViewBox();
        return;
      }
      const startCx = cx;
      const startCy = cy;
      const startZoom = zoom;
      const t0 = performance.now();

      function tick(now) {
        const p = Math.min(1, (now - t0) / durationMs);
        const ease = 1 - Math.pow(1 - p, 3); // cubic ease-out
        cx = startCx + (targetCx - startCx) * ease;
        cy = startCy + (targetCy - startCy) * ease;
        zoom = startZoom + (targetZoom - startZoom) * ease;
        applyViewBox();
        if (p < 1) {
          animRaf = requestAnimationFrame(tick);
        } else {
          animRaf = 0;
        }
      }
      animRaf = requestAnimationFrame(tick);
    }

    function screenToWorld(clientX, clientY, m) {
      const pxPerUnit = m.fitScale * zoom;
      const dx = clientX - m.rect.left - m.Cw / 2 - m.offsetCenterX;
      const dy = clientY - m.rect.top - m.Ch / 2 - m.offsetCenterY;
      return {
        wx: cx + dx / pxPerUnit,
        wy: cy + dy / pxPerUnit
      };
    }

    function zoomAroundScreenPoint(factor, clientX, clientY, animate = false) {
      const m = getMetrics();
      const targetZoom = Math.min(m.maxZoom, Math.max(m.minZoom, zoom * factor));
      const { wx, wy } = screenToWorld(clientX, clientY, m);
      const newPxPerUnit = m.fitScale * targetZoom;
      const dx = clientX - m.rect.left - m.Cw / 2 - m.offsetCenterX;
      const dy = clientY - m.rect.top - m.Ch / 2 - m.offsetCenterY;
      const targetCx = wx - dx / newPxPerUnit;
      const targetCy = wy - dy / newPxPerUnit;

      if (animate) {
        animateTo(targetCx, targetCy, targetZoom, 190);
      } else {
        cx = targetCx;
        cy = targetCy;
        zoom = targetZoom;
        applyViewBox();
      }
    }

    function fitAll(animate = true) {
      animateTo(baseBox.x + baseBox.w / 2, baseBox.y + baseBox.h / 2, 1.0, animate ? 210 : 0);
    }

    function fitWidth(animate = true) {
      const m = getMetrics();
      const desiredPxPerUnit = m.usableW / baseBox.w;
      const targetZoom = Math.min(m.maxZoom, Math.max(1.0, desiredPxPerUnit / m.fitScale));
      const visibleHInSvg = m.usableH / (m.fitScale * targetZoom);
      const targetCy =
        baseBox.h > visibleHInSvg
          ? baseBox.y + visibleHInSvg * 0.48
          : baseBox.y + baseBox.h / 2;
      animateTo(baseBox.x + baseBox.w / 2, targetCy, targetZoom, animate ? 220 : 0);
    }

    function findReadingFocusPoint(m, visibleW, visibleH) {
      // Use getBoundingClientRect() + screenToWorld() so nested <g transform="translate(...)">
      // offsets in Mermaid flowcharts, ERDs, and sequence diagrams are resolved accurately!
      let nodes = svgEl.querySelectorAll('rect.actor, g.node, g[id^="entity-"]');
      if (!nodes.length) {
        nodes = svgEl.querySelectorAll('text');
      }
      let best = null;
      for (const el of nodes) {
        const r = el.getBoundingClientRect();
        if (!r || r.width < 4 || r.height < 4) continue;
        const topLeft = screenToWorld(r.left, r.top, m);
        const bottomRight = screenToWorld(r.right, r.bottom, m);
        const wx = (topLeft.wx + bottomRight.wx) / 2;
        const wy = (topLeft.wy + bottomRight.wy) / 2;
        const ww = Math.abs(bottomRight.wx - topLeft.wx);
        const wh = Math.abs(bottomRight.wy - topLeft.wy);
        // Prefer topmost real node; break ties toward left-to-right start
        const score = topLeft.wy * 4 + topLeft.wx * 0.25;
        if (!best || score < best.score) {
          best = { wx, wy, topY: topLeft.wy, leftX: topLeft.wx, ww, wh, score };
        }
      }
      if (!best) {
        return {
          x: baseBox.x + baseBox.w / 2,
          y: baseBox.y + Math.min(baseBox.h / 2, visibleH * 0.45)
        };
      }
      const focusX = best.ww > visibleW * 0.85 ? best.leftX + visibleW * 0.46 : best.wx;
      const focusY = best.topY + visibleH * 0.36;
      return { x: focusX, y: focusY };
    }

    function fitReadable(animate = true) {
      const m = getMetrics();
      const targetPxPerUnit = 0.68;
      const targetZoom = Math.min(m.maxZoom, Math.max(1.35, targetPxPerUnit / m.fitScale));
      const actualPx = m.fitScale * targetZoom;
      const visibleW = m.usableW / actualPx;
      const visibleH = m.usableH / actualPx;
      const focus = findReadingFocusPoint(m, visibleW, visibleH);

      animateTo(focus.x, focus.y, targetZoom, animate ? 240 : 0);
    }

    function getReadableZoomForDoubleTap(m) {
      return Math.min(m.maxZoom, Math.max(2.4, 0.72 / m.fitScale));
    }

    /* --- Multi-Touch Gesture State (1-finger pan, 2-finger focal pinch, inertia, double-tap) --- */
    let touchMode = 'idle'; // 'idle' | 'pan' | 'pinch'
    let panLastX = 0;
    let panLastY = 0;
    let panLastTime = 0;
    let velX = 0;
    let velY = 0;
    let touchMoved = false;
    let touchDownTime = 0;
    let touchDownX = 0;
    let touchDownY = 0;
    let lastTapTime = 0;
    let lastTapX = 0;
    let lastTapY = 0;

    let pinchPrevMidX = 0;
    let pinchPrevMidY = 0;
    let pinchPrevDist = 1;

    function seedPinchFromTouches(t0, t1) {
      pinchPrevMidX = (t0.clientX + t1.clientX) / 2;
      pinchPrevMidY = (t0.clientY + t1.clientY) / 2;
      pinchPrevDist = Math.max(8, Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY));
    }

    function seedSinglePanFromTouch(t) {
      panLastX = t.clientX;
      panLastY = t.clientY;
      panLastTime = performance.now();
      velX = 0;
      velY = 0;
    }

    function startMomentum() {
      const speed = Math.hypot(velX, velY);
      if (speed < 0.08) return;
      let lastFrame = performance.now();

      function coast(now) {
        if (destroyed) return;
        const dt = Math.min(34, Math.max(8, now - lastFrame));
        lastFrame = now;

        const m = getMetrics();
        const pxPerUnit = m.fitScale * zoom;
        cx -= (velX * dt) / pxPerUnit;
        cy -= (velY * dt) / pxPerUnit;
        applyViewBox();

        const decay = Math.pow(0.91, dt / 16.67);
        velX *= decay;
        velY *= decay;

        if (Math.hypot(velX, velY) >= 0.03) {
          inertiaRaf = requestAnimationFrame(coast);
        } else {
          inertiaRaf = 0;
        }
      }
      inertiaRaf = requestAnimationFrame(coast);
    }

    function onTouchStart(e) {
      if (opts.onInteract) opts.onInteract();

      if (e.touches.length >= 2) {
        e.preventDefault();
        stopAnimations();
        touchMode = 'pinch';
        touchMoved = true;
        seedPinchFromTouches(e.touches[0], e.touches[1]);
        return;
      }

      if (e.touches.length === 1) {
        const t = e.touches[0];
        touchDownTime = performance.now();
        touchDownX = t.clientX;
        touchDownY = t.clientY;
        touchMoved = false;

        const canSingleFingerPan = alwaysPan || panLocked || zoom > 1.03;
        if (canSingleFingerPan) {
          stopAnimations();
          touchMode = 'pan';
          seedSinglePanFromTouch(t);
        } else {
          touchMode = 'idle';
        }
      }
    }

    function onTouchMove(e) {
      if (e.touches.length >= 2) {
        e.preventDefault();
        if (touchMode !== 'pinch') {
          stopAnimations();
          touchMode = 'pinch';
          seedPinchFromTouches(e.touches[0], e.touches[1]);
          return;
        }
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        const midX = (t0.clientX + t1.clientX) / 2;
        const midY = (t0.clientY + t1.clientY) / 2;
        const dist = Math.max(8, Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY));

        const m = getMetrics();
        // World coordinate currently under the previous finger midpoint
        const prevPxPerUnit = m.fitScale * zoom;
        const prevDx = pinchPrevMidX - m.rect.left - m.Cw / 2 - m.offsetCenterX;
        const prevDy = pinchPrevMidY - m.rect.top - m.Ch / 2 - m.offsetCenterY;
        const anchorWx = cx + prevDx / prevPxPerUnit;
        const anchorWy = cy + prevDy / prevPxPerUnit;

        // Apply pinch scale & solve new center so anchorWx/Wy stays locked under current midX/midY
        const nextZoom = Math.min(m.maxZoom, Math.max(m.minZoom, zoom * (dist / pinchPrevDist)));
        const nextPxPerUnit = m.fitScale * nextZoom;
        const currDx = midX - m.rect.left - m.Cw / 2 - m.offsetCenterX;
        const currDy = midY - m.rect.top - m.Ch / 2 - m.offsetCenterY;

        zoom = nextZoom;
        cx = anchorWx - currDx / nextPxPerUnit;
        cy = anchorWy - currDy / nextPxPerUnit;
        applyViewBox();

        pinchPrevMidX = midX;
        pinchPrevMidY = midY;
        pinchPrevDist = dist;
        touchMoved = true;
        return;
      }

      if (e.touches.length === 1 && touchMode === 'pan') {
        const t = e.touches[0];
        const dx = t.clientX - panLastX;
        const dy = t.clientY - panLastY;

        if (!touchMoved && Math.hypot(t.clientX - touchDownX, t.clientY - touchDownY) > 7) {
          touchMoved = true;
        }
        e.preventDefault();

        const now = performance.now();
        const dt = Math.max(4, now - panLastTime);
        const instVx = dx / dt;
        const instVy = dy / dt;
        velX = velX * 0.45 + instVx * 0.55;
        velY = velY * 0.45 + instVy * 0.55;

        const m = getMetrics();
        const pxPerUnit = m.fitScale * zoom;
        cx -= dx / pxPerUnit;
        cy -= dy / pxPerUnit;
        applyViewBox();

        panLastX = t.clientX;
        panLastY = t.clientY;
        panLastTime = now;
      } else if (e.touches.length === 1) {
        const t = e.touches[0];
        if (Math.hypot(t.clientX - touchDownX, t.clientY - touchDownY) > 10) {
          touchMoved = true;
        }
      }
    }

    function onTouchEnd(e) {
      if (e.touches.length >= 2) {
        touchMode = 'pinch';
        seedPinchFromTouches(e.touches[0], e.touches[1]);
        return;
      }
      if (e.touches.length === 1) {
        // Seamless transition from 2-finger pinch down to 1-finger pan without jumping!
        if (alwaysPan || panLocked || zoom > 1.03) {
          touchMode = 'pan';
          seedSinglePanFromTouch(e.touches[0]);
        } else {
          touchMode = 'idle';
        }
        return;
      }

      // All fingers lifted
      const now = performance.now();
      const tapDuration = now - touchDownTime;

      if (!touchMoved && tapDuration < 280) {
        const sinceLastTap = now - lastTapTime;
        const tapDist = Math.hypot(touchDownX - lastTapX, touchDownY - lastTapY);
        if (sinceLastTap < 320 && tapDist < 36) {
          // Double-tap focal zoom toggle!
          e.preventDefault();
          lastTapTime = 0;
          const m = getMetrics();
          const targetReadable = getReadableZoomForDoubleTap(m);
          if (zoom < targetReadable * 0.82) {
            zoomAroundScreenPoint(targetReadable / zoom, touchDownX, touchDownY, true);
          } else {
            fitAll(true);
          }
          touchMode = 'idle';
          return;
        }
        lastTapTime = now;
        lastTapX = touchDownX;
        lastTapY = touchDownY;
      } else if (touchMode === 'pan' && now - panLastTime < 65) {
        startMomentum();
      }

      touchMode = 'idle';
    }

    /* --- Desktop Mouse Drag, Double-Click & Trackpad/Wheel Support --- */
    let mouseDragging = false;
    let mouseLastX = 0;
    let mouseLastY = 0;

    function onMouseDown(e) {
      if (e.button !== 0) return;
      if (e.target.closest('button')) return;
      const canPan = alwaysPan || panLocked || zoom > 1.03;
      if (!canPan) return;

      if (opts.onInteract) opts.onInteract();
      stopAnimations();
      mouseDragging = true;
      mouseLastX = e.clientX;
      mouseLastY = e.clientY;
      stageEl.classList.add('is-dragging');
      e.preventDefault();
    }

    function onWindowMouseMove(e) {
      if (!mouseDragging) return;
      const dx = e.clientX - mouseLastX;
      const dy = e.clientY - mouseLastY;
      mouseLastX = e.clientX;
      mouseLastY = e.clientY;

      const m = getMetrics();
      const pxPerUnit = m.fitScale * zoom;
      cx -= dx / pxPerUnit;
      cy -= dy / pxPerUnit;
      applyViewBox();
    }

    function onWindowMouseUp() {
      if (!mouseDragging) return;
      mouseDragging = false;
      stageEl.classList.remove('is-dragging');
    }

    function onDblClick(e) {
      if (e.target.closest('button')) return;
      e.preventDefault();
      if (opts.onInteract) opts.onInteract();
      const m = getMetrics();
      const targetReadable = getReadableZoomForDoubleTap(m);
      if (zoom < targetReadable * 0.82) {
        zoomAroundScreenPoint(targetReadable / zoom, e.clientX, e.clientY, true);
      } else {
        fitAll(true);
      }
    }

    function onWheel(e) {
      // In fullscreen, any wheel/pinch zooms/pans; inline only intercepts ctrlKey/metaKey pinch or when panLocked
      if (!alwaysPan && !panLocked && !e.ctrlKey && !e.metaKey) {
        return;
      }
      e.preventDefault();
      if (opts.onInteract) opts.onInteract();
      stopAnimations();

      if (alwaysPan && !e.ctrlKey && !e.metaKey && Math.abs(e.deltaX) > Math.abs(e.deltaY) * 0.5 && Math.abs(e.deltaX) > 2) {
        // Two-finger horizontal/diagonal trackpad pan
        const m = getMetrics();
        const pxPerUnit = m.fitScale * zoom;
        cx += e.deltaX / pxPerUnit;
        cy += e.deltaY / pxPerUnit;
        applyViewBox();
        return;
      }

      const delta = -e.deltaY;
      const sensitivity = e.ctrlKey ? 0.01 : 0.0022;
      const factor = Math.exp(delta * sensitivity);
      zoomAroundScreenPoint(factor, e.clientX, e.clientY, false);
    }

    stageEl.addEventListener('touchstart', onTouchStart, { passive: false });
    stageEl.addEventListener('touchmove', onTouchMove, { passive: false });
    stageEl.addEventListener('touchend', onTouchEnd, { passive: false });
    stageEl.addEventListener('touchcancel', onTouchEnd, { passive: false });
    stageEl.addEventListener('mousedown', onMouseDown);
    stageEl.addEventListener('dblclick', onDblClick);
    stageEl.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('mousemove', onWindowMouseMove);
    window.addEventListener('mouseup', onWindowMouseUp);

    // Initial fit
    applyViewBox();

    return {
      fitAll,
      fitWidth,
      fitReadable,
      zoomBy(factor) {
        const m = getMetrics();
        const cxScreen = m.rect.left + m.Cw / 2 + m.offsetCenterX;
        const cyScreen = m.rect.top + m.Ch / 2 + m.offsetCenterY;
        zoomAroundScreenPoint(factor, cxScreen, cyScreen, true);
      },
      panByScreenPx(dx, dy) {
        const m = getMetrics();
        const pxPerUnit = m.fitScale * zoom;
        animateTo(cx + dx / pxPerUnit, cy + dy / pxPerUnit, zoom, 120);
      },
      togglePanLock() {
        panLocked = !panLocked;
        applyViewBox();
        return panLocked;
      },
      refresh() {
        applyViewBox();
      },
      destroy() {
        destroyed = true;
        stopAnimations();
        stageEl.removeEventListener('touchstart', onTouchStart);
        stageEl.removeEventListener('touchmove', onTouchMove);
        stageEl.removeEventListener('touchend', onTouchEnd);
        stageEl.removeEventListener('touchcancel', onTouchEnd);
        stageEl.removeEventListener('mousedown', onMouseDown);
        stageEl.removeEventListener('dblclick', onDblClick);
        stageEl.removeEventListener('wheel', onWheel);
        window.removeEventListener('mousemove', onWindowMouseMove);
        window.removeEventListener('mouseup', onWindowMouseUp);
      }
    };
  }

  /* ------------------------------------------------------------------------
     3. Hydrating Inline Diagrams Inside Markdown Documents
     ------------------------------------------------------------------------ */

  function cleanupInlineCameras() {
    for (const cam of activeInlineCameras) {
      cam.destroy();
    }
    activeInlineCameras = [];
  }

  async function hydrateArticleDiagrams(containerEl) {
    cleanupInlineCameras();
    const figures = Array.from(containerEl.querySelectorAll('.diagram-figure[data-diagram-id]'));

    for (const fig of figures) {
      const diagId = fig.getAttribute('data-diagram-id');
      const diagram = DIAGRAMS_BY_ID.get(diagId);
      if (!diagram) continue;

      const stage = fig.querySelector('[data-role="stage"]');
      const host = fig.querySelector('[data-role="svg-host"]');
      const loading = fig.querySelector('[data-role="loading"]');
      const zoomLabel = fig.querySelector('[data-role="zoom-label"]');
      const panToggleBtn = fig.querySelector('[data-action="toggle-pan"]');

      try {
        const svgMarkup = await renderDiagramSvg(diagram);
        host.innerHTML = svgMarkup;
        if (loading) loading.hidden = true;
        const svgEl = host.querySelector('svg');
        if (!svgEl) continue;

        const cam = createDiagramCamera(stage, svgEl, {
          alwaysPan: false,
          onStateChange({ zoom, panLocked }) {
            if (zoomLabel) {
              zoomLabel.textContent = Math.abs(zoom - 1) < 0.03 ? 'Fit' : `${Math.round(zoom * 100)}%`;
            }
            if (panToggleBtn) {
              panToggleBtn.setAttribute('aria-pressed', panLocked ? 'true' : 'false');
            }
          }
        });
        activeInlineCameras.push(cam);

        fig.addEventListener('click', (e) => {
          const btn = e.target.closest('[data-action]');
          if (!btn) return;
          const action = btn.getAttribute('data-action');
          if (action === 'zoom-in') cam.zoomBy(1.45);
          else if (action === 'zoom-out') cam.zoomBy(1 / 1.45);
          else if (action === 'fit-all') cam.fitAll(true);
          else if (action === 'fit-readable') cam.fitReadable(true);
          else if (action === 'toggle-pan') cam.togglePanLock();
          else if (action === 'fullscreen') openFullscreenDiagram(diagram.id);
        });
      } catch (err) {
        if (loading) {
          loading.textContent = `Diagram render error: ${err.message || err}`;
        }
      }
    }
  }

  /* ------------------------------------------------------------------------
     4. Fullscreen Multi-Touch Diagram Studio
     ------------------------------------------------------------------------ */

  const fsModal = document.getElementById('diagram-fullscreen-modal');
  const fsStage = document.getElementById('fs-diagram-stage');
  const fsHost = document.getElementById('fs-svg-host');
  const fsTitle = document.getElementById('fs-diagram-title');
  const fsKind = document.getElementById('fs-diagram-kind');
  const fsCounter = document.getElementById('fs-diagram-counter');
  const fsZoomLabel = document.getElementById('fs-zoom-label');
  const fsToast = document.getElementById('fs-gesture-toast');
  const fsJumpDocBtn = document.getElementById('fs-jump-doc-btn');

  async function openFullscreenDiagram(diagramId) {
    const idx = DATA.diagrams.findIndex((d) => d.id === diagramId);
    if (idx === -1) return;
    currentFullscreenIndex = idx;
    const diagram = DATA.diagrams[idx];

    if (fullscreenCamera) {
      fullscreenCamera.destroy();
      fullscreenCamera = null;
    }

    fsModal.hidden = false;
    document.body.classList.add('modal-open');

    fsKind.textContent = diagram.kind;
    fsTitle.textContent = diagram.title;
    fsCounter.textContent = `${idx + 1} / ${DATA.diagrams.length}`;
    fsJumpDocBtn.textContent = `${diagram.docNum} · ${diagram.docShortTitle} →`;

    if (!hasDismissedFsToast) {
      fsToast.classList.remove('is-hidden');
    } else {
      fsToast.classList.add('is-hidden');
    }

    const svgMarkup = await renderDiagramSvg(diagram);
    fsHost.innerHTML = svgMarkup;
    const svgEl = fsHost.querySelector('svg');
    if (!svgEl) return;

    fullscreenCamera = createDiagramCamera(fsStage, svgEl, {
      alwaysPan: true,
      getSafeInsets(Cw) {
        const isNarrow = Cw <= 680;
        return {
          top: 74,
          bottom: isNarrow ? 116 : 84,
          left: 14,
          right: 14
        };
      },
      onInteract() {
        if (!hasDismissedFsToast) {
          hasDismissedFsToast = true;
          fsToast.classList.add('is-hidden');
        }
      },
      onStateChange({ zoom }) {
        fsZoomLabel.textContent = `${Math.round(zoom * 100)}%`;
      }
    });
  }

  function closeFullscreenDiagram() {
    if (fsModal.hidden) return;
    fsModal.hidden = true;
    document.body.classList.remove('modal-open');
    if (fullscreenCamera) {
      fullscreenCamera.destroy();
      fullscreenCamera = null;
    }
    currentFullscreenIndex = -1;
    if (window.location.hash.startsWith('#diagram/')) {
      history.replaceState(null, '', state.mode === 'diagrams' ? '#diagrams' : `#doc/${state.currentDocId}`);
    }
  }

  function stepFullscreenDiagram(delta) {
    if (currentFullscreenIndex < 0) return;
    const nextIdx = (currentFullscreenIndex + delta + DATA.diagrams.length) % DATA.diagrams.length;
    openFullscreenDiagram(DATA.diagrams[nextIdx].id);
  }

  document.getElementById('fs-btn-close').addEventListener('click', closeFullscreenDiagram);
  document.getElementById('fs-btn-prev').addEventListener('click', () => stepFullscreenDiagram(-1));
  document.getElementById('fs-btn-next').addEventListener('click', () => stepFullscreenDiagram(1));
  document.getElementById('fs-btn-fit-all').addEventListener('click', () => fullscreenCamera && fullscreenCamera.fitAll(true));
  document.getElementById('fs-btn-fit-width').addEventListener('click', () => fullscreenCamera && fullscreenCamera.fitWidth(true));
  document.getElementById('fs-btn-readable').addEventListener('click', () => fullscreenCamera && fullscreenCamera.fitReadable(true));
  document.getElementById('fs-btn-zoom-in').addEventListener('click', () => fullscreenCamera && fullscreenCamera.zoomBy(1.5));
  document.getElementById('fs-btn-zoom-out').addEventListener('click', () => fullscreenCamera && fullscreenCamera.zoomBy(1 / 1.5));

  fsJumpDocBtn.addEventListener('click', () => {
    if (currentFullscreenIndex < 0) return;
    const diagram = DATA.diagrams[currentFullscreenIndex];
    closeFullscreenDiagram();
    window.location.hash = `#doc/${diagram.docId}/${diagram.sectionId}`;
  });

  /* ------------------------------------------------------------------------
     5. Navigation Lists, Overview Launchpad, Docs Reader & TOC Spy
     ------------------------------------------------------------------------ */

  function renderDocLists() {
    const desktopList = document.getElementById('desktop-doc-list');
    const drawerList = document.getElementById('drawer-doc-list');
    const mobileStrip = document.getElementById('mobile-doc-strip');

    const navHtml = DATA.docs
      .map((d) => {
        const isActive = state.mode === 'docs' && d.id === state.currentDocId;
        const badges = [];
        if (d.diagramCount > 0) badges.push(`<span class="mini-stat-pill" title="${d.diagramCount} diagrams">${d.diagramCount} diag</span>`);
        if (d.decisionCount > 0) badges.push(`<span class="mini-stat-pill" title="${d.decisionCount} decisions">${d.decisionCount} dec</span>`);
        return `
          <a href="#doc/${d.id}" class="doc-nav-item${isActive ? ' is-active' : ''}" data-doc-link="${d.id}">
            <div class="doc-nav-top">
              <span class="doc-nav-num">${d.num}</span>
              <span class="doc-nav-badges">${badges.join('')}</span>
            </div>
            <span class="doc-nav-title">${d.shortTitle}</span>
            <span class="doc-nav-cat">${d.category}</span>
          </a>`;
      })
      .join('');

    desktopList.innerHTML = navHtml;
    drawerList.innerHTML = navHtml;

    mobileStrip.innerHTML = DATA.docs
      .map((d) => {
        const isActive = state.mode === 'docs' && d.id === state.currentDocId;
        return `<a href="#doc/${d.id}" class="strip-pill${isActive ? ' is-active' : ''}" data-strip-doc="${d.id}">
          <span class="strip-pill-num">${d.num}</span>
          <span>${d.shortTitle}</span>
        </a>`;
      })
      .join('');

    mobileStrip.classList.toggle('is-visible', state.mode === 'docs');

    const activePill = mobileStrip.querySelector('.strip-pill.is-active');
    if (activePill && mobileStrip.offsetParent !== null) {
      mobileStrip.scrollLeft =
        activePill.offsetLeft - mobileStrip.clientWidth / 2 + activePill.clientWidth / 2;
    }
  }

  function renderOverviewHero() {
    const slot = document.getElementById('overview-hero-slot');
    if (state.currentDocId !== 'overview') {
      slot.innerHTML = '';
      return;
    }

    // Highlight 4 signature diagrams right at the top for 1-tap mobile access
    const featuredIds = ['diagram-02', 'diagram-04', 'diagram-08', 'diagram-14'];
    const featuredCards = featuredIds
      .map((id) => DIAGRAMS_BY_ID.get(id))
      .filter(Boolean)
      .map(
        (d) => `
        <button type="button" class="quick-diag-card" data-open-diag="${d.id}">
          <div class="quick-diag-top">
            <span class="diagram-badge">${d.kind}</span>
            <span class="doc-nav-num">${d.docNum}</span>
          </div>
          <div class="quick-diag-title">${d.title}</div>
          <div class="quick-diag-hint">Tap to open Fullscreen Zoom &amp; Pan →</div>
        </button>`
      )
      .join('');

    slot.innerHTML = `
      <div class="overview-launchpad">
        <div class="launchpad-banner">
          <div class="launchpad-kpis">
            <div class="kpi-item">
              <span class="kpi-val">${DATA.diagrams.length}</span>
              <span class="kpi-lbl">Touch-Zoomable Diagrams</span>
            </div>
            <div class="kpi-item">
              <span class="kpi-val">${DATA.decisions.length}</span>
              <span class="kpi-lbl">Design &amp; GCP Decisions</span>
            </div>
            <div class="kpi-item">
              <span class="kpi-val">14</span>
              <span class="kpi-lbl">Edge &amp; Core Services</span>
            </div>
            <div class="kpi-item">
              <span class="kpi-val">&le; 1 min</span>
              <span class="kpi-lbl">Platinum Active-Active RTO</span>
            </div>
          </div>
          <div class="launchpad-cta-group">
            <button type="button" class="primary-action-btn" data-switch-mode="diagrams">Browse All 16 Diagrams</button>
            <button type="button" class="secondary-action-btn" data-switch-mode="decisions">Explore 27 Design Decisions</button>
          </div>
        </div>
        <div class="featured-diagrams-strip">${featuredCards}</div>
      </div>`;

    slot.querySelectorAll('[data-open-diag]').forEach((btn) => {
      btn.addEventListener('click', () => openFullscreenDiagram(btn.getAttribute('data-open-diag')));
    });
    slot.querySelectorAll('[data-switch-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const m = btn.getAttribute('data-switch-mode');
        window.location.hash = m === 'diagrams' ? '#diagrams' : '#decisions';
      });
    });
  }

  function renderToc(doc) {
    const desktopToc = document.getElementById('desktop-toc-list');
    const drawerToc = document.getElementById('drawer-toc-list');
    const drawerTocLabel = document.getElementById('drawer-toc-label');

    if (!doc.toc || doc.toc.length === 0) {
      desktopToc.innerHTML = '<span class="toc-link">Overview Index</span>';
      drawerToc.innerHTML = '';
      drawerTocLabel.hidden = true;
      return;
    }

    drawerTocLabel.hidden = false;
    const html = doc.toc
      .map(
        (item) =>
          `<a href="#doc/${doc.id}/${item.id}" class="toc-link toc-level-${item.level}" data-toc-id="${item.id}">${item.text}</a>`
      )
      .join('');
    desktopToc.innerHTML = html;
    drawerToc.innerHTML = html;
  }

  function renderDocPager(doc) {
    const pager = document.getElementById('doc-pager');
    const idx = DATA.docs.findIndex((d) => d.id === doc.id);
    const prev = idx > 0 ? DATA.docs[idx - 1] : null;
    const next = idx < DATA.docs.length - 1 ? DATA.docs[idx + 1] : null;

    pager.innerHTML = `
      ${
        prev
          ? `<a href="#doc/${prev.id}" class="pager-card is-prev">
              <span class="pager-dir">← Previous</span>
              <span class="pager-title">${prev.num} · ${prev.shortTitle}</span>
            </a>`
          : '<div></div>'
      }
      ${
        next
          ? `<a href="#doc/${next.id}" class="pager-card is-next">
              <span class="pager-dir">Next →</span>
              <span class="pager-title">${next.num} · ${next.shortTitle}</span>
            </a>`
          : '<div></div>'
      }`;
  }

  let currentRenderedDocId = null;
  let currentRenderedTheme = null;

  async function showDocument(docId, sectionId) {
    const doc = DOCS_BY_ID.get(docId) || DATA.docs[0];
    state.currentDocId = doc.id;
    const theme = getTheme();

    renderDocLists();
    renderOverviewHero();
    renderToc(doc);
    renderDocPager(doc);

    const article = document.getElementById('doc-article');
    if (currentRenderedDocId !== doc.id || currentRenderedTheme !== theme) {
      article.innerHTML = doc.html;
      currentRenderedDocId = doc.id;
      currentRenderedTheme = theme;
      await hydrateArticleDiagrams(article);
    }

    if (sectionId) {
      const target = document.getElementById(sectionId);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } else {
      window.scrollTo(0, 0);
    }
    updateActiveTocOnScroll();
  }

  function updateActiveTocOnScroll() {
    if (state.mode !== 'docs') return;
    const doc = DOCS_BY_ID.get(state.currentDocId);
    if (!doc || !doc.toc || !doc.toc.length) return;

    let activeId = doc.toc[0].id;
    const threshold = 140;
    for (const item of doc.toc) {
      const el = document.getElementById(item.id);
      if (el && el.getBoundingClientRect().top <= threshold) {
        activeId = item.id;
      }
    }

    document.querySelectorAll('.toc-link[data-toc-id]').forEach((link) => {
      link.classList.toggle('is-active', link.getAttribute('data-toc-id') === activeId);
    });
  }

  /* ------------------------------------------------------------------------
     6. Diagrams Atlas View
     ------------------------------------------------------------------------ */

  const DIAGRAM_CATEGORIES = [
    { id: 'all', label: `All Diagrams (${DATA.diagrams.length})` },
    { id: 'arch', label: 'Architecture & DR' },
    { id: 'data', label: 'Domain ERD' },
    { id: 'sequence', label: 'Sequence Flows' },
    { id: 'infra', label: 'GCP & Local Stack' }
  ];

  async function renderDiagramAtlas() {
    const pillsEl = document.getElementById('diagram-filter-pills');
    pillsEl.innerHTML = DIAGRAM_CATEGORIES.map(
      (c) =>
        `<button type="button" class="filter-pill${state.diagramFilter === c.id ? ' is-active' : ''}" data-diag-cat="${c.id}">${c.label}</button>`
    ).join('');

    pillsEl.querySelectorAll('[data-diag-cat]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.diagramFilter = btn.getAttribute('data-diag-cat');
        renderDiagramAtlas();
      });
    });

    const filtered = DATA.diagrams.filter(
      (d) => state.diagramFilter === 'all' || d.category === state.diagramFilter
    );

    const grid = document.getElementById('diagram-atlas-grid');
    grid.innerHTML = filtered
      .map(
        (d) => `
        <div class="atlas-card">
          <button type="button" class="atlas-preview-btn" data-atlas-open="${d.id}" aria-label="Open ${d.title} in fullscreen touch viewer">
            <div class="atlas-svg-slot" id="atlas-slot-${d.id}">Rendering…</div>
            <span class="atlas-zoom-cta">⤢ Tap to Zoom &amp; Pan</span>
          </button>
          <div class="atlas-card-body">
            <div class="atlas-meta-row">
              <span class="diagram-badge">${d.kind}</span>
              <span class="atlas-doc-tag">${d.docNum} · ${d.docShortTitle}</span>
            </div>
            <h2 class="atlas-card-title">#${d.number} · ${d.title}</h2>
            <div class="atlas-card-footer">
              <button type="button" class="atlas-open-btn" data-atlas-open="${d.id}">Fullscreen Viewer</button>
              <a href="#doc/${d.docId}/${d.sectionId}" class="atlas-doc-link">Read context →</a>
            </div>
          </div>
        </div>`
      )
      .join('');

    grid.querySelectorAll('[data-atlas-open]').forEach((btn) => {
      btn.addEventListener('click', () => openFullscreenDiagram(btn.getAttribute('data-atlas-open')));
    });

    for (const d of filtered) {
      const slot = document.getElementById(`atlas-slot-${d.id}`);
      if (!slot) continue;
      try {
        const svg = await renderDiagramSvg(d);
        slot.innerHTML = svg;
      } catch (_) {
        slot.textContent = 'Preview unavailable';
      }
    }
  }

  /* ------------------------------------------------------------------------
     7. Architectural & Technology Decisions Explorer
     ------------------------------------------------------------------------ */

  const DECISION_GROUPS = [
    { id: 'all', label: `All (${DATA.decisions.length})` },
    { id: 'Data & ERD', label: 'Data & ERD (5)' },
    { id: 'Services & DR', label: 'Services & DR (6)' },
    { id: 'Workflows & Sagas', label: 'Workflows (2)' },
    { id: 'GCP Cloud Stack', label: 'GCP Stack (10)' },
    { id: 'Local & Simulators', label: 'Local & Simulators (4)' }
  ];

  function renderDecisionsExplorer() {
    const pillsEl = document.getElementById('decision-filter-pills');
    pillsEl.innerHTML = DECISION_GROUPS.map(
      (g) =>
        `<button type="button" class="filter-pill${state.decisionFilter === g.id ? ' is-active' : ''}" data-dec-group="${g.id}">${g.label}</button>`
    ).join('');

    pillsEl.querySelectorAll('[data-dec-group]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.decisionFilter = btn.getAttribute('data-dec-group');
        renderDecisionsExplorer();
      });
    });

    const q = state.decisionQuery.trim().toLowerCase();
    const filtered = DATA.decisions.filter((dec) => {
      const groupOk = state.decisionFilter === 'all' || dec.domainGroup === state.decisionFilter;
      const queryOk = !q || dec.searchText.includes(q);
      return groupOk && queryOk;
    });

    const listEl = document.getElementById('decisions-list');
    if (filtered.length === 0) {
      listEl.innerHTML = `<div class="decision-card"><p>No decisions matched "${state.decisionQuery}". Try clearing the search filter.</p></div>`;
      return;
    }

    listEl.innerHTML = filtered
      .map(
        (dec) => `
        <article class="decision-card" id="${dec.id}">
          <div class="decision-card-top">
            <div class="decision-badges">
              <span class="decision-code-badge">${dec.code}</span>
              <span class="decision-domain-badge">${dec.domainGroup}</span>
            </div>
            <a href="#doc/${dec.docId}/${dec.sectionId}" class="decision-jump-link">Read in ${dec.docNum} · ${dec.docShortTitle} →</a>
          </div>
          <h2 class="decision-card-title">${dec.title}</h2>
          <div class="decision-rec-box">
            <div class="decision-rec-label">✓ Recommended Choice</div>
            ${dec.recommendedSummary ? `<div class="decision-rec-headline">${dec.recommendedSummary}</div>` : ''}
            <div class="decision-rec-details">${dec.recommendedHtml}</div>
          </div>
          <div class="decision-columns">
            <div class="decision-col">
              <div class="decision-col-label">Alternatives Considered</div>
              ${dec.alternativesHtml || '<p>See document for details.</p>'}
            </div>
            <div class="decision-col">
              <div class="decision-col-label">Why Recommended Wins</div>
              ${dec.rationaleHtml || '<p>See document for rationale.</p>'}
            </div>
          </div>
        </article>`
      )
      .join('');
  }

  document.getElementById('decision-search-input').addEventListener('input', (e) => {
    state.decisionQuery = e.target.value;
    renderDecisionsExplorer();
  });

  /* ------------------------------------------------------------------------
     8. Mode Switching, Mobile Drawer & Instant Search
     ------------------------------------------------------------------------ */

  function setMode(mode) {
    state.mode = mode;
    document.getElementById('view-docs').hidden = mode !== 'docs';
    document.getElementById('view-diagrams').hidden = mode !== 'diagrams';
    document.getElementById('view-decisions').hidden = mode !== 'decisions';

    document.querySelectorAll('.mode-tab[data-mode]').forEach((tab) => {
      tab.classList.toggle('is-active', tab.getAttribute('data-mode') === mode);
    });

    document.getElementById('mobile-doc-strip').classList.toggle('is-visible', mode === 'docs');

    if (mode === 'diagrams') {
      renderDiagramAtlas();
      window.scrollTo({ top: 0, behavior: 'instant' });
    } else if (mode === 'decisions') {
      renderDecisionsExplorer();
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
  }

  document.querySelectorAll('.mode-tab[data-mode]').forEach((tab) => {
    tab.addEventListener('click', () => {
      const m = tab.getAttribute('data-mode');
      if (m === 'docs') window.location.hash = `#doc/${state.currentDocId}`;
      else if (m === 'diagrams') window.location.hash = '#diagrams';
      else if (m === 'decisions') window.location.hash = '#decisions';
    });
  });

  function applyRouteFromHash() {
    const raw = (window.location.hash || '').replace(/^#/, '');
    closeMobileDrawer();

    if (!raw || raw.startsWith('doc/')) {
      const parts = raw ? raw.slice(4).split('/') : ['overview'];
      const docId = parts[0] || 'overview';
      const sectionId = parts[1] || null;
      setMode('docs');
      showDocument(docId, sectionId);
      return;
    }

    if (raw === 'diagrams') {
      setMode('diagrams');
      return;
    }

    if (raw.startsWith('diagram/')) {
      const diagId = raw.slice(8);
      if (state.mode !== 'diagrams' && currentRenderedDocId === null) {
        setMode('docs');
        showDocument('overview', null);
      }
      openFullscreenDiagram(diagId);
      return;
    }

    if (raw.startsWith('decisions')) {
      setMode('decisions');
      return;
    }

    // Fallback: check if hash matches an anchor on the current doc
    const anchorEl = document.getElementById(raw);
    if (anchorEl) {
      anchorEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      setMode('docs');
      showDocument('overview', null);
    }
  }

  /* Mobile Drawer */
  const drawer = document.getElementById('mobile-drawer');
  const drawerBackdrop = document.getElementById('drawer-backdrop');
  const drawerBtn = document.getElementById('mobile-drawer-btn');

  function openMobileDrawer() {
    drawer.hidden = false;
    drawerBackdrop.hidden = false;
    drawerBtn.setAttribute('aria-expanded', 'true');
    document.body.classList.add('modal-open');
  }

  function closeMobileDrawer() {
    if (drawer.hidden) return;
    drawer.hidden = true;
    drawerBackdrop.hidden = true;
    drawerBtn.setAttribute('aria-expanded', 'false');
    if (fsModal.hidden && searchModal.hidden) {
      document.body.classList.remove('modal-open');
    }
  }

  drawerBtn.addEventListener('click', openMobileDrawer);
  document.getElementById('mobile-drawer-close').addEventListener('click', closeMobileDrawer);
  drawerBackdrop.addEventListener('click', closeMobileDrawer);
  drawer.addEventListener('click', (e) => {
    if (e.target.closest('a')) closeMobileDrawer();
  });

  /* Instant Global Search Modal */
  const searchModal = document.getElementById('search-modal');
  const searchInput = document.getElementById('global-search-input');
  const searchResults = document.getElementById('global-search-results');

  function openSearchModal() {
    searchModal.hidden = false;
    document.body.classList.add('modal-open');
    searchInput.value = '';
    renderSearchResults('');
    setTimeout(() => searchInput.focus(), 20);
  }

  function closeSearchModal() {
    if (searchModal.hidden) return;
    searchModal.hidden = true;
    if (fsModal.hidden && drawer.hidden) {
      document.body.classList.remove('modal-open');
    }
  }

  function renderSearchResults(query) {
    const q = query.trim().toLowerCase();
    const hits = [];

    for (const diag of DATA.diagrams) {
      if (!q || `${diag.title} ${diag.kind} ${diag.docShortTitle}`.toLowerCase().includes(q)) {
        hits.push({
          type: 'Diagram',
          title: `#${diag.number} · ${diag.title}`,
          sub: `${diag.kind} · ${diag.docNum} ${diag.docShortTitle}`,
          action: () => openFullscreenDiagram(diag.id)
        });
      }
    }

    for (const dec of DATA.decisions) {
      if (!q || dec.searchText.includes(q)) {
        hits.push({
          type: 'Decision',
          title: `${dec.code}: ${dec.title}`,
          sub: dec.recommendedSummary || dec.domainGroup,
          href: `#doc/${dec.docId}/${dec.sectionId}`
        });
      }
    }

    for (const doc of DATA.docs) {
      if (!q || doc.searchText.includes(q)) {
        hits.push({
          type: 'Document',
          title: `${doc.num} · ${doc.title}`,
          sub: doc.summary,
          href: `#doc/${doc.id}`
        });
      }
    }

    const topHits = hits.slice(0, 18);
    if (topHits.length === 0) {
      searchResults.innerHTML = `<div class="search-result-item"><span class="search-res-sub">No matching diagrams, decisions, or documents found.</span></div>`;
      return;
    }

    searchResults.innerHTML = topHits
      .map(
        (h, i) => `
        <a class="search-result-item" href="${h.href || '#'}" data-hit-idx="${i}">
          <div class="search-res-top">
            <span class="search-res-type">${h.type}</span>
            <span class="search-res-title">${h.title}</span>
          </div>
          <span class="search-res-sub">${h.sub}</span>
        </a>`
      )
      .join('');

    searchResults.querySelectorAll('[data-hit-idx]').forEach((el) => {
      el.addEventListener('click', (e) => {
        const hit = topHits[Number(el.getAttribute('data-hit-idx'))];
        closeSearchModal();
        if (hit && hit.action) {
          e.preventDefault();
          hit.action();
        }
      });
    });
  }

  document.getElementById('search-open-btn').addEventListener('click', openSearchModal);
  document.getElementById('search-close-btn').addEventListener('click', closeSearchModal);
  searchModal.addEventListener('click', (e) => {
    if (e.target === searchModal) closeSearchModal();
  });
  searchInput.addEventListener('input', (e) => renderSearchResults(e.target.value));

  /* Theme Toggle */
  document.getElementById('theme-toggle-btn').addEventListener('click', async () => {
    const next = getTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem('volt_docs_theme', next);
    } catch (_) {}

    configureMermaid(next);

    if (state.mode === 'docs') {
      await showDocument(state.currentDocId, null);
    } else if (state.mode === 'diagrams') {
      await renderDiagramAtlas();
    }
    if (!fsModal.hidden && currentFullscreenIndex >= 0) {
      await openFullscreenDiagram(DATA.diagrams[currentFullscreenIndex].id);
    }
  });

  /* Global Keyboard Shortcuts */
  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (searchModal.hidden) openSearchModal();
      else closeSearchModal();
      return;
    }

    if (e.key === 'Escape') {
      if (!pwaModal.hidden) closePwaModal();
      else if (!searchModal.hidden) closeSearchModal();
      else if (!fsModal.hidden) closeFullscreenDiagram();
      else if (!drawer.hidden) closeMobileDrawer();
      return;
    }

    if (!fsModal.hidden && fullscreenCamera) {
      if (e.key === '+' || e.key === '=') fullscreenCamera.zoomBy(1.35);
      else if (e.key === '-') fullscreenCamera.zoomBy(1 / 1.35);
      else if (e.key === '0') fullscreenCamera.fitAll(true);
      else if (e.key === 'ArrowLeft') stepFullscreenDiagram(-1);
      else if (e.key === 'ArrowRight') stepFullscreenDiagram(1);
    }
  });

  /* ------------------------------------------------------------------------
     9. Offline PWA Service Worker & Home-Screen Install Flow
     ------------------------------------------------------------------------ */

  const pwaModal = document.getElementById('pwa-modal');
  const pwaStatusBtn = document.getElementById('pwa-status-btn');
  const pwaStatusDot = document.getElementById('pwa-status-dot');
  const pwaStatusLabel = document.getElementById('pwa-status-label');
  const pwaCacheSummary = document.getElementById('pwa-cache-summary');
  const pwaBannerHeadline = document.getElementById('pwa-banner-headline');
  const pwaBannerDetail = document.getElementById('pwa-banner-detail');
  const pwaNativeWrap = document.getElementById('pwa-native-install-wrap');
  const pwaNativeBtn = document.getElementById('pwa-native-install-btn');

  let deferredInstallPrompt = null;
  let offlineCacheReady = false;

  function isStandaloneMode() {
    return (
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
      window.navigator.standalone === true
    );
  }

  function updatePwaStatusUi() {
    const isOffline = navigator.onLine === false;
    pwaStatusBtn.classList.toggle('is-offline-mode', isOffline);
    pwaStatusDot.classList.toggle('is-ready', offlineCacheReady && !isOffline);
    pwaStatusDot.classList.toggle('is-offline', isOffline);

    if (isOffline) {
      pwaStatusLabel.textContent = 'Offline';
      pwaCacheSummary.textContent = 'Offline mode active · Serving from local device cache';
    } else if (isStandaloneMode()) {
      pwaStatusLabel.textContent = 'Offline OK';
      pwaCacheSummary.textContent = 'Installed app · Ready for offline access anytime';
    } else if (deferredInstallPrompt) {
      pwaStatusLabel.textContent = 'Install App';
      pwaCacheSummary.textContent = offlineCacheReady
        ? 'All assets cached offline · Ready to install'
        : 'Ready to install to Home Screen';
    } else if (offlineCacheReady) {
      pwaStatusLabel.textContent = 'Offline OK';
      pwaCacheSummary.textContent = 'Cached on this device · Works without internet';
    } else {
      pwaStatusLabel.textContent = 'Install';
      pwaCacheSummary.textContent = 'Preparing offline cache…';
    }

    if (offlineCacheReady) {
      pwaBannerHeadline.textContent = '✓ Ready for 100% Offline Access';
      pwaBannerDetail.textContent =
        'All 7 documents, 16 vector diagrams, and 27 architectural decisions are saved on this device. You can open or install this page anytime—even with zero network connection.';
    }

    pwaNativeWrap.hidden = !deferredInstallPrompt;
  }

  function openPwaModal() {
    updatePwaStatusUi();
    pwaModal.hidden = false;
    document.body.classList.add('modal-open');
  }

  function closePwaModal() {
    if (pwaModal.hidden) return;
    pwaModal.hidden = true;
    if (fsModal.hidden && searchModal.hidden && drawer.hidden) {
      document.body.classList.remove('modal-open');
    }
  }

  pwaStatusBtn.addEventListener('click', async () => {
    // If Chrome/Android has a native install prompt queued and user isn't installed yet, offer modal with 1-tap button
    openPwaModal();
  });
  document.getElementById('pwa-modal-close').addEventListener('click', closePwaModal);
  pwaModal.addEventListener('click', (e) => {
    if (e.target === pwaModal) closePwaModal();
  });

  pwaNativeBtn.addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    try {
      await deferredInstallPrompt.userChoice;
    } catch (_) {}
    deferredInstallPrompt = null;
    updatePwaStatusUi();
  });

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    updatePwaStatusUi();
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    updatePwaStatusUi();
    closePwaModal();
  });

  window.addEventListener('online', updatePwaStatusUi);
  window.addEventListener('offline', updatePwaStatusUi);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (
        event.data &&
        (event.data.type === 'SW_OFFLINE_READY' ||
          (event.data.type === 'SW_OFFLINE_STATUS' && event.data.ready))
      ) {
        offlineCacheReady = true;
        updatePwaStatusUi();
      }
    });

    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('./sw.js', { scope: './' })
        .then((reg) => {
          if (reg.active) {
            offlineCacheReady = true;
            reg.active.postMessage({ type: 'CHECK_OFFLINE_STATUS' });
            updatePwaStatusUi();
          }
          reg.addEventListener('updatefound', () => {
            const installing = reg.installing;
            if (!installing) return;
            installing.addEventListener('statechange', () => {
              if (installing.state === 'activated' || installing.state === 'installed') {
                offlineCacheReady = true;
                updatePwaStatusUi();
              }
            });
          });
        })
        .catch(() => {});
    });
  }

  window.addEventListener('resize', () => {
    for (const cam of activeInlineCameras) cam.refresh();
    if (fullscreenCamera) fullscreenCamera.refresh();
  });

  window.addEventListener('scroll', updateActiveTocOnScroll, { passive: true });
  window.addEventListener('hashchange', applyRouteFromHash);

  /* Initialize */
  document.getElementById('count-docs').textContent = String(DATA.docs.length);
  document.getElementById('count-diagrams').textContent = String(DATA.diagrams.length);
  document.getElementById('count-decisions').textContent = String(DATA.decisions.length);

  updatePwaStatusUi();
  configureMermaid(getTheme());
  applyRouteFromHash();
})();

