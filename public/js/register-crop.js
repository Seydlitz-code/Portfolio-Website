/**
 * 회원가입 프로필 이미지 1:1 정사각형 크롭 모달
 * - 꼭짓점 드래그: 크기 조절(비율 1:1 유지)
 * - 가이드 내부(모서리 제외): 이동
 */
(function () {
  const MIN_SRC = 40;
  const HANDLE_PX = 16;
  const INNER_MARGIN = 20;

  let modal;
  let canvas;
  let ctx;
  let img;
  let iw;
  let ih;
  let sx;
  let sy;
  let side;
  let fitScale;
  let ox;
  let oy;
  let cw;
  let ch;
  let dragging;
  let lastCx;
  let lastCy;
  let onConfirmCb;
  let objectUrl;
  let loadGeneration = 0;

  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  function layoutFit() {
    fitScale = Math.min(cw / iw, ch / ih);
    const dw = iw * fitScale;
    const dh = ih * fitScale;
    ox = (cw - dw) / 2;
    oy = (ch - dh) / 2;
  }

  function initCrop() {
    const maxSide = Math.floor(Math.min(iw, ih) * 0.72);
    side = clamp(maxSide, MIN_SRC, Math.min(iw, ih));
    sx = Math.floor((iw - side) / 2);
    sy = Math.floor((ih - side) / 2);
  }

  function toImageCoords(cx, cy) {
    return {
      mx: (cx - ox) / fitScale,
      my: (cy - oy) / fitScale
    };
  }

  function guideRect() {
    const gx = ox + sx * fitScale;
    const gy = oy + sy * fitScale;
    const gs = side * fitScale;
    return { gx, gy, gs };
  }

  function hitMode(cx, cy) {
    const { gx, gy, gs } = guideRect();
    const h = HANDLE_PX;
    if (Math.hypot(cx - gx, cy - gy) < h) return 'nw';
    if (Math.hypot(cx - gx - gs, cy - gy) < h) return 'ne';
    if (Math.hypot(cx - gx, cy - gy - gs) < h) return 'sw';
    if (Math.hypot(cx - gx - gs, cy - gy - gs) < h) return 'se';
    if (cx >= gx && cx <= gx + gs && cy >= gy && cy <= gy + gs) {
      const m = INNER_MARGIN;
      if (cx > gx + m && cx < gx + gs - m && cy > gy + m && cy < gy + gs - m) return 'move';
    }
    return null;
  }

  function applyResizeSE(mx, my) {
    let s = Math.floor(Math.min(mx - sx, my - sy));
    s = clamp(s, MIN_SRC, Math.min(iw - sx, ih - sy));
    side = s;
  }

  function applyResizeNW(mx, my) {
    const r = sx + side;
    const b = sy + side;
    let s = Math.floor(Math.min(r - mx, b - my));
    s = clamp(s, MIN_SRC, Math.min(r, b));
    sx = r - s;
    sy = b - s;
    side = s;
  }

  function applyResizeNE(mx, my) {
    const bottom = sy + side;
    let s = Math.floor(Math.min(mx - sx, bottom - my));
    s = clamp(s, MIN_SRC, Math.min(iw - sx, bottom));
    sy = bottom - s;
    side = s;
  }

  function applyResizeSW(mx, my) {
    const right = sx + side;
    let s = Math.floor(Math.min(right - mx, my - sy));
    s = clamp(s, MIN_SRC, Math.min(right, ih - sy));
    sx = right - s;
    side = s;
  }

  function applyMove(mx, my, pmx, pmy) {
    sx = clamp(Math.round(sx + (mx - pmx)), 0, iw - side);
    sy = clamp(Math.round(sy + (my - pmy)), 0, ih - side);
  }

  function draw() {
    if (!ctx || !img) return;
    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, cw, ch);

    const dw = iw * fitScale;
    const dh = ih * fitScale;
    const { gx, gy, gs } = guideRect();

    // 1) 전체 이미지(원본 밝기)
    ctx.drawImage(img, 0, 0, iw, ih, ox, oy, dw, dh);

    // 2) 잘리는 영역(가이드 밖)은 어둡게
    ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
    ctx.fillRect(0, 0, cw, ch);

    // 3) 가이드 안 = 프로필에 쓰일 부분만 다시 그려 밝게
    ctx.drawImage(img, sx, sy, side, side, gx, gy, gs, gs);

    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1;
    for (let i = 1; i <= 2; i++) {
      const t = gx + (gs * i) / 3;
      ctx.beginPath();
      ctx.moveTo(t, gy);
      ctx.lineTo(t, gy + gs);
      ctx.stroke();
      const u = gy + (gs * i) / 3;
      ctx.beginPath();
      ctx.moveTo(gx, u);
      ctx.lineTo(gx + gs, u);
      ctx.stroke();
    }

    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.strokeRect(gx + 0.5, gy + 0.5, gs - 1, gs - 1);

    const corners = [
      [gx, gy],
      [gx + gs, gy],
      [gx, gy + gs],
      [gx + gs, gy + gs]
    ];
    corners.forEach(([x, y]) => {
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.strokeStyle = '#222';
      ctx.lineWidth = 1;
      ctx.stroke();
    });
  }

  function pointerPos(e) {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      cx: (clientX - rect.left) * scaleX,
      cy: (clientY - rect.top) * scaleY
    };
  }

  function onPointerDown(e) {
    if (!canvas) return;
    const { cx, cy } = pointerPos(e);
    dragging = hitMode(cx, cy);
    lastCx = cx;
    lastCy = cy;
    if (dragging) {
      e.preventDefault();
      window.addEventListener('mousemove', onPointerMove);
      window.addEventListener('mouseup', endWindowDrag);
      window.addEventListener('touchmove', onPointerMove, { passive: false });
      window.addEventListener('touchend', endWindowDrag);
    }
  }

  function endWindowDrag() {
    dragging = null;
    window.removeEventListener('mousemove', onPointerMove);
    window.removeEventListener('mouseup', endWindowDrag);
    window.removeEventListener('touchmove', onPointerMove, { passive: false });
    window.removeEventListener('touchend', endWindowDrag);
  }

  function onPointerMove(e) {
    if (!dragging) return;
    e.preventDefault();
    const { cx, cy } = pointerPos(e);
    const { mx, my } = toImageCoords(cx, cy);
    const pm = toImageCoords(lastCx, lastCy);

    if (dragging === 'move') {
      applyMove(mx, my, pm.mx, pm.my);
    } else if (dragging === 'se') {
      applyResizeSE(mx, my);
    } else if (dragging === 'nw') {
      applyResizeNW(mx, my);
    } else if (dragging === 'ne') {
      applyResizeNE(mx, my);
    } else if (dragging === 'sw') {
      applyResizeSW(mx, my);
    }

    lastCx = cx;
    lastCy = cy;
    draw();
  }

  function onCropResize() {
    if (!modal || modal.hidden || !img) return;
    sizeCanvas(false);
  }

  function sizeCanvas(initial) {
    const maxW = Math.min(520, window.innerWidth - 24);
    const maxH = Math.min(480, Math.max(200, window.innerHeight - 200));
    cw = maxW;
    ch = maxH;
    canvas.width = cw;
    canvas.height = ch;
    layoutFit();
    if (initial) initCrop();
    if (img) {
      sx = clamp(sx, 0, iw - side);
      sy = clamp(sy, 0, ih - side);
      side = clamp(side, MIN_SRC, Math.min(iw - sx, ih - sy, iw, ih));
    }
    draw();
  }

  function onCropEscape(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeModal();
    }
  }

  function attachModalChrome() {
    document.body.classList.add('register-crop-modal-open');
    document.addEventListener('keydown', onCropEscape);
  }

  function detachModalChrome() {
    document.body.classList.remove('register-crop-modal-open');
    document.removeEventListener('keydown', onCropEscape);
  }

  function closeModal() {
    endWindowDrag();
    window.removeEventListener('resize', onCropResize);
    detachModalChrome();
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
    if (modal) modal.hidden = true;
    img = null;
  }

  function confirmCrop() {
    if (!img || !onConfirmCb) return;
    const out = document.createElement('canvas');
    const outSize = Math.min(512, side);
    out.width = outSize;
    out.height = outSize;
    const octx = out.getContext('2d');
    octx.drawImage(img, sx, sy, side, side, 0, 0, outSize, outSize);
    out.toBlob(
      function (blob) {
        if (blob && onConfirmCb) {
          onConfirmCb(blob);
          closeModal();
        } else if (!blob) {
          window.dispatchEvent(
            new CustomEvent('register-avatar-crop-error', {
              detail: { message: '이미지를 저장할 수 없습니다. 다시 시도해 주세요.' }
            })
          );
        }
      },
      'image/png',
      0.92
    );
  }

  function openRegisterAvatarCrop(file, onConfirm) {
    loadGeneration++;
    const myGen = loadGeneration;
    if (typeof window.closeRegisterAvatarCrop === 'function') {
      window.closeRegisterAvatarCrop();
    }
    onConfirmCb = onConfirm;
    if (!modal) {
      modal = document.getElementById('registerCropModal');
      canvas = document.getElementById('registerCropCanvas');
    }
    if (!modal || !canvas) return;
    ctx = canvas.getContext('2d');
    objectUrl = URL.createObjectURL(file);
    const im = new Image();
    im.onload = function () {
      if (myGen !== loadGeneration) return;
      img = im;
      iw = im.naturalWidth;
      ih = im.naturalHeight;
      modal.hidden = false;
      attachModalChrome();
      sizeCanvas(true);
      window.addEventListener('resize', onCropResize);
      const closeBtn = document.getElementById('registerCropClose');
      if (closeBtn) {
        requestAnimationFrame(function () {
          closeBtn.focus();
        });
      }
    };
    im.onerror = function () {
      if (myGen !== loadGeneration) return;
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
      window.dispatchEvent(
        new CustomEvent('register-avatar-crop-error', {
          detail: { message: '이미지를 불러올 수 없습니다. 다른 파일을 선택해 주세요.' }
        })
      );
    };
    im.src = objectUrl;
  }

  canvas = document.getElementById('registerCropCanvas');
  if (canvas) {
    canvas.addEventListener('mousedown', onPointerDown);
    canvas.addEventListener('touchstart', onPointerDown, { passive: false });
  }

  const backdrop = document.getElementById('registerCropBackdrop');
  if (backdrop) {
    backdrop.addEventListener('click', function () {
      closeModal();
    });
  }

  const cropPanel = document.querySelector('.register-crop-panel');
  if (cropPanel) {
    cropPanel.addEventListener('mousedown', function (e) {
      e.stopPropagation();
    });
    cropPanel.addEventListener(
      'touchstart',
      function (e) {
        e.stopPropagation();
      },
      { passive: true }
    );
  }

  const btnClose = document.getElementById('registerCropClose');
  const btnOk = document.getElementById('registerCropConfirm');
  const btnOkBar = document.getElementById('registerCropConfirmBar');
  if (btnClose) btnClose.addEventListener('click', closeModal);
  if (btnOk) btnOk.addEventListener('click', confirmCrop);
  if (btnOkBar) btnOkBar.addEventListener('click', confirmCrop);

  window.openRegisterAvatarCrop = openRegisterAvatarCrop;
  window.closeRegisterAvatarCrop = closeModal;
})();
