/**
 * 마이페이지(계정) — 프로필: 변경 감지, 닉네임 중복 확인, 적용 버튼 활성화
 */
(function () {
  const cfg = window.__MYPAGE_ACCOUNT__ || {};
  if (cfg.activeTab !== 'profile') return;

  const form = document.getElementById('mypageAccountForm');
  const inNick = document.getElementById('mypageAccountNickname');
  const btnDup = document.getElementById('mypageAccountBtnCheckNick');
  const apply = document.getElementById('mypageAccountApply');
  const fileInput = document.getElementById('mypageAccountAvatarFile');
  const btnSelect = document.getElementById('mypageAccountBtnSelectAvatar');
  const img = document.getElementById('mypageAccountAvatarImg');
  const placeholder = document.getElementById('mypageAccountAvatarPlaceholder');
  const nickWarn = document.getElementById('mypageAccountNickWarn');
  const nickHint = document.getElementById('mypageAccountNickHint');

  if (!form || !inNick || !btnDup || !apply) return;

  const initialNickname = (cfg.initialNickname != null ? String(cfg.initialNickname) : '').trim();
  const initialAvatar = cfg.initialAvatar != null && String(cfg.initialAvatar).trim() !== '' ? String(cfg.initialAvatar).trim() : '';

  let clientVerifiedNick = null;
  let objectUrl = null;

  function setAvatarPreview(url, showImg) {
    if (!img || !placeholder) return;
    if (showImg && url) {
      img.src = url;
      img.classList.remove('is-hidden');
      placeholder.classList.add('is-hidden');
    } else if (initialAvatar) {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = null;
      }
      img.src = initialAvatar;
      img.classList.remove('is-hidden');
      placeholder.classList.add('is-hidden');
    } else {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = null;
      }
      img.removeAttribute('src');
      img.classList.add('is-hidden');
      placeholder.classList.remove('is-hidden');
      const letter = inNick.value.trim().length ? inNick.value.trim().charAt(0) : '?';
      placeholder.textContent = letter;
    }
  }

  function nickDirty() {
    return inNick.value.trim() !== initialNickname;
  }

  function avatarDirty() {
    return fileInput && fileInput.files && fileInput.files.length > 0;
  }

  function dirty() {
    return nickDirty() || avatarDirty();
  }

  function nickOkForApply() {
    if (!nickDirty()) return true;
    return clientVerifiedNick === inNick.value.trim();
  }

  function hideNickWarn() {
    if (!nickWarn) return;
    nickWarn.textContent = '';
    nickWarn.classList.add('is-hidden');
  }

  function showNickWarn(msg) {
    if (!nickWarn) return;
    nickWarn.textContent = msg;
    nickWarn.classList.remove('is-hidden');
  }

  function updateApply() {
    const ok = dirty() && nickOkForApply();
    apply.disabled = !ok;
  }

  inNick.addEventListener('input', function () {
    clientVerifiedNick = null;
    hideNickWarn();
    if (nickHint) nickHint.textContent = '닉네임을 수정한 경우 「닉네임 중복 확인」을 누른 뒤 적용해 주세요.';
    updateApply();
    if (!avatarDirty() && !initialAvatar) {
      const letter = inNick.value.trim().length ? inNick.value.trim().charAt(0) : '?';
      if (placeholder && img && img.classList.contains('is-hidden')) {
        placeholder.textContent = letter;
      }
    }
  });

  if (btnSelect && fileInput) {
    btnSelect.addEventListener('click', function () {
      fileInput.click();
    });
    fileInput.addEventListener('change', function () {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = null;
      }
      const f = fileInput.files && fileInput.files[0];
      if (f) {
        objectUrl = URL.createObjectURL(f);
        setAvatarPreview(objectUrl, true);
      } else {
        setAvatarPreview('', false);
      }
      updateApply();
    });
  }

  btnDup.addEventListener('click', async function () {
    const v = inNick.value.trim();
    if (!v) {
      if (nickHint) nickHint.textContent = '닉네임을 입력한 뒤 확인해 주세요.';
      return;
    }
    btnDup.disabled = true;
    try {
      const res = await fetch('/auth/check-nickname?nickname=' + encodeURIComponent(v));
      const data = await res.json();
      if (data.available) {
        clientVerifiedNick = v;
        if (nickHint) nickHint.textContent = '중복 확인이 완료되었습니다. 적용하기를 눌러 반영하세요.';
        hideNickWarn();
      } else if (data.duplicate) {
        clientVerifiedNick = null;
        if (nickHint) nickHint.textContent = '이미 사용 중인 닉네임입니다.';
      } else {
        clientVerifiedNick = null;
        if (nickHint) nickHint.textContent = data.message || '다시 시도해주세요.';
      }
    } catch (e) {
      clientVerifiedNick = null;
      if (nickHint) nickHint.textContent = '확인 요청에 실패했습니다.';
    } finally {
      btnDup.disabled = false;
      updateApply();
    }
  });

  form.addEventListener('submit', function (e) {
    if (apply.disabled) {
      e.preventDefault();
      if (nickDirty() && !nickOkForApply()) {
        showNickWarn('닉네임 중복 확인을 해주세요.');
      }
      return;
    }
    if (nickDirty() && !nickOkForApply()) {
      e.preventDefault();
      showNickWarn('닉네임 중복 확인을 해주세요.');
    }
  });

  if (nickWarn && nickWarn.textContent.trim()) {
    nickWarn.classList.remove('is-hidden');
  }

  updateApply();
})();
