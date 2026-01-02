const DEFAULT_TIMEOUT = 5000;

export const showToast = (container, { message, variant = 'info', timeout = DEFAULT_TIMEOUT }) => {
  const toast = document.createElement('div');
  toast.className = `toast ${variant}`;
  const text = document.createElement('div');
  text.textContent = message;
  const close = document.createElement('button');
  close.textContent = '×';
  close.addEventListener('click', () => toast.remove());
  toast.append(text, close);

  let timer = null;
  const startTimer = () => {
    if (timeout) {
      timer = window.setTimeout(() => toast.remove(), timeout);
    }
  };
  const stopTimer = () => {
    if (timer) {
      window.clearTimeout(timer);
      timer = null;
    }
  };

  toast.addEventListener('mouseenter', stopTimer);
  toast.addEventListener('mouseleave', startTimer);

  container.appendChild(toast);
  startTimer();

  return toast;
};
