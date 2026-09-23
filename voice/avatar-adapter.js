// Case-IN Voice — 아바타 어댑터
// 실제 상담원 사진을 얼굴로 사용하되, 진짜 사람과 혼동되지 않도록 "AI 상담원입니다" 배지를 항상 표시하고
// 상태(듣는 중/생각 중/말하는 중 등)는 사진 테두리의 색·움직임으로 표현한다(실시간 립싱크 영상이 아님).
// speak/stop/setListening/setThinking/setSpeaking/setPaused/setError 인터페이스만 지키면 되므로,
// 추후 실시간 영상 아바타 API로 이 파일만 교체해 넣을 수 있다. Case-IN 핵심 로직은 이 내부 구현을 모른다.
(function () {
  'use strict';

  const AVATAR_IMAGE_SRC = 'avatar/consultant.jpg';

  function createPhotoAvatar(rootEl) {
    rootEl.innerHTML =
      '<div class="voice-avatar-face" data-state="idle">' +
      '<span class="voice-avatar-photo-ring">' +
      '<img class="voice-avatar-photo" src="' + AVATAR_IMAGE_SRC + '" alt="AI 상담원 아바타" draggable="false">' +
      '<span class="voice-avatar-mouth-bars" aria-hidden="true"><i></i><i></i><i></i></span>' +
      '</span>' +
      '<span class="voice-avatar-ai-badge">AI 상담원입니다</span>' +
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

  window.AvatarAdapter = { create: createPhotoAvatar };
})();
