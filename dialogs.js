// Native dialog supplies focus containment; add scroll lock, focus return and Back.
const wired = new WeakSet(), stack=[];
export function openDialog(dialog, initialFocus) {
  if (dialog.open) return;
  const trigger = document.activeElement;
  if (!wired.has(dialog)) {
    wired.add(dialog);
    dialog.addEventListener('click', event => {
      if (event.target === dialog) {
        const rect = dialog.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
      }
    });
    dialog.querySelectorAll('[data-close-dialog]').forEach(button => button.addEventListener('click', () => dialog.close()));
  }
  let back = false;
  const onBack = () => { if(stack.at(-1)===dialog&&history.state?.weatherDialog!==dialog.id){back=true;if(dialog.open)dialog.close();} };
  window.addEventListener('popstate', onBack);
  dialog.addEventListener('close', () => {
    window.removeEventListener('popstate', onBack);
    const index=stack.indexOf(dialog);if(index>=0)stack.splice(index,1);
    document.body.classList.toggle('modal-open',stack.length>0);
    if (!back && history.state?.weatherDialog === dialog.id) history.back();
    if (trigger?.isConnected) trigger.focus({ preventScroll: true });
  }, { once: true });
  history.pushState({ ...history.state, weatherDialog: dialog.id }, '', location.href);
  stack.push(dialog);document.body.classList.add('modal-open'); dialog.showModal();
  (initialFocus ?? dialog.querySelector('button, input, select'))?.focus({ preventScroll: true });
}
