// Case-IN Voice — 아바타 어댑터
// 1차 개발에서는 간단한 CSS 기반 placeholder 아바타를 사용하고, 추후 외부 아바타 API로
// 쉽게 교체할 수 있도록 speak/stop/setListening/setThinking/setSpeaking 인터페이스만 노출한다.
// Case-IN 핵심 로직(voice-interview.js)은 이 인터페이스에만 의존하며 내부 구현을 모른다.
(function () {
  'use strict';

  function createPlaceholderAvatar(rootEl) {
    rootEl.innerHTML =
      '<div class="voice-avatar-face" data-state="idle">' +
      '<span class="voice-avatar-emoji">🙂</span>' +
      '<span class="voice-avatar-ring"></span>' +
      '</div>' +
      '<p class="voice-avatar-caption" id="voiceAvatarCaption">편하게 말씀해 주세요.</p>';

    const face = rootEl.querySelector('.voice-avatar-face');
    const caption = rootEl.querySelector('#voiceAvatarCaption');

    function setState(state, captionText) {
      face.dataset.state = state;
      if (captionText !== undefined) caption.textContent = captionText;
    }

    return {
      // text는 화면 자막 표시용으로만 사용한다 (실제 음성 재생은 RealtimeVoiceClient/WebRTC가 담당).
      speak(text) {
        setState('speaking', text || '');
      },
      stop() {
        setState('idle', '');
      },
      setListening(isListening) {
        if (isListening) setState('listening', '듣는 중입니다…');
      },
      setThinking(isThinking) {
        if (isThinking) setState('thinking', '생각하는 중입니다…');
      },
      setSpeaking(isSpeaking, text) {
        if (isSpeaking) setState('speaking', text || '');
      },
      setPaused() {
        setState('paused', '일시정지되었습니다.');
      },
      setError(message) {
        setState('error', message || '문제가 발생했습니다.');
      }
    };
  }

  window.AvatarAdapter = { create: createPlaceholderAvatar };
})();
