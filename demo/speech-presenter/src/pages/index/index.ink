<script def>
{
  "navigationBarTitleText": "演讲发音助手",
  "description": "内置演讲易卡词，点头听发音，镜腿切词，并显示十分钟倒计时。",
  "schema": {
    "data": {
      "type": "object",
      "properties": {}
    }
  }
}
</script>

<script setup>
import wx from 'wx';
import { DEMO_LIBRARY } from '../../data/demo-words.js';
import {
  ACTION_MENU_ITEMS,
  actionMenuSelection,
} from '../../lib/action-menu.js';
import {
  firstEnabledIndex,
  moveFocus,
  selectedFocusItem,
} from '../../lib/focus-navigation.js';
import { actionFromKey } from '../../lib/input-actions.js';
import {
  countdownRemaining,
  detectNod,
  detectShake,
  formatCountdown,
  moveIndex,
  normalizeGesture,
  pronunciationRequest,
  shouldAdvanceOnShake,
  shouldSpeak,
} from '../../lib/pronunciation-session.js';

const SPEAKING_WINDOW_MS = 2200;
const MOTION_HISTORY_SIZE = 20;
const SENSOR_GESTURE_COOLDOWN_MS = 2000;

export default {
  data: {
    libraryName: DEMO_LIBRARY.name,
    words: DEMO_LIBRARY.words,
    currentIndex: 0,
    currentWord: DEMO_LIBRARY.words[0],
    positionLabel: `1 / ${DEMO_LIBRARY.words.length}`,
    statusText: '点头听发音 · 滑动镜腿切词 · 单击打开菜单',
    timerText: formatCountdown(DEMO_LIBRARY.countdownSeconds),
    languageLabel: 'EN-US',
    menuOpen: false,
    menuIndex: 0,
    menuText0Class: 'menu-text-active',
    menuText1Class: 'menu-text',
    menuText2Class: 'menu-text',
    menuText3Class: 'menu-text',
    speaking: false,
    lastSpokenAt: 0,
  },

  _sessionTimer: null,
  _sessionStartedAt: 0,
  _gyroscope: null,
  _pitchHistory: [],
  _yawHistory: [],
  _lastSensorGestureAt: 0,
  _lastShakeAt: 0,
  speakingTimer: null,

  onLoad() {
    if (typeof this.enableWorldAwareness === 'function') this.enableWorldAwareness();
    this._startHeadMotionDetection();
    this._resetTimer();
  },

  onUnload() {
    this._stopHeadMotionDetection();
    this._clearTimers();
  },

  _startHeadMotionDetection() {
    if (this._gyroscope || typeof Gyroscope === 'undefined') return;
    try {
      this._gyroscope = new Gyroscope({ frequency: 30 });
      this._gyroscope.addEventListener('reading', (event) => {
        const pitch = Number(event && event.x);
        const yaw = Number(event && event.y);
        if (!Number.isFinite(pitch) || !Number.isFinite(yaw)) return;
        this._pitchHistory.push(pitch);
        this._yawHistory.push(yaw);
        if (this._pitchHistory.length > MOTION_HISTORY_SIZE) this._pitchHistory.shift();
        if (this._yawHistory.length > MOTION_HISTORY_SIZE) this._yawHistory.shift();
        const gesture = detectNod(this._pitchHistory, this._yawHistory)
          ? 'nod'
          : detectShake(this._pitchHistory, this._yawHistory) ? 'shake' : 'unknown';
        if (gesture === 'unknown') return;
        const now = Date.now();
        if (now - this._lastSensorGestureAt < SENSOR_GESTURE_COOLDOWN_MS) return;
        this._lastSensorGestureAt = now;
        this._pitchHistory = [];
        this._yawHistory = [];
        this._handleHeadGesture(gesture, now);
      });
      this._gyroscope.addEventListener('error', (error) => {
        console.warn('[speech-presenter] gyroscope unavailable', error && error.message || error);
      });
      this._gyroscope.start();
    } catch (error) {
      console.warn('[speech-presenter] gyroscope initialization failed', error && error.message || error);
      this._gyroscope = null;
    }
  },

  _stopHeadMotionDetection() {
    if (this._gyroscope) {
      try { this._gyroscope.stop(); } catch (_) {}
    }
    this._gyroscope = null;
    this._pitchHistory = [];
    this._yawHistory = [];
  },

  _resetTimer() {
    if (this._sessionTimer) clearInterval(this._sessionTimer);
    this._sessionStartedAt = Date.now();
    this.setData({
      timerText: formatCountdown(DEMO_LIBRARY.countdownSeconds),
      statusText: '点头听发音 · 滑动镜腿切词 · 单击打开菜单',
    });
    this._sessionTimer = setInterval(() => this._tickSessionTimer(), 1000);
  },

  _tickSessionTimer() {
    const remaining = countdownRemaining(
      DEMO_LIBRARY.countdownSeconds,
      this._sessionStartedAt,
      Date.now(),
    );
    this.setData({ timerText: formatCountdown(remaining) });
    if (remaining === 0) {
      if (this._sessionTimer) clearInterval(this._sessionTimer);
      this._sessionTimer = null;
      this.setData({ statusText: '时间到 · 点头仍可听发音' });
    }
  },

  _clearTimers() {
    if (this._sessionTimer) clearInterval(this._sessionTimer);
    if (this.speakingTimer) clearTimeout(this.speakingTimer);
    this._sessionTimer = null;
    this.speakingTimer = null;
  },

  _openActionMenu() {
    const menuIndex = firstEnabledIndex(ACTION_MENU_ITEMS);
    if (menuIndex < 0) return;
    this.setData({
      menuOpen: true,
      ...actionMenuSelection(menuIndex),
    });
  },

  _closeActionMenu() {
    this.setData({ menuOpen: false });
  },

  _moveActionMenu(delta) {
    const menuIndex = moveFocus(ACTION_MENU_ITEMS, this.data.menuIndex, delta);
    if (menuIndex < 0) return;
    this.setData(actionMenuSelection(menuIndex));
  },

  _executeActionMenu() {
    const action = selectedFocusItem(ACTION_MENU_ITEMS, this.data.menuIndex);
    if (!action || action.enabled === false) return;
    this._closeActionMenu();
    switch (action.id) {
      case 'speak': this.trySpeak('nod', true); break;
      case 'next-word': this.moveWord(1); break;
      case 'reset-timer': this._resetTimer(); break;
      case 'exit': this._exitApp(); break;
    }
  },

  _exitApp() {
    this.setData({ statusText: '正在退出…' });
    setTimeout(() => {
      try { wx.exitMiniProgram({}); } catch (_) {}
    }, 500);
  },

  _handleHeadGesture(gesture, now = Date.now()) {
    if (this.data.menuOpen) return;
    if (gesture === 'nod') {
      this.trySpeak(gesture);
      return;
    }
    if (!shouldAdvanceOnShake({
      gesture,
      speaking: this.data.speaking,
      now,
      lastAdvancedAt: this._lastShakeAt,
    })) return;
    this._lastShakeAt = now;
    this.moveWord(1);
  },

  onHeadGesture(event) {
    this._handleHeadGesture(normalizeGesture(event));
  },

  onKeyUp(event) {
    const action = actionFromKey(event);
    if (action === 'BACK_OR_PAUSE') {
      if (this.data.menuOpen) {
        if (event && event.preventDefault) event.preventDefault();
        this._closeActionMenu();
      }
      return;
    }
    if (this.data.menuOpen) {
      if (action === 'PREVIOUS' || action === 'NEXT') {
        if (event && event.preventDefault) event.preventDefault();
        this._moveActionMenu(action === 'PREVIOUS' ? -1 : 1);
      } else if (action === 'CONFIRM') {
        if (event && event.preventDefault) event.preventDefault();
        this._executeActionMenu();
      }
      return;
    }
    if (action === 'CONFIRM') {
      if (event && event.preventDefault) event.preventDefault();
      this._openActionMenu();
      return;
    }
    if (action === 'PREVIOUS' || action === 'NEXT') {
      if (event && event.preventDefault) event.preventDefault();
      this.moveWord(action === 'PREVIOUS' ? -1 : 1);
    }
  },

  handleTap() {
    if (this.data.menuOpen) this._executeActionMenu();
    else this._openActionMenu();
  },

  moveWord(delta) {
    const index = moveIndex(this.data.currentIndex, delta, this.data.words.length);
    const currentWord = this.data.words[index];
    this.setData({
      currentIndex: index,
      currentWord,
      positionLabel: `${index + 1} / ${this.data.words.length}`,
      languageLabel: currentWord.language.toUpperCase(),
      statusText: this.data.timerText === '00:00'
        ? '时间到 · 点头可听 · 单击打开菜单'
        : '点头听发音 · 滑动镜腿切词 · 单击打开菜单',
    });
  },

  trySpeak(gesture, force = false) {
    const now = Date.now();
    if (force) {
      if (this.data.speaking) return;
    } else if (!shouldSpeak({
      gesture,
      speaking: this.data.speaking,
      now,
      lastSpokenAt: this.data.lastSpokenAt,
    })) return;

    const hasWebSpeech = typeof SpeechSynthesisUtterance !== 'undefined'
      && typeof speechSynthesis !== 'undefined';
    const hasWxSpeech = Boolean(wx && wx.speech && typeof wx.speech.playTTS === 'function');
    if (!hasWebSpeech && !hasWxSpeech) {
      this.setData({ statusText: '当前设备暂不支持朗读' });
      return;
    }

    const request = pronunciationRequest(this.data.currentWord);
    this.setData({ speaking: true, lastSpokenAt: now, statusText: '正在朗读，跟我读' });
    try {
      if (hasWebSpeech) {
        const utterance = new SpeechSynthesisUtterance(request.text);
        if (request.lang) utterance.lang = request.lang;
        utterance.rate = request.rate;
        utterance.pitch = request.pitch;
        utterance.volume = request.volume;
        speechSynthesis.speak(utterance);
      } else {
        wx.speech.playTTS(request.text);
      }
      this.speakingTimer = setTimeout(() => {
        this.setData({
          speaking: false,
          statusText: this.data.timerText === '00:00'
            ? '时间到 · 点头可听 · 单击打开菜单'
            : '点头再听 · 滑动镜腿切词 · 单击打开菜单',
        });
        this.speakingTimer = null;
      }, SPEAKING_WINDOW_MS);
    } catch (_) {
      this.setData({ speaking: false, statusText: '朗读失败，请重试' });
    }
  },
};
</script>

<page>
  <view class="page" bindtap="handleTap">
    <view class="word-stage">
      <text class="eyebrow">{{libraryName}}</text>
      <text class="word">{{currentWord.text}}</text>
      <text class="meaning">{{currentWord.hint}}</text>
      <text class="language">{{languageLabel}}</text>
    </view>

    <view class="action-menu" ink:if="{{menuOpen}}">
      <view class="menu-row">
        <text class="menu-arrow" ink:if="{{menuIndex === 0}}">&gt;</text>
        <image class="menu-icon" ink:if="{{menuIndex !== 0}}" src="/assets/icons/speak.svg" mode="aspectFit"></image>
        <text class="{{menuText0Class}}">朗读当前词</text>
      </view>
      <view class="menu-row">
        <text class="menu-arrow" ink:if="{{menuIndex === 1}}">&gt;</text>
        <image class="menu-icon" ink:if="{{menuIndex !== 1}}" src="/assets/icons/next.svg" mode="aspectFit"></image>
        <text class="{{menuText1Class}}">下一个词</text>
      </view>
      <view class="menu-row">
        <text class="menu-arrow" ink:if="{{menuIndex === 2}}">&gt;</text>
        <image class="menu-icon" ink:if="{{menuIndex !== 2}}" src="/assets/icons/refresh.svg" mode="aspectFit"></image>
        <text class="{{menuText2Class}}">重新计时</text>
      </view>
      <view class="menu-row">
        <text class="menu-arrow" ink:if="{{menuIndex === 3}}">&gt;</text>
        <image class="menu-icon" ink:if="{{menuIndex !== 3}}" src="/assets/icons/exit.svg" mode="aspectFit"></image>
        <text class="{{menuText3Class}}">退出</text>
      </view>
    </view>

    <view class="footer">
      <text class="status">{{statusText}}</text>
      <view class="footer-right">
        <text class="position">{{positionLabel}}</text>
        <text class="timer">{{timerText}}</text>
      </view>
    </view>
  </view>
</page>

<style>
.page {
  width: 480px;
  height: 352px;
  position: relative;
  box-sizing: border-box;
  padding: 0;
  background-color: #000;
  overflow: hidden;
}

.word-stage {
  position: absolute;
  left: 28px;
  right: 28px;
  bottom: 58px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.eyebrow {
  margin-bottom: 6px;
  color: rgba(112, 255, 138, 0.68);
  font-size: 10px;
  letter-spacing: 1px;
}

.word {
  max-width: 424px;
  color: #f1fff4;
  font-size: 52px;
  font-weight: bold;
  line-height: 1.02;
  text-align: center;
  word-break: break-all;
}

.meaning {
  max-width: 424px;
  margin-top: 5px;
  color: rgba(216, 239, 220, 0.68);
  font-size: 16px;
  line-height: 21px;
  text-align: center;
}

.language {
  margin-top: 7px;
  color: rgba(204, 255, 212, 0.62);
  font-size: 10px;
  letter-spacing: 1px;
}

.action-menu {
  position: absolute;
  right: 18px;
  bottom: 49px;
  width: 168px;
  box-sizing: border-box;
  padding: 10px 12px;
  background-color: rgba(0, 13, 3, 0.96);
  border: 1px solid rgba(112, 255, 138, 0.34);
}

.menu-row {
  height: 28px;
  display: flex;
  flex-direction: row;
  align-items: center;
}

.menu-icon,
.menu-arrow {
  width: 16px;
  height: 16px;
  margin-right: 7px;
  color: #70ff8a;
  font-size: 14px;
  line-height: 16px;
}

.menu-text,
.menu-text-active {
  color: rgba(216, 239, 220, 0.7);
  font-size: 13px;
  line-height: 18px;
}

.menu-text-active {
  color: #70ff8a;
  font-weight: bold;
}

.footer,
.footer-right {
  display: flex;
  flex-direction: row;
  align-items: center;
}

.footer {
  position: absolute;
  left: 20px;
  right: 20px;
  bottom: 18px;
  height: 22px;
  justify-content: space-between;
}

.footer-right { gap: 9px; }

.status {
  max-width: 330px;
  color: rgba(112, 255, 138, 0.78);
  font-size: 10px;
  line-height: 14px;
}

.position,
.timer {
  color: rgba(204, 255, 212, 0.62);
  font-size: 10px;
  line-height: 14px;
}

.timer {
  color: #70ff8a;
  font-weight: bold;
}
</style>
