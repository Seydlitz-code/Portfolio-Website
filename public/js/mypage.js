(function () {
  const form = document.getElementById('mypageForm');
  const siteInput = document.getElementById('mypageSiteName');
  const bioInput = document.getElementById('mypageBio');
  const fileInput = document.getElementById('mypageFileInput');
  const resetBtn = document.getElementById('mypageResetBtn');
  if (!form || !siteInput || !bioInput || !resetBtn) return;

  const init = window.__MYPAGE_INITIAL__ || { site_name: '', bio: '', profile_image: '' };
  const preview = document.getElementById('mypageProfilePreview');
  const noImg = document.getElementById('mypageNoImg');
  let objectUrl = null;

  function setProfileVisual(url) {
    if (!preview || !noImg) return;
    if (url) {
      preview.style.display = '';
      preview.src = url;
      noImg.style.display = 'none';
    } else {
      preview.removeAttribute('src');
      preview.style.display = 'none';
      noImg.style.display = 'flex';
    }
  }

  resetBtn.addEventListener('click', function () {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
    siteInput.value = init.site_name;
    bioInput.value = init.bio;
    if (fileInput) fileInput.value = '';
    if (init.profile_image) {
      setProfileVisual(init.profile_image);
    } else {
      setProfileVisual('');
    }
  });

  if (fileInput) {
    fileInput.addEventListener('change', function () {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = null;
      }
      if (this.files && this.files[0]) {
        objectUrl = URL.createObjectURL(this.files[0]);
        setProfileVisual(objectUrl);
        return;
      }
      if (init.profile_image) {
        setProfileVisual(init.profile_image);
      } else {
        setProfileVisual('');
      }
    });
  }
})();
