import { Layout } from './layout';

/** 기존 views/login.ejs 이식 */
export function LoginPage(props: { error: string | null; success: string | null; next: string | null }) {
  return (
    <Layout title="로그인 — 포트폴리오" bodyClass="auth-page" scripts={['/js/login.js']}>
      <div class="auth-container">
        <div class="auth-card">
          <a href="/" class="auth-back">
            <span>←</span> 메인으로
          </a>
          <h1 class="auth-title">로그인</h1>
          <p class="auth-sub">포트폴리오에 오신 것을 환영합니다</p>

          {props.success && <div class="alert alert-success">{props.success}</div>}
          {props.error && <div class="alert alert-error">{props.error}</div>}

          <form action="/auth/login" method="post" class="auth-form">
            {props.next && <input type="hidden" name="next" value={props.next} />}
            <div class="form-group">
              <label class="form-label" for="username">
                아이디
              </label>
              <input
                type="text"
                id="username"
                name="username"
                class="form-input"
                placeholder="아이디를 입력하세요"
                required
                autocomplete="username"
              />
            </div>
            <div class="form-group">
              <label class="form-label" for="password">
                비밀번호
              </label>
              <div class="password-wrap">
                <input
                  type="password"
                  id="password"
                  name="password"
                  class="form-input"
                  placeholder="비밀번호를 입력하세요"
                  required
                  autocomplete="current-password"
                />
                <button type="button" class="pw-toggle" onclick="togglePw('password')">
                  <span id="password-eye">👁</span>
                </button>
              </div>
            </div>
            <button type="submit" class="btn-primary btn-full">
              로그인
            </button>
          </form>

          <p class="auth-switch">
            계정이 없으신가요? <a href="/auth/register">회원가입</a>
          </p>
        </div>
      </div>
    </Layout>
  );
}

/** 기존 views/register.ejs 이식. 클라이언트 동작은 public/js/register.js, register-crop.js가 그대로 맡는다. */
export function RegisterPage(props: { error: string | null; captchaQuestion: string }) {
  return (
    <Layout
      title="회원가입 — 포트폴리오"
      bodyClass="auth-page auth-page--register"
      scripts={['/js/register-crop.js', '/js/register.js']}
    >
      <div class="auth-container">
        <div class="auth-card auth-card--register">
          <a href="/auth/login" class="auth-back">
            <span>←</span> 뒤로 가기
          </a>
          <h1 class="auth-title">회원가입</h1>
          <p class="auth-sub">새 계정을 만들어서 댓글을 남겨보세요.</p>

          {props.error && <div class="alert alert-error">{props.error}</div>}

          <form
            action="/auth/register"
            method="post"
            class="auth-form register-form"
            id="registerForm"
            novalidate
            enctype="multipart/form-data"
          >
            <div class="register-grid">
              <div class="register-col register-col--left">
                <div class="register-avatar-row">
                  <div class="register-avatar-preview-wrap">
                    <div class="register-avatar-preview" id="registerAvatarPreview" aria-hidden="true"></div>
                  </div>
                  <div class="register-avatar-side">
                    <p class="register-avatar-label">프로필 이미지 설정</p>
                    <input
                      type="file"
                      id="registerAvatarFile"
                      accept="image/jpeg,image/png,image/gif,image/webp"
                      hidden
                    />
                    <button type="button" class="register-avatar-select-btn" id="btnSelectAvatar">
                      이미지 선택
                    </button>
                  </div>
                </div>

                <div class="form-group register-nickname-block">
                  <label class="form-label" for="nickname">
                    닉네임 <span class="required">*</span>
                  </label>
                  <div class="register-input-line">
                    <input
                      type="text"
                      id="nickname"
                      name="nickname"
                      class="form-input"
                      required
                      maxlength={20}
                      autocomplete="nickname"
                    />
                  </div>
                  <div class="register-dup-btn-row">
                    <button
                      type="button"
                      class="nav-btn register-dup-btn"
                      id="btnCheckNickname"
                      title="닉네임 사용 가능 여부"
                    >
                      닉네임 중복 확인
                    </button>
                  </div>
                  <small id="nicknameHint" class="form-hint register-field-hint" aria-live="polite">
                    닉네임을 입력한 뒤 「닉네임 중복 확인」을 눌러주세요. (최대 20자)
                  </small>
                </div>
              </div>

              <div class="register-col register-col--right">
                <div class="form-group">
                  <label class="form-label" for="username">
                    아이디 <span class="required">*</span>
                  </label>
                  <div class="register-input-line">
                    <input
                      type="text"
                      id="username"
                      name="username"
                      class="form-input"
                      required
                      pattern="[a-zA-Z0-9_]+"
                      minlength={3}
                      maxlength={30}
                      autocomplete="username"
                    />
                  </div>
                  <div class="register-dup-btn-row">
                    <button
                      type="button"
                      class="nav-btn register-dup-btn"
                      id="btnCheckUsername"
                      title="아이디 사용 가능 여부"
                    >
                      중복 확인
                    </button>
                  </div>
                  <small id="usernameHint" class="form-hint register-field-hint" aria-live="polite">
                    영문, 숫자, 밑줄(_)만 사용할 수 있으며 3자 이상 30자 이하로 입력해 주세요.
                  </small>
                </div>

                <div class="form-group">
                  <label class="form-label" for="password">
                    비밀번호 <span class="required">*</span>
                  </label>
                  <div class="register-input-line">
                    <div class="password-wrap">
                      <input
                        type="password"
                        id="password"
                        name="password"
                        class="form-input"
                        required
                        minlength={8}
                        maxlength={20}
                        autocomplete="new-password"
                      />
                      <button
                        type="button"
                        class="pw-toggle"
                        aria-label="비밀번호 표시"
                        onclick="togglePw('password')"
                      >
                        👁
                      </button>
                    </div>
                  </div>
                  <small class="form-hint register-field-hint">8자 이상 20자 이하로 입력해 주세요.</small>
                </div>

                <div class="form-group">
                  <label class="form-label" for="passwordConfirm">
                    비밀번호 확인 <span class="required">*</span>
                  </label>
                  <div class="register-input-line">
                    <div class="password-wrap">
                      <input
                        type="password"
                        id="passwordConfirm"
                        name="passwordConfirm"
                        class="form-input"
                        required
                        minlength={8}
                        maxlength={20}
                        autocomplete="new-password"
                      />
                      <button
                        type="button"
                        class="pw-toggle"
                        aria-label="비밀번호 표시"
                        onclick="togglePw('passwordConfirm')"
                      >
                        👁
                      </button>
                    </div>
                  </div>
                  <small
                    id="pwMatchMsg"
                    class="form-hint register-field-hint"
                    data-guide="비밀번호를 한 번 더 입력해 주세요."
                    aria-live="polite"
                  >
                    비밀번호를 한 번 더 입력해 주세요.
                  </small>
                </div>

                <div class="form-group captcha-group register-captcha-in-grid">
                  <label class="form-label">
                    로봇 방지 <span class="required">*</span>
                  </label>
                  <div class="captcha-box">
                    <span class="captcha-question" id="registerCaptchaQuestion">
                      {props.captchaQuestion}
                    </span>
                    <input
                      type="number"
                      name="captcha"
                      id="registerCaptchaInput"
                      class="form-input captcha-input"
                      placeholder="답을 입력하세요"
                      required
                    />
                  </div>
                </div>
              </div>
            </div>

            <div class="register-error-slot" aria-live="polite">
              <div
                id="registerClientError"
                class="register-top-error register-top-error--in-slot is-hidden"
                role="alert"
              ></div>
            </div>

            <div class="register-submit-row">
              <button type="submit" class="btn-primary register-submit-btn">
                회원가입
              </button>
            </div>
          </form>

          <p class="auth-switch">
            이미 계정이 있으신가요? <a href="/auth/login">로그인</a>
          </p>
        </div>
      </div>

      <div
        id="registerCropModal"
        class="register-crop-modal"
        hidden
        role="dialog"
        aria-modal="true"
        aria-labelledby="registerCropTitle"
      >
        <div id="registerCropBackdrop" class="register-crop-backdrop" aria-hidden="true"></div>
        <div class="register-crop-panel" role="document">
          <header class="register-crop-header">
            <button type="button" class="register-crop-iconbtn" id="registerCropClose" aria-label="닫기">
              ×
            </button>
            <h2 class="register-crop-title" id="registerCropTitle">
              이미지 편집하기
            </h2>
            <button
              type="button"
              class="register-crop-iconbtn register-crop-iconbtn--ok"
              id="registerCropConfirm"
              aria-label="확인"
            >
              ✓
            </button>
          </header>
          <div class="register-crop-body">
            <canvas id="registerCropCanvas" class="register-crop-canvas"></canvas>
          </div>
          <footer class="register-crop-footer">
            <button type="button" class="btn-primary register-crop-footer-btn" id="registerCropConfirmBar">
              확인
            </button>
          </footer>
        </div>
      </div>
    </Layout>
  );
}
