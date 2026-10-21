/**
 * 마이페이지 — 메인 페이지 설정: 메인 프로필 이미지 미리보기
 */
(function () {
  const cfg = window.__MYPAGE_MAIN_SETTINGS__;
  if (!cfg) return;

  const form = document.getElementById('mypageMainSettingsForm');
  const fileInput = document.getElementById('mypageMainFileInput');
  const btnSelect = document.getElementById('mypageMainBtnSelectImage');
  const preview = document.getElementById('mypageMainProfilePreview');
  const noImg = document.getElementById('mypageMainNoImg');

  if (!form) return;

  let objectUrl = null;

  function setProfileVisual(url, showImg) {
    if (!preview || !noImg) return;
    if (showImg && url) {
      preview.style.display = '';
      preview.src = url;
      noImg.style.display = 'none';
    } else if (cfg.profile_image) {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = null;
      }
      preview.style.display = '';
      preview.src = cfg.profile_image;
      noImg.style.display = 'none';
    } else {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = null;
      }
      preview.removeAttribute('src');
      preview.style.display = 'none';
      noImg.style.display = 'flex';
    }
  }

  if (btnSelect && fileInput) {
    btnSelect.addEventListener('click', function () {
      fileInput.click();
    });
    fileInput.addEventListener('change', function () {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = null;
      }
      if (this.files && this.files[0]) {
        objectUrl = URL.createObjectURL(this.files[0]);
        setProfileVisual(objectUrl, true);
        return;
      }
      setProfileVisual('', false);
    });
  }
})();
