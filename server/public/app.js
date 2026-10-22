const COMMON_LANGUAGES = ['auto', 'zh-CN', 'en-US', 'ja-JP', 'ko-KR', 'fr-FR', 'es-ES'];

const state = {
  user: null,
  libraries: [],
  defaultLibraryId: null,
  selectedLibraryId: null,
};

const elements = {
  loginView: document.querySelector('#login-view'),
  workspaceView: document.querySelector('#workspace-view'),
  pairingForm: document.querySelector('#pairing-form'),
  pairingCode: document.querySelector('#pairing-code'),
  ownerName: document.querySelector('#owner-name'),
  logoutButton: document.querySelector('#logout-button'),
  createLibraryForm: document.querySelector('#create-library-form'),
  timerEnabled: document.querySelector('#library-timer-enabled'),
  timerField: document.querySelector('#library-timer-field'),
  libraryList: document.querySelector('#library-list'),
  emptyLibrary: document.querySelector('#empty-library'),
  editorContent: document.querySelector('#editor-content'),
  editorTitle: document.querySelector('#editor-title'),
  libraryMeta: document.querySelector('#library-meta'),
  defaultButton: document.querySelector('#default-button'),
  deleteLibraryButton: document.querySelector('#delete-library-button'),
  librarySettingsForm: document.querySelector('#library-settings-form'),
  editLibraryName: document.querySelector('#edit-library-name'),
  editLibraryMinutes: document.querySelector('#edit-library-minutes'),
  wordForm: document.querySelector('#word-form'),
  wordLanguage: document.querySelector('#word-language'),
  customLanguageField: document.querySelector('#custom-language-field'),
  customLanguage: document.querySelector('#custom-language'),
  wordList: document.querySelector('#word-list'),
  status: document.querySelector('#status'),
};

let statusTimer = null;

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    body: options.body && typeof options.body !== 'string'
      ? JSON.stringify(options.body)
      : options.body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || 'request_failed');
    error.status = response.status;
    throw error;
  }
  return data;
}

function showStatus(message, type = 'success') {
  clearTimeout(statusTimer);
  elements.status.textContent = message;
  elements.status.className = `status-toast visible ${type === 'error' ? 'error' : ''}`;
  statusTimer = setTimeout(() => { elements.status.className = 'status-toast'; }, 2600);
}

function errorMessage(error) {
  const messages = {
    invalid_pairing_code: '配对码错误、已过期或已使用，请在眼镜刷新后重试。',
    rate_limited: '尝试次数过多，请稍后再试。',
    empty_library: '至少添加一个词条，才能设为默认词库。',
    invalid_language: '语言标签格式不正确，例如 zh-CN 或 de-DE。',
    invalid_countdown: '倒计时需设置为 1–240 分钟。',
  };
  return messages[error.message] || '操作没有完成，请重试。';
}

function selectedLibrary() {
  return state.libraries.find((library) => library.id === state.selectedLibraryId) || null;
}

function setAuthenticated(user) {
  state.user = user;
  elements.loginView.hidden = true;
  elements.workspaceView.hidden = false;
  elements.ownerName.textContent = user.accountName || 'Rokid 用户';
}

function setLoggedOut() {
  state.user = null;
  state.libraries = [];
  state.selectedLibraryId = null;
  elements.workspaceView.hidden = true;
  elements.loginView.hidden = false;
  elements.pairingCode.value = '';
}

function librarySummary(library) {
  const timer = library.countdownSeconds
    ? `${Math.round(library.countdownSeconds / 60)} 分钟`
    : '不计时';
  return `${library.words.length} 个词条 · ${timer}`;
}

function renderLibraryList() {
  elements.libraryList.replaceChildren();
  if (!state.libraries.length) {
    const empty = document.createElement('p');
    empty.className = 'field-help';
    empty.textContent = '还没有词库。创建第一个，开始准备。';
    elements.libraryList.append(empty);
    return;
  }
  for (const library of state.libraries) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `library-item ${library.id === state.selectedLibraryId ? 'active' : ''}`;
    const title = document.createElement('strong');
    title.textContent = library.name;
    if (library.id === state.defaultLibraryId) {
      const tag = document.createElement('span');
      tag.className = 'default-tag';
      tag.textContent = ' · 默认';
      title.append(tag);
    }
    const meta = document.createElement('small');
    meta.textContent = librarySummary(library);
    button.append(title, meta);
    button.addEventListener('click', () => {
      state.selectedLibraryId = library.id;
      render();
    });
    elements.libraryList.append(button);
  }
}

function renderWords(library) {
  elements.wordList.replaceChildren();
  if (!library.words.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    const title = document.createElement('h2');
    title.textContent = '这个词库还是空的';
    const copy = document.createElement('p');
    copy.textContent = '从第一个容易卡壳的词开始。';
    empty.append(title, copy);
    elements.wordList.append(empty);
    return;
  }
  for (const word of library.words) {
    const row = document.createElement('div');
    row.className = 'word-item';
    const copy = document.createElement('div');
    const text = document.createElement('strong');
    text.textContent = word.text;
    const hint = document.createElement('small');
    hint.textContent = word.hint || '无提示';
    copy.append(text, hint);
    const language = document.createElement('span');
    language.className = 'language-tag';
    language.textContent = word.language === 'auto' ? 'AUTO' : word.language;
    const remove = document.createElement('button');
    remove.className = 'icon-button';
    remove.type = 'button';
    remove.textContent = '移除';
    remove.setAttribute('aria-label', `移除词条 ${word.text}`);
    remove.addEventListener('click', () => deleteWord(library.id, word.id));
    row.append(copy, language, remove);
    elements.wordList.append(row);
  }
}

function renderEditor() {
  const library = selectedLibrary();
  elements.emptyLibrary.hidden = Boolean(library);
  elements.editorContent.hidden = !library;
  if (!library) return;
  elements.editorTitle.textContent = library.name;
  elements.libraryMeta.textContent = librarySummary(library).toUpperCase();
  elements.editLibraryName.value = library.name;
  elements.editLibraryMinutes.value = library.countdownSeconds
    ? String(library.countdownSeconds / 60)
    : '';
  const isDefault = library.id === state.defaultLibraryId;
  elements.defaultButton.disabled = isDefault;
  elements.defaultButton.textContent = isDefault ? '当前默认词库' : '设为默认词库';
  renderWords(library);
}

function render() {
  renderLibraryList();
  renderEditor();
}

async function loadLibraries({ preserveSelection = true } = {}) {
  const data = await api('/api/libraries');
  state.libraries = data.libraries;
  state.defaultLibraryId = data.defaultLibraryId;
  if (!preserveSelection || !state.libraries.some((item) => item.id === state.selectedLibraryId)) {
    state.selectedLibraryId = state.defaultLibraryId || state.libraries[0]?.id || null;
  }
  render();
}

async function deleteWord(libraryId, wordId) {
  try {
    await api(`/api/libraries/${libraryId}/words/${wordId}`, { method: 'DELETE' });
    await loadLibraries();
    showStatus('词条已移除。');
  } catch (error) {
    showStatus(errorMessage(error), 'error');
  }
}

elements.pairingCode.addEventListener('input', () => {
  elements.pairingCode.value = elements.pairingCode.value.replace(/\D/g, '').slice(0, 4);
});

elements.pairingForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!/^\d{4}$/.test(elements.pairingCode.value)) {
    showStatus('请输入完整的四位数字配对码。', 'error');
    return;
  }
  try {
    await api('/api/auth/pairing-code', { method: 'POST', body: { code: elements.pairingCode.value } });
    const me = await api('/api/me');
    setAuthenticated(me.user);
    await loadLibraries({ preserveSelection: false });
    showStatus('配对成功，现在可以准备自己的词库。');
  } catch (error) {
    showStatus(errorMessage(error), 'error');
  }
});

elements.logoutButton.addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' }).catch(() => {});
  setLoggedOut();
});

elements.timerEnabled.addEventListener('change', () => {
  elements.timerField.hidden = !elements.timerEnabled.checked;
});

elements.createLibraryForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(elements.createLibraryForm);
  const minutes = Number(document.querySelector('#library-minutes').value || 5);
  try {
    const data = await api('/api/libraries', {
      method: 'POST',
      body: {
        name: form.get('name'),
        countdownSeconds: elements.timerEnabled.checked ? minutes * 60 : null,
      },
    });
    state.selectedLibraryId = data.library.id;
    elements.createLibraryForm.reset();
    elements.timerField.hidden = true;
    await loadLibraries();
    showStatus('词库已创建，接着添加第一个词条。');
  } catch (error) {
    showStatus(errorMessage(error), 'error');
  }
});

elements.librarySettingsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const library = selectedLibrary();
  if (!library) return;
  const minutes = elements.editLibraryMinutes.value.trim();
  try {
    await api(`/api/libraries/${library.id}`, {
      method: 'PATCH',
      body: {
        name: elements.editLibraryName.value,
        countdownSeconds: minutes ? Number(minutes) * 60 : null,
      },
    });
    await loadLibraries();
    showStatus('词库设置已保存。');
  } catch (error) {
    showStatus(errorMessage(error), 'error');
  }
});

elements.defaultButton.addEventListener('click', async () => {
  const library = selectedLibrary();
  if (!library) return;
  try {
    await api(`/api/libraries/${library.id}/default`, { method: 'POST' });
    await loadLibraries();
    showStatus('默认词库已更新，请在眼镜菜单选择“刷新词库”。');
  } catch (error) {
    showStatus(errorMessage(error), 'error');
  }
});

elements.deleteLibraryButton.addEventListener('click', async () => {
  const library = selectedLibrary();
  if (!library || !window.confirm(`删除词库“${library.name}”？`)) return;
  try {
    await api(`/api/libraries/${library.id}`, { method: 'DELETE' });
    state.selectedLibraryId = null;
    await loadLibraries({ preserveSelection: false });
    showStatus('词库已删除。');
  } catch (error) {
    showStatus(errorMessage(error), 'error');
  }
});

elements.wordLanguage.addEventListener('change', () => {
  elements.customLanguageField.hidden = elements.wordLanguage.value !== 'custom';
  if (elements.customLanguageField.hidden) elements.customLanguage.value = '';
});

elements.wordForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const library = selectedLibrary();
  if (!library) return;
  const language = elements.wordLanguage.value === 'custom'
    ? elements.customLanguage.value.trim()
    : elements.wordLanguage.value;
  if (elements.wordLanguage.value !== 'custom' && !COMMON_LANGUAGES.includes(language)) return;
  try {
    await api(`/api/libraries/${library.id}/words`, {
      method: 'POST',
      body: {
        text: document.querySelector('#word-text').value,
        hint: document.querySelector('#word-hint').value,
        language,
      },
    });
    elements.wordForm.reset();
    elements.customLanguageField.hidden = true;
    await loadLibraries();
    showStatus('词条已加入当前词库。');
  } catch (error) {
    showStatus(errorMessage(error), 'error');
  }
});

async function boot() {
  try {
    const me = await api('/api/me');
    setAuthenticated(me.user);
    await loadLibraries({ preserveSelection: false });
  } catch (error) {
    if (error.status === 401) setLoggedOut();
    else showStatus(errorMessage(error), 'error');
  }
}

boot();
