// Модальное окно на <dialog>: Esc и клик по фону закрывают, фокус остаётся внутри
export interface Modal {
  el: HTMLDialogElement;
  close: () => void;
}

export function openModal(html: string, onClose?: () => void): Modal {
  const el = document.createElement('dialog');
  el.className = 'modal';
  el.innerHTML = html;
  document.body.append(el);
  // Убираем окно сразу, не дожидаясь события close: в фоновой вкладке оно запаздывает
  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    el.remove();
    onClose?.();
  };
  const close = () => {
    if (el.open) el.close();
    cleanup();
  };
  el.addEventListener('close', cleanup);
  // Клик по затемнению (вне содержимого) закрывает окно
  el.addEventListener('mousedown', (e) => {
    if (e.target === el) close();
  });
  el.showModal();
  return { el, close };
}
