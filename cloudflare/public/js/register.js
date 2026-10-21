/**
 * 닉네임/아이디 중복 확인, 프로필 이미지(선택), 회원가입 제출
 */
(function () {
  const form = document.getElementById('registerForm');
  const btnNick = document.getElementById('btnCheckNickname');
  const btnUser = document.getElementById('btnCheckUsername');
  const inNick = document.getElementById('nickname');
  const inUser = document.getElementById('username');
  const hintNick = document.getElementById('nicknameHint');
  const hintUser = document.getElementById('usernameHint');
  const errTop = document.getElementById('registerClientError');
  const captchaQ = document.getElementById('registerCaptchaQuestion');
  const captchaIn = document.getElementById('registerCaptchaInput');
  const btnAvatar = document.getElementById('btnSelectAvatar');
  const fileAvatar = document.getElementById('registerAvatarFile');
  const preview = document.getElementById('registerAvatarPreview');

  if (!form || !btnNick || !btnUser || !inNick || !inUser || !hintNick || !hintUser) return;

  const DUP_HINT_MS = 10000;
  const GUIDE_NICK = '닉네임을 입력한 뒤 「닉네임 중복 확인」을 눌러주세요. (최대 20자)';
  const GUIDE_USER = '영문, 숫자, 밑줄(_)만 사용할 수 있으며 3자 이상 30자 이하로 입력해 주세요.';

  let nickHintTimer = null;
  let userHintTimer = null;

  function clearClientError() {
    if (!errTop) return;
    errTop.textContent = '';
    errTop.classList.add('is-hidden');
  }

  function setClientError(text) {
    if (!errTop) return;
    errTop.textContent = text;
    errTop.classList.remove('is-hidden');
  }

  clearClientError();

  function applyHintClass(el, variant) {
    el.className = 'form-hint register-field-hint';
    if (variant === 'ok') el.classList.add('register-hint--ok');
    else if (variant === 'bad') el.classList.add('register-hint--bad');
  }

  function showNickHint(text, variant, revertAfterMs) {
    if (nickHintTimer) {
      clearTimeout(nickHintTimer);
      nickHintTimer = null;
    }
    hintNick.textContent = text;
    applyHintClass(hintNick, variant);
    if (revertAfterMs) {
      nickHintTimer = setTimeout(function () {
        nickHintTimer = null;
        hintNick.textContent = GUIDE_NICK;
        applyHintClass(hintNick, 'guide');
      }, revertAfterMs);
    }
  }

  function showUserHint(text, variant, revertAfterMs) {
    if (userHintTimer) {
      clearTimeout(userHintTimer);
      userHintTimer = null;
    }
    hintUser.textContent = text;
    applyHintClass(hintUser, variant);
    if (revertAfterMs) {
      userHintTimer = setTimeout(function () {
        userHintTimer = null;
        hintUser.textContent = GUIDE_USER;
        applyHintClass(hintUser, 'guide');
      }, revertAfterMs);
    }
  }

  let nicknameVerified = false;
  let nicknameVerifiedValue = '';
  let usernameVerified = false;
  let usernameVerifiedValue = '';
  let avatarBlob = null;

  const CFG = {
    okNick: '사용 가능한 닉네임입니다.',
    badNick: '중복된 닉네임입니다.',
    okUser: '사용 가능한 아이디입니다.',
    badUser: '중복된 아이디입니다.'
  };

  function resetNickState() {
    nicknameVerified = false;
    nicknameVerifiedValue = '';
    btnNick.disabled = false;
    if (nickHintTimer) {
      clearTimeout(nickHintTimer);
      nickHintTimer = null;
    }
    hintNick.textContent = GUIDE_NICK;
    applyHintClass(hintNick, 'guide');
  }

  function resetUserState() {
    usernameVerified = false;
    usernameVerifiedValue = '';
    btnUser.disabled = false;
    if (userHintTimer) {
      clearTimeout(userHintTimer);
      userHintTimer = null;
    }
    hintUser.textContent = GUIDE_USER;
    applyHintClass(hintUser, 'guide');
  }

  function setPreviewFromBlob(blob) {
    if (!preview) return;
    const prev = preview.dataset.objectUrl;
    if (prev) URL.revokeObjectURL(prev);
    const url = URL.createObjectURL(blob);
    preview.dataset.objectUrl = url;
    preview.style.backgroundImage = 'url("' + url + '")';
    preview.classList.add('register-avatar-preview--has');
  }

  if (btnAvatar && fileAvatar) {
    btnAvatar.addEventListener('click', function () {
      fileAvatar.click();
    });
    fileAvatar.addEventListener('change', function () {
      const f = fileAvatar.files && fileAvatar.files[0];
      if (!f) return;
      if (typeof window.openRegisterAvatarCrop !== 'function') {
        setClientError('이미지 편집 도구를 불러올 수 없습니다. 페이지를 새로고침해 주세요.');
        return;
      }
      window.openRegisterAvatarCrop(f, function (blob) {
        avatarBlob = blob;
        setPreviewFromBlob(blob);
      });
      fileAvatar.value = '';
    });
  }

  window.addEventListener('register-avatar-crop-error', function (e) {
    const msg = (e.detail && e.detail.message) || '이미지를 불러올 수 없습니다.';
    setClientError(msg);
    if (errTop) errTop.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  inNick.addEventListener('input', function () {
    if (inNick.value.trim() !== nicknameVerifiedValue) {
      resetNickState();
    }
  });

  inUser.addEventListener('input', function () {
    if (inUser.value.trim() !== usernameVerifiedValue) {
      resetUserState();
    }
  });

  btnNick.addEventListener('click', async function () {
    const v = inNick.value.trim();
    if (!v) {
      showNickHint('닉네임을 입력한 뒤 확인해 주세요.', 'bad', DUP_HINT_MS);
      return;
    }
    btnNick.disabled = true;
    try {
      const u = new URLSearchParams();
      u.set('nickname', v);
      const res = await fetch('/auth/check-nickname?' + u.toString());
      const data = await res.json();
      if (data.available) {
        showNickHint(CFG.okNick, 'ok', DUP_HINT_MS);
        btnNick.disabled = true;
        nicknameVerified = true;
        nicknameVerifiedValue = v;
      } else if (data.duplicate) {
        showNickHint(CFG.badNick, 'bad', DUP_HINT_MS);
        inNick.value = '';
        btnNick.disabled = false;
        nicknameVerified = false;
        nicknameVerifiedValue = '';
      } else {
        showNickHint(data.message || '다시 시도해주세요.', 'bad', DUP_HINT_MS);
        btnNick.disabled = false;
        nicknameVerified = false;
        nicknameVerifiedValue = '';
      }
    } catch (e) {
      showNickHint('확인 요청에 실패했습니다.', 'bad', DUP_HINT_MS);
      btnNick.disabled = false;
    }
  });

  btnUser.addEventListener('click', async function () {
    const v = inUser.value.trim();
    if (!v) {
      showUserHint('아이디를 입력한 뒤 확인해 주세요.', 'bad', DUP_HINT_MS);
      return;
    }
    btnUser.disabled = true;
    try {
      const u = new URLSearchParams();
      u.set('username', v);
      const res = await fetch('/auth/check-username?' + u.toString());
      const data = await res.json();
      if (data.available) {
        showUserHint(CFG.okUser, 'ok', DUP_HINT_MS);
        btnUser.disabled = true;
        usernameVerified = true;
        usernameVerifiedValue = v;
      } else if (data.duplicate) {
        showUserHint(CFG.badUser, 'bad', DUP_HINT_MS);
        inUser.value = '';
        btnUser.disabled = false;
        usernameVerified = false;
        usernameVerifiedValue = '';
      } else {
        showUserHint(data.message || '다시 시도해주세요.', 'bad', DUP_HINT_MS);
        btnUser.disabled = false;
        usernameVerified = false;
        usernameVerifiedValue = '';
      }
    } catch (e) {
      showUserHint('확인 요청에 실패했습니다.', 'bad', DUP_HINT_MS);
      btnUser.disabled = false;
    }
  });

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    clearClientError();
    const lines = [];
    if (!nicknameVerified || inNick.value.trim() !== nicknameVerifiedValue) {
      lines.push('닉네임 중복 확인을 해주세요.');
    }
    if (!usernameVerified || inUser.value.trim() !== usernameVerifiedValue) {
      lines.push('아이디 중복 확인을 해주세요.');
    }
    if (lines.length) {
      setClientError(lines.join('\n'));
      if (errTop) errTop.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }
    const pw = document.getElementById('password');
    const pwc = document.getElementById('passwordConfirm');
    const pwdVal = pw && pw.value ? pw.value : '';
    if (pwdVal.length < 8 || pwdVal.length > 20) {
      setClientError('비밀번호는 8자 이상 20자 이하여야 합니다.');
      if (errTop) errTop.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }
    if (pw && pwc && pw.value !== pwc.value) {
      setClientError('비밀번호가 일치하지 않습니다.');
      if (errTop) errTop.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    const fd = new FormData();
    fd.set('nickname', inNick.value.trim());
    fd.set('username', inUser.value.trim());
    fd.set('password', pw ? pw.value : '');
    fd.set('passwordConfirm', pwc ? pwc.value : '');
    if (captchaIn) fd.set('captcha', captchaIn.value);
    if (avatarBlob) {
      fd.append('avatar', avatarBlob, 'avatar.png');
    }

    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;

    try {
      const res = await fetch('/auth/register', {
        method: 'POST',
        body: fd,
        credentials: 'same-origin',
        headers: { 'X-Register-Fetch': '1' }
      });

      if (res.redirected && res.url) {
        window.location.href = res.url;
        return;
      }

      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        const data = await res.json();
        if (data.captchaQuestion && captchaQ) {
          captchaQ.textContent = data.captchaQuestion;
        }
        if (captchaIn) captchaIn.value = '';
        if (data.error) {
          setClientError(data.error);
          if (errTop) errTop.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
        return;
      }

      if (res.ok) {
        window.location.href = '/auth/login?registered=true';
        return;
      }

      setClientError('회원가입 요청에 실패했습니다. 다시 시도해주세요.');
    } catch (err) {
      setClientError('네트워크 오류가 발생했습니다.');
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });
})();

function togglePw(id) {
  const input = document.getElementById(id);
  if (!input) return;
  input.type = input.type === 'password' ? 'text' : 'password';
}

(function pwMatch() {
  const pw = document.getElementById('password');
  const pwConfirm = document.getElementById('passwordConfirm');
  const msg = document.getElementById('pwMatchMsg');
  if (!pw || !pwConfirm || !msg) return;

  const guide = msg.getAttribute('data-guide') || '비밀번호를 한 번 더 입력해 주세요.';

  function setMsg(text, variant) {
    msg.textContent = text;
    msg.className = 'form-hint register-field-hint';
    if (variant === 'ok') msg.classList.add('register-hint--ok');
    else if (variant === 'bad') msg.classList.add('register-hint--bad');
  }

  function updatePwHint() {
    const p = pw.value;
    if (p.length > 0 && p.length < 8) {
      setMsg('비밀번호는 8자 이상이어야 합니다.', 'bad');
      return;
    }
    if (p.length > 20) {
      setMsg('비밀번호는 20자 이하여야 합니다.', 'bad');
      return;
    }
    if (!pwConfirm.value) {
      setMsg(guide, 'guide');
      return;
    }
    if (pw.value === pwConfirm.value) {
      setMsg('비밀번호가 일치합니다.', 'ok');
    } else {
      setMsg('비밀번호가 일치하지 않습니다.', 'bad');
    }
  }

  pw.addEventListener('input', updatePwHint);
  pwConfirm.addEventListener('input', updatePwHint);
})();
