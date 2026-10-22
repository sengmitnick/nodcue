<script def>
{
  "navigationBarTitleText": "不卡壳",
  "description": "同步个人默认词库，点头朗读任意语言词条，并可显示演讲倒计时。",
  "schema": {
    "data": {
      "type": "object",
      "properties": {}
    }
  }
}
</script>

<script setup>
import { createOpenAPI } from 'open';
import wx from 'wx';
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
import { createNodServiceClient } from '../../lib/nod-service.js';
import { NOD_SERVICE_CONFIG } from '../../lib/nod-service-config.js';
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
const PAIRING_POLL_MS = 2000;
const ACCOUNT_RETRY_DELAYS_MS = [0, 500];
const SERVICE_RETRY_DELAYS_MS = [0, 500, 1500, 3000];
const OPEN_API_TIMEOUT_MS = 2500;
const MOTION_HISTORY_SIZE = 20;
const SENSOR_GESTURE_COOLDOWN_MS = 2000;

export default {
  data: {
    mode: 'loading',
    libraryName: '个人词库',
    modeBadge: 'SYNC',
    words: [],
    currentIndex: 0,
    currentWord: { text: '', hint: '', language: 'auto', rate: 0.72 },
    positionLabel: '0 / 0',
    statusText: '正在同步默认词库',
    setupTitle: '连接个人词库',
    setupDetail: '正在读取 Rokid 账号',
    pairingCode: '····',
    pairingSeconds: 30,
    webLoginURL: '',
    timerVisible: false,
    timerText: '',
    languageLabel: 'AUTO TTS',
    menuOpen: false,
    menuIndex: 0,
    menuText0Class: 'menu-text-active',
    menuText1Class: 'menu-text',
    menuText2Class: 'menu-text',
    menuText3Class: 'menu-text',
    menuText4Class: 'menu-text',
    speaking: false,
    lastSpokenAt: 0,
  },

  _service: null,
  _accountId: '',
  _accountName: '',
  _pairingId: '',
  _pairingExpiresAt: 0,
  _pairingPurpose: 'setup',
  _pairingTimer: null,
  _pollTimer: null,
  _sessionTimer: null,
  _sessionStartedAt: 0,
  _sessionDuration: null,
  _syncing: false,
  _polling: false,
  _refreshing: false,
  _gyroscope: null,
  _pitchHistory: [],
  _yawHistory: [],
  _lastSensorGestureAt: 0,
  _lastShakeAt: 0,
  speakingTimer: null,

  onLoad() {
    if (typeof this.enableWorldAwareness === 'function') this.enableWorldAwareness();
    this._startHeadMotionDetection();
    this._bootstrap();
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
        console.warn('[nod-pronouncer] gyroscope unavailable', error && error.message || error);
      });
      this._gyroscope.start();
    } catch (error) {
      console.warn('[nod-pronouncer] gyroscope initialization failed', error && error.message || error);
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

  _initService() {
    const fetchImpl = typeof fetch === 'function' ? fetch : null;
    const storage = typeof localStorage !== 'undefined' ? localStorage : null;
    if (!fetchImpl || !storage) return false;
    try {
      this._service = createNodServiceClient({
        baseURL: NOD_SERVICE_CONFIG.baseURL,
        clientKey: NOD_SERVICE_CONFIG.clientKey,
        fetch: fetchImpl,
        storage,
        logger: console,
      });
      return true;
    } catch (_) {
      this._service = null;
      return false;
    }
  },

  async _ensureService() {
    if (this._service) return true;
    for (const delay of SERVICE_RETRY_DELAYS_MS) {
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      if (this._initService()) return true;
    }
    return false;
  },

  async _createOpenApi(namespace) {
    let timeoutId = null;
    try {
      const openPromise = namespace ? createOpenAPI(namespace) : createOpenAPI();
      return await Promise.race([
        openPromise,
        new Promise((resolve) => {
          timeoutId = setTimeout(() => resolve(null), OPEN_API_TIMEOUT_MS);
        }),
      ]);
    } catch (_) {
      return null;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  },

  async _readAccount() {
    for (const delay of ACCOUNT_RETRY_DELAYS_MS) {
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      let api = await this._createOpenApi();
      if (!api) api = await this._createOpenApi('dev');
      if (!api || !api.account || !api.account.getProfile) continue;
      try {
        const result = await api.account.getProfile({});
        const profile = result && result.data ? result.data : result;
        const accountId = String(profile && profile.accountId || '');
        if (!accountId) continue;
        return {
          accountId,
          accountName: String(profile.userName || profile.nickName || profile.nickname || profile.name || ''),
        };
      } catch (_) {}
    }
    return null;
  },

  async _bootstrap() {
    this._clearTimers();
    this._pairingPurpose = 'setup';
    this.setData({
      mode: 'loading',
      modeBadge: 'SYNC',
      setupTitle: '连接个人词库',
      setupDetail: '正在读取 Rokid 账号',
      statusText: '正在同步默认词库',
      pairingCode: '····',
    });
    await this._ensureService();
    const profile = await this._readAccount();
    if (!profile) {
      this._showOffline('未读取到 Rokid 账号', '请确认眼镜已登录后打开菜单重试');
      return;
    }
    this._accountId = profile.accountId;
    this._accountName = profile.accountName;
    const library = await this._syncDefault();
    if (library) {
      this._startReady(library, false);
      return;
    }
    const cached = this._service && this._service.readCachedDefaultLibrary({ accountId: this._accountId });
    if (cached) {
      this._startReady(cached, true);
      return;
    }
    await this._generatePairingCode();
  },

  async _syncDefault() {
    if (this._syncing || !this._service || !this._accountId) return null;
    this._syncing = true;
    const library = await this._service.readDefaultLibrary({ accountId: this._accountId });
    this._syncing = false;
    return library;
  },

  async _generatePairingCode(purpose = 'setup') {
    this._pairingPurpose = purpose;
    if (!this._service || !this._accountId) {
      this._showOffline('服务暂时不可用', '请启动电脑后端后打开菜单重试');
      return;
    }
    this._clearPairingTimers();
    if (this._sessionTimer) clearInterval(this._sessionTimer);
    this._sessionTimer = null;
    this.setData({
      mode: 'loading',
      modeBadge: 'PAIR',
      setupTitle: '正在生成配对码',
      setupDetail: '请稍候',
      statusText: '正在连接词库工作台',
      pairingCode: '····',
      pairingSeconds: 30,
    });
    const pairing = await this._service.createPairingCode({
      accountId: this._accountId,
      accountName: this._accountName,
    });
    if (!pairing) {
      this._showOffline('配对码生成失败', '请确认网络和后台服务正常');
      return;
    }
    this._pairingId = pairing.publicId;
    this._pairingExpiresAt = new Date(pairing.expiresAt).getTime();
    this.setData({
      mode: 'pairing',
      modeBadge: 'PAIR',
      setupTitle: '电脑网页登录',
      setupDetail: '电脑打开下方地址，输入四位码',
      statusText: '30 秒内到网页输入配对码',
      pairingCode: pairing.code,
      pairingSeconds: this._pairingRemaining(),
      webLoginURL: NOD_SERVICE_CONFIG.baseURL.replace(/^https?:\/\//, ''),
    });
    this._startPairingTimers();
  },

  _pairingRemaining() {
    return Math.max(0, Math.ceil((this._pairingExpiresAt - Date.now()) / 1000));
  },

  _startPairingTimers() {
    this._pairingTimer = setInterval(() => {
      const pairingSeconds = this._pairingRemaining();
      this.setData({ pairingSeconds });
      if (pairingSeconds <= 0 && this.data.mode === 'pairing') {
        this._clearPairingTimers();
        this.setData({
          mode: 'expired',
          setupTitle: '配对码已过期',
          setupDetail: '单击打开菜单重新操作',
          pairingCode: '----',
          statusText: '配对码只可使用一次',
        });
      }
    }, 1000);
    this._pollTimer = setInterval(() => this._pollPairingAndLibrary(), PAIRING_POLL_MS);
    this._pollPairingAndLibrary();
  },

  async _pollPairingAndLibrary() {
    if (this._polling || !this._service) return;
    this._polling = true;
    if (this._pairingId && this.data.mode === 'pairing') {
      const status = await this._service.readPairingStatus({
        accountId: this._accountId,
        publicId: this._pairingId,
      });
      if (status && status.status === 'consumed') {
        this._showPairingSuccess();
      } else if (status && (status.status === 'expired' || status.status === 'cancelled')) {
        this._clearPairingTimers();
        this.setData({
          mode: 'expired',
          setupTitle: '配对码已失效',
          setupDetail: '单击打开菜单重新操作',
          pairingCode: '----',
          statusText: '没有加载任何内置内容',
        });
      }
    }
    this._polling = false;
  },

  _showPairingSuccess() {
    this._clearPairingTimers();
    this.setData({
      mode: 'paired',
      modeBadge: 'PAIRED',
      setupTitle: '网页登录成功',
      setupDetail: '单击打开菜单，选择“刷新词库”',
      statusText: '网页工作台已登录',
      pairingCode: '✓',
      pairingSeconds: 0,
    });
  },

  _startReady(library, offline) {
    this._clearPairingTimers();
    this._pairingPurpose = 'setup';
    if (this._sessionTimer) clearInterval(this._sessionTimer);
    this._sessionDuration = library.countdownSeconds;
    this._sessionStartedAt = Date.now();
    const timerVisible = Boolean(this._sessionDuration);
    this.setData({
      mode: 'ready',
      modeBadge: offline ? 'OFFLINE' : 'SYNCED',
      libraryName: library.name,
      words: library.words,
      currentIndex: 0,
      currentWord: library.words[0],
      positionLabel: `1 / ${library.words.length}`,
      statusText: offline ? '离线词库 · 点头听 · 单击打开菜单' : '点头听发音 · 单击打开菜单',
      timerVisible,
      timerText: timerVisible ? formatCountdown(this._sessionDuration) : '',
      languageLabel: library.words[0].language === 'auto' ? 'AUTO TTS' : library.words[0].language,
      menuOpen: false,
      speaking: false,
    });
    if (timerVisible) this._sessionTimer = setInterval(() => this._tickSessionTimer(), 1000);
  },

  _tickSessionTimer() {
    const remaining = countdownRemaining(this._sessionDuration, this._sessionStartedAt, Date.now());
    this.setData({ timerText: formatCountdown(remaining) });
    if (remaining === 0) {
      if (this._sessionTimer) clearInterval(this._sessionTimer);
      this._sessionTimer = null;
      this.setData({ statusText: '时间到 · 点头仍可听发音' });
    }
  },

  _showOffline(title, detail) {
    this._clearPairingTimers();
    this.setData({
      mode: 'offline',
      modeBadge: 'OFFLINE',
      setupTitle: title,
      setupDetail: detail,
      statusText: '单击打开菜单重试',
      pairingCode: '!',
      pairingSeconds: 0,
    });
  },

  _clearPairingTimers() {
    if (this._pairingTimer) clearInterval(this._pairingTimer);
    if (this._pollTimer) clearInterval(this._pollTimer);
    this._pairingTimer = null;
    this._pollTimer = null;
  },

  _clearTimers() {
    this._clearPairingTimers();
    if (this._sessionTimer) clearInterval(this._sessionTimer);
    if (this.speakingTimer) clearTimeout(this.speakingTimer);
    this._sessionTimer = null;
    this.speakingTimer = null;
  },

  _openActionMenu() {
    if (this.data.mode === 'loading' || this._refreshing) return;
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

  async _executeActionMenu() {
    const action = selectedFocusItem(ACTION_MENU_ITEMS, this.data.menuIndex);
    if (!action || action.enabled === false) return;
    this._closeActionMenu();
    switch (action.id) {
      case 'speak': this.trySpeak('nod', true); break;
      case 'next-word': this.moveWord(1); break;
      case 'refresh-library': await this._refreshLibraryFromMenu(); break;
      case 'web-login': await this._generatePairingCode('manage'); break;
      case 'exit': this._exitApp(); break;
    }
  },

  async _refreshLibraryFromMenu() {
    if (this._refreshing || !this._service || !this._accountId) {
      this.setData({ statusText: '刷新失败，请稍后重试' });
      return;
    }
    this._refreshing = true;
    const previousMode = this.data.mode;
    const previousBadge = this.data.modeBadge;
    this.setData({ modeBadge: 'SYNC', statusText: '正在刷新默认词库' });
    const result = await this._service.readDefaultLibraryResult({ accountId: this._accountId });
    this._refreshing = false;
    if (result.status === 'ready') {
      this._startReady(result.library, false);
      return;
    }
    this.setData({
      mode: previousMode,
      modeBadge: previousBadge,
      statusText: result.status === 'missing'
        ? '网页端还没有默认词库'
        : '刷新失败，请稍后重试',
    });
  },

  _exitApp() {
    this.setData({ statusText: '正在退出…' });
    setTimeout(() => {
      try { wx.exitMiniProgram({}); } catch (_) {}
    }, 500);
  },

  _handleHeadGesture(gesture, now = Date.now()) {
    if (this.data.mode !== 'ready' || this.data.menuOpen) return;
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
    if (this.data.mode !== 'ready') return;
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
    if (!this.data.words.length) {
      this.setData({ statusText: '还没有词汇，请先刷新词库' });
      return;
    }
    const index = moveIndex(this.data.currentIndex, delta, this.data.words.length);
    this.setData({
      currentIndex: index,
      currentWord: this.data.words[index],
      positionLabel: `${index + 1} / ${this.data.words.length}`,
      languageLabel: this.data.words[index].language === 'auto' ? 'AUTO TTS' : this.data.words[index].language,
      statusText: this.data.timerText === '00:00' ? '时间到 · 点头可听 · 单击打开菜单' : '点头听发音 · 单击打开菜单',
    });
  },

  trySpeak(gesture, force = false) {
    if (!this.data.currentWord.text) {
      this.setData({ statusText: '还没有词汇，请先刷新词库' });
      return;
    }
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
          statusText: this.data.timerText === '00:00' ? '时间到 · 点头可听 · 单击打开菜单' : '点头再听 · 单击打开菜单',
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
    <view class="word-stage" ink:if="{{mode === 'ready'}}">
      <text class="word">{{currentWord.text}}</text>
      <text class="meaning" ink:if="{{currentWord.hint}}">{{currentWord.hint}}</text>
      <text class="language">{{languageLabel}}</text>
    </view>

    <view class="setup-stage" ink:if="{{mode !== 'ready'}}">
      <text class="setup-title">{{setupTitle}}</text>
      <text class="pairing-code">{{pairingCode}}</text>
      <text class="setup-detail">{{setupDetail}}</text>
      <text class="web-url" ink:if="{{mode === 'pairing'}}">{{webLoginURL}}</text>
      <text class="pairing-countdown" ink:if="{{mode === 'pairing'}}">{{pairingSeconds}}s</text>
    </view>

    <view class="pairing-progress" ink:if="{{mode === 'pairing'}}">
      <view class="pairing-progress-value" style="width: {{ pairingSeconds / 30 * 100 }}%;"></view>
    </view>

    <view class="action-menu" ink:if="{{menuOpen}}">
      <view class="menu-row">
        <text class="menu-arrow" ink:if="{{menuIndex === 0}}">></text>
        <image class="menu-icon" ink:if="{{menuIndex !== 0}}" src="/assets/icons/speak.svg" mode="aspectFit"></image>
        <text class="{{menuText0Class}}">朗读词汇</text>
      </view>
      <view class="menu-row">
        <text class="menu-arrow" ink:if="{{menuIndex === 1}}">></text>
        <image class="menu-icon" ink:if="{{menuIndex !== 1}}" src="/assets/icons/next.svg" mode="aspectFit"></image>
        <text class="{{menuText1Class}}">下个词汇</text>
      </view>
      <view class="menu-row">
        <text class="menu-arrow" ink:if="{{menuIndex === 2}}">></text>
        <image class="menu-icon" ink:if="{{menuIndex !== 2}}" src="/assets/icons/refresh.svg" mode="aspectFit"></image>
        <text class="{{menuText2Class}}">刷新词库</text>
      </view>
      <view class="menu-row">
        <text class="menu-arrow" ink:if="{{menuIndex === 3}}">></text>
        <image class="menu-icon" ink:if="{{menuIndex !== 3}}" src="/assets/icons/login.svg" mode="aspectFit"></image>
        <text class="{{menuText3Class}}">网页登录</text>
      </view>
      <view class="menu-row">
        <text class="menu-arrow" ink:if="{{menuIndex === 4}}">></text>
        <image class="menu-icon" ink:if="{{menuIndex !== 4}}" src="/assets/icons/exit.svg" mode="aspectFit"></image>
        <text class="{{menuText4Class}}">退出</text>
      </view>
    </view>

    <view class="footer">
      <text class="status">{{statusText}}</text>
      <view class="footer-right">
        <text class="position" ink:if="{{mode === 'ready'}}">{{positionLabel}}</text>
        <text class="timer" ink:if="{{mode === 'ready' && timerVisible}}">{{timerText}}</text>
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

.footer,
.footer-right {
  display: flex;
  flex-direction: row;
  align-items: center;
}

.footer { justify-content: space-between; }
.footer-right { gap: 9px; }

.language,
.pairing-countdown {
  color: rgba(204, 255, 212, 0.62);
  font-size: 10px;
  letter-spacing: 1px;
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

.setup-stage {
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

.language { margin-top: 7px; letter-spacing: 1px; }
.setup-title { color: rgba(238, 255, 241, 0.82); font-size: 14px; font-weight: bold; }

.pairing-code {
  margin: 4px 0 3px;
  color: #70ff8a;
  font-size: 42px;
  line-height: 48px;
  font-weight: bold;
  letter-spacing: 12px;
}

.setup-detail { color: rgba(214, 239, 219, 0.66); font-size: 11px; line-height: 16px; text-align: center; }
.web-url { margin-top: 4px; max-width: 424px; color: #70ff8a; font-size: 10px; text-align: center; }
.pairing-countdown { margin-top: 6px; color: #70ff8a; font-weight: bold; }

.pairing-progress {
  position: absolute;
  left: 50%;
  bottom: 47px;
  width: 260px;
  height: 1px;
  transform: translateX(-50%);
  background: rgba(112, 255, 138, 0.12);
}

.pairing-progress-value {
  height: 1px;
  background: #70ff8a;
}

.footer {
  position: absolute;
  left: 28px;
  right: 28px;
  bottom: 14px;
  height: 18px;
}

.status {
  max-width: 258px;
  overflow: hidden;
  color: #70ff8a;
  font-size: 11px;
  font-weight: bold;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.position {
  color: rgba(204, 255, 212, 0.56);
  font-size: 10px;
}

.timer {
  min-width: 48px;
  color: #f3fff5;
  font-size: 16px;
  font-weight: bold;
  text-align: right;
}

.action-menu {
  position: absolute;
  right: 18px;
  bottom: 42px;
  z-index: 20;
  min-width: 136px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 7px 9px;
  box-sizing: border-box;
  background-color: rgba(0, 0, 0, 0.9);
  border: 1px solid rgba(64, 255, 94, 0.34);
  border-radius: 10px;
}

.menu-row {
  height: 25px;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
  padding: 2px 7px;
  box-sizing: border-box;
}

.menu-icon {
  width: 16px;
  height: 16px;
}

.menu-arrow {
  width: 16px;
  font-size: 14px;
  line-height: 18px;
  color: #40ff5e;
  font-weight: bold;
  text-align: center;
}

.menu-text {
  font-size: 13px;
  line-height: 18px;
  color: rgba(255, 255, 255, 0.8);
}

.menu-text-active {
  font-size: 13px;
  line-height: 18px;
  color: #40ff5e;
  font-weight: bold;
}

</style>
