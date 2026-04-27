/**
 * 닉네임/아이디 중복 확인 및 회원가입 제출 가드
 */
(function () {
  const form = document.getElementById('registerForm');
  const btnNick = document.getElementById('btnCheckNickname');
  const btnUser = document.getElementById('btnCheckUsername');
  const inNick = document.getElementById('nickname');
  const inUser = document.getElementById('username');
  const msgNick = document.getElementById('nicknameCheckMsg');
  const msgUser = document.getElementById('usernameCheckMsg');
  const errTop = document.getElementById('registerClientError');
  if (!form || !btnNick || !btnUser || !inNick || !inUser || !msgNick || !msgUser) return;

  const CFG = {
    okNick: { text: '사용 가능한 닉네임입니다.', className: 'dup-check-msg dup-check-msg--ok' },
    badNick: { text: '중복된 닉네임입니다.', className: 'dup-check-msg dup-check-msg--bad' },
    okUser: { text: '사용 가능한 아이디입니다.', className: 'dup-check-msg dup-check-msg--ok' },
    badUser: { text: '중복된 아이디입니다.', className: 'dup-check-msg dup-check-msg--bad' }
  };

  let nicknameVerified = false;
  let nicknameVerifiedValue = '';
  let usernameVerified = false;
  let usernameVerifiedValue = '';

  function setMsg(el, text, isError) {
    el.textContent = text;
    el.className = isError
      ? 'dup-check-msg dup-check-msg--bad'
      : 'dup-check-msg dup-check-msg--ok';
  }

  function clearMsg(el) {
    el.textContent = '';
    el.className = 'dup-check-msg';
  }

  function resetNickState() {
    nicknameVerified = false;
    nicknameVerifiedValue = '';
    btnNick.disabled = false;
    clearMsg(msgNick);
  }

  function resetUserState() {
    usernameVerified = false;
    usernameVerifiedValue = '';
    btnUser.disabled = false;
    clearMsg(msgUser);
  }

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
      setMsg(msgNick, '닉네임을 입력한 뒤 확인하세요.', true);
      return;
    }
    clearMsg(msgNick);
    btnNick.disabled = true;
    try {
      const u = new URLSearchParams();
      u.set('nickname', v);
      const res = await fetch('/auth/check-nickname?' + u.toString());
      const data = await res.json();
      if (data.available) {
        setMsg(msgNick, CFG.okNick.text, false);
        btnNick.disabled = true;
        nicknameVerified = true;
        nicknameVerifiedValue = v;
      } else if (data.duplicate) {
        setMsg(msgNick, CFG.badNick.text, true);
        inNick.value = '';
        btnNick.disabled = false;
        nicknameVerified = false;
        nicknameVerifiedValue = '';
      } else {
        setMsg(msgNick, data.message || '다시 시도해주세요.', true);
        btnNick.disabled = false;
        nicknameVerified = false;
        nicknameVerifiedValue = '';
      }
    } catch (e) {
      setMsg(msgNick, '확인 요청에 실패했습니다.', true);
      btnNick.disabled = false;
    }
  });

  btnUser.addEventListener('click', async function () {
    const v = inUser.value.trim();
    if (!v) {
      setMsg(msgUser, '아이디를 입력한 뒤 확인하세요.', true);
      return;
    }
    clearMsg(msgUser);
    btnUser.disabled = true;
    try {
      const u = new URLSearchParams();
      u.set('username', v);
      const res = await fetch('/auth/check-username?' + u.toString());
      const data = await res.json();
      if (data.available) {
        setMsg(msgUser, CFG.okUser.text, false);
        btnUser.disabled = true;
        usernameVerified = true;
        usernameVerifiedValue = v;
      } else if (data.duplicate) {
        setMsg(msgUser, CFG.badUser.text, true);
        inUser.value = '';
        btnUser.disabled = false;
        usernameVerified = false;
        usernameVerifiedValue = '';
      } else {
        setMsg(msgUser, data.message || '다시 시도해주세요.', true);
        btnUser.disabled = false;
        usernameVerified = false;
        usernameVerifiedValue = '';
      }
    } catch (e) {
      setMsg(msgUser, '확인 요청에 실패했습니다.', true);
      btnUser.disabled = false;
    }
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (errTop) {
      errTop.setAttribute('hidden', '');
      errTop.textContent = '';
    }
    const lines = [];
    if (!nicknameVerified || inNick.value.trim() !== nicknameVerifiedValue) {
      lines.push('닉네임 중복 확인을 해주세요.');
    }
    if (!usernameVerified || inUser.value.trim() !== usernameVerifiedValue) {
      lines.push('아이디 중복 확인을 해주세요.');
    }
    if (lines.length) {
      if (errTop) {
        errTop.removeAttribute('hidden');
        errTop.textContent = lines.join('\n');
        errTop.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
      return;
    }
    const pw = document.getElementById('password');
    const pwc = document.getElementById('passwordConfirm');
    if (pw && pwc && pw.value !== pwc.value) {
      if (errTop) {
        errTop.removeAttribute('hidden');
        errTop.textContent = '비밀번호가 일치하지 않습니다.';
        errTop.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
      return;
    }
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }
    if (typeof HTMLFormElement === 'function' && HTMLFormElement.prototype.submit) {
      HTMLFormElement.prototype.submit.call(form);
    } else {
      form.submit();
    }
  });
})();

// 비밀번호 토글 / 일치 메시지 (기존 인라인)
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
  pwConfirm.addEventListener('input', function () {
    if (!pwConfirm.value) {
      msg.textContent = '';
      return;
    }
    if (pw.value === pwConfirm.value) {
      msg.textContent = '비밀번호가 일치합니다.';
      msg.style.color = '#22c55e';
    } else {
      msg.textContent = '비밀번호가 일치하지 않습니다.';
      msg.style.color = '#ef4444';
    }
  });
})();
