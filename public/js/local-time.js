/* ========================================
   서버가 렌더한 시각(<time data-local-time datetime="ISO UTC">)을
   방문자 브라우저 시간대로 다시 표시
   ======================================== */
(function () {
  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function formatList(d) {
    return (
      d.getFullYear() + '.' + pad(d.getMonth() + 1) + '.' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
    );
  }

  function formatComment(d) {
    return d.toLocaleString('ko-KR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  }

  function apply(root) {
    var nodes = (root || document).querySelectorAll('time[data-local-time]');
    for (var i = 0; i < nodes.length; i += 1) {
      var el = nodes[i];
      var iso = el.getAttribute('datetime');
      if (!iso) continue;
      var d = new Date(iso);
      if (Number.isNaN(d.getTime())) continue;
      var kind = el.getAttribute('data-local-time');
      var text = kind === 'comment' ? formatComment(d) : formatList(d);
      el.textContent = text + (el.getAttribute('data-suffix') || '');
    }
  }

  window.applyLocalTimes = apply;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      apply();
    });
  } else {
    apply();
  }
})();
