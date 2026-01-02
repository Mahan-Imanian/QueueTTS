import { create } from './dom.js';

const stateLabels = {
  queued: 'Queued',
  extracting: 'Extracting',
  needs_paste: 'Needs paste',
  ready: 'Ready',
  playing: 'Playing',
  paused: 'Paused',
  finished: 'Finished',
  error: 'Error',
};

export const renderQueue = ({ container, queue, currentId, onAction, onPaste }) => {
  container.innerHTML = '';
  queue.forEach((item, index) => {
    const row = create('div', { className: 'queue-item' });
    row.setAttribute('draggable', 'true');
    row.dataset.id = item.id;
    row.dataset.index = index;

    const handle = create('div', { className: 'queue-item__handle', text: '⋮⋮' });
    const content = create('div');
    const title = create('div', { className: 'queue-item__title', text: item.title || item.url || 'Untitled' });
    const meta = create('div', { className: 'queue-item__meta', text: item.url || item.sourceType.toUpperCase() });
    const status = create('div', { className: 'queue-item__status' });
    status.dataset.state = item.state;
    status.innerHTML = `<span></span>${stateLabels[item.state] || item.state}`;
    content.append(title, meta, status);

    if (item.error && item.state === 'error') {
      const error = create('div', { className: 'queue-item__meta', text: item.error });
      content.append(error);
    }

    if (item.state === 'extracting') {
      const skeleton = create('div', { className: 'queue-item__extra' });
      skeleton.innerHTML = '<div class="skeleton"></div><div class="skeleton" style="width:80%; margin-top:8px;"></div>';
      content.append(skeleton);
    }

    if (item.state === 'needs_paste') {
      if (item.notice) {
        const notice = create('div', { className: 'queue-item__notice', text: item.notice });
        const noticeActions = create('div', { className: 'queue-item__notice-actions' });
        const copy = create('button', { className: 'button button--ghost', text: 'Copy instructions' });
        copy.addEventListener('click', () => {
          navigator.clipboard?.writeText('QueueTTS bookmarklet: drag “QueueTTS: Import Page” to your bookmarks bar, then click it on the article page. Or paste the text below.');
        });
        noticeActions.append(copy);
        notice.append(noticeActions);
        content.append(notice);
      }
      const paste = create('div', { className: 'paste-panel' });
      const textarea = create('textarea');
      textarea.placeholder = 'Paste extracted text here...';
      const button = create('button', { className: 'button', text: 'Use pasted text' });
      button.addEventListener('click', () => onPaste(item.id, textarea.value));
      paste.append(textarea, button);
      content.append(paste);
    }

    const actions = create('div', { className: 'queue-item__actions' });
    const play = create('button', { className: 'button button--ghost', text: item.id === currentId ? 'Current' : 'Play' });
    play.disabled = item.state === 'extracting' || item.state === 'needs_paste';
    play.addEventListener('click', () => onAction('play', item.id));
    const remove = create('button', { className: 'button button--ghost', text: 'Remove' });
    remove.addEventListener('click', () => onAction('remove', item.id));
    actions.append(play, remove);

    row.append(handle, content, actions);
    container.append(row);
  });
};

export const renderUpNext = ({ container, queue, currentIndex }) => {
  container.innerHTML = '';
  const nextItems = queue.slice(currentIndex + 1, currentIndex + 3);
  if (!nextItems.length) {
    container.innerHTML = '<li>Nothing queued</li>';
    return;
  }
  nextItems.forEach((item) => {
    const li = create('li', { text: item.title || item.url || 'Untitled' });
    container.appendChild(li);
  });
};
