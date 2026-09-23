// Case-IN Voice — 아바타 어댑터
// 실사 사진 대신 Case-IN 로고를 글로시한 3D 오브(orb) 형태로 표현한다. 후광이 계속 은은하게
// 회전하며 "AI가 항상 살아 대기 중"이라는 느낌을 주고, 상태(듣는 중/생각 중/말하는 중 등)에 따라
// 후광 색상·속도와 오브의 빛나는 정도가 바뀐다. 마우스/터치로 움직이면 오브가 그 방향으로
// 살짝 기울어지고 하이라이트가 따라 움직이는 인터랙티브 3D 틸트 효과가 더해진다.
// 실제 사람 사진이 아니므로 오인 위험이 없다.
// speak/stop/setListening/setThinking/setSpeaking/setPaused/setError 인터페이스만 지키면 되므로,
// 추후 실시간 영상 아바타 API로 이 파일만 교체해 넣을 수 있다. Case-IN 핵심 로직은 이 내부 구현을 모른다.
(function () {
  'use strict';

  const LOGO_ICON_SRC = 'avatar/logo-full.png';
  const MAX_TILT_DEG = 20;

  function createOrbAvatar(rootEl) {
    rootEl.innerHTML =
      '<div class="voice-avatar-face" data-state="idle">' +
      '<div class="voice-orb-wrap">' +
      '<div class="voice-orb-tilt">' +
      '<div class="voice-orb-halo"></div>' +
      '<div class="voice-orb-sphere">' +
      '<img class="voice-orb-icon" src="' + LOGO_ICON_SRC + '" alt="Case-IN AI" draggable="false">' +
      '<div class="voice-orb-sheen"></div>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '<span class="voice-orb-hint">움직여 보세요</span>' +
      '</div>' +
      '<p class="voice-avatar-caption" id="voiceAvatarCaption">편하게 말씀해 주세요.</p>';

    const face = rootEl.querySelector('.voice-avatar-face');
    const caption = rootEl.querySelector('#voiceAvatarCaption');
    const wrap = rootEl.querySelector('.voice-orb-wrap');
    const tilt = rootEl.querySelector('.voice-orb-tilt');
    const sheen = rootEl.querySelector('.voice-orb-sheen');

    function applyTilt(rx, ry, hovering) {
      tilt.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg) scale(${hovering ? 1.05 : 1})`;
      if (sheen) sheen.style.transform = `translate(${ry * 1.1}px, ${-rx * 1.1}px)`;
    }

    function handlePointer(clientX, clientY) {
      const rect = wrap.getBoundingClientRect();
      const dx = (clientX - (rect.left + rect.width / 2)) / (rect.width / 2);
      const dy = (clientY - (rect.top + rect.height / 2)) / (rect.height / 2);
      const clampedX = Math.max(-1, Math.min(1, dx));
      const clampedY = Math.max(-1, Math.min(1, dy));
      applyTilt(-clampedY * MAX_TILT_DEG, clampedX * MAX_TILT_DEG, true);
    }

    function resetTilt() {
      applyTilt(0, 0, false);
    }

    rootEl.addEventListener('pointermove', (e) => handlePointer(e.clientX, e.clientY));
    rootEl.addEventListener('pointerleave', resetTilt);
    rootEl.addEventListener('pointerdown', (e) => handlePointer(e.clientX, e.clientY));
    resetTilt();

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
