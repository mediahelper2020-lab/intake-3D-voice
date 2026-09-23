// Case-IN Voice — 아바타 어댑터
// 실사 사진 대신 Case-IN 로고를 글로시한 3D 오브(orb) 형태로 표현한다. 후광이 계속 은은하게
// 회전하며 "AI가 항상 살아 대기 중"이라는 느낌을 주고, 상태(듣는 중/생각 중/말하는 중 등)에 따라
// 후광 색상·속도와 오브의 빛나는 정도가 바뀐다. 실제 사람 사진이 아니므로 오인 위험이 없다.
// speak/stop/setListening/setThinking/setSpeaking/setPaused/setError 인터페이스만 지키면 되므로,
// 추후 실시간 영상 아바타 API로 이 파일만 교체해 넣을 수 있다. Case-IN 핵심 로직은 이 내부 구현을 모른다.
(function () {
  'use strict';

  const LOGO_ICON_SRC = 'avatar/logo-icon.png';

  function createOrbAvatar(rootEl) {
    rootEl.innerHTML =
      '<div class="voice-avatar-face" data-state="idle">' +
      '<div class="voice-orb-wrap">' +
      '<div class="voice-orb-halo"></div>' +
      '<div class="voice-orb-sphere">' +
      '<img class="voice-orb-icon" src="' + LOGO_ICON_SRC + '" alt="Case-IN AI" draggable="false">' +
      '<div class="voice-orb-sheen"></div>' +
      '</div>' +
      '</div>' +
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

  window.AvatarAdapter = { create: createOrbAvatar };
})();
