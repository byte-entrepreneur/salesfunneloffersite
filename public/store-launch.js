(() => {
  const checkoutModal = document.getElementById('checkoutModal');
  const briefingModal = document.getElementById('briefingModal');
  const modalDiy = document.getElementById('modalDiy');
  const modalDfy = document.getElementById('modalDfy');
  const modalSuccess = document.getElementById('modalSuccess');
  const diyStatus = document.getElementById('diyStatus');
  const dfyStatus = document.getElementById('dfyStatus');

  const show = (el) => {
    if (!el) return;
    el.hidden = false;
    el.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
  };

  const hide = (el) => {
    if (!el) return;
    el.hidden = true;
    el.setAttribute('aria-hidden', 'true');
    if (document.querySelectorAll('.modal:not([hidden])').length === 0) document.body.classList.remove('modal-open');
  };

  const openCheckout = (mode = 'diy') => {
    hide(briefingModal);
    modalDiy.hidden = mode !== 'diy';
    modalDfy.hidden = mode !== 'dfy';
    modalSuccess.hidden = true;
    if (diyStatus) diyStatus.textContent = '';
    if (dfyStatus) dfyStatus.textContent = '';
    show(checkoutModal);
    const firstInput = (mode === 'diy' ? modalDiy : modalDfy).querySelector('input');
    window.setTimeout(() => firstInput?.focus(), 50);
  };

  document.querySelectorAll('[data-open-offer], [data-buy-diy]').forEach((button) => {
    button.addEventListener('click', () => openCheckout('diy'));
  });
  document.querySelectorAll('[data-apply-dfy]').forEach((button) => {
    button.addEventListener('click', () => openCheckout('dfy'));
  });
  document.getElementById('videoTrigger')?.addEventListener('click', () => show(briefingModal));
  document.querySelectorAll('[data-close-modal]').forEach((button) => button.addEventListener('click', () => hide(checkoutModal)));
  document.querySelectorAll('[data-close-briefing]').forEach((button) => button.addEventListener('click', () => hide(briefingModal)));
  [checkoutModal, briefingModal].forEach((modal) => modal?.addEventListener('click', (event) => {
    if (event.target === modal) hide(modal);
  }));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      hide(checkoutModal);
      hide(briefingModal);
    }
  });

  const jsonPost = async (url, body) => {
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || data.message || 'Something went wrong. Please try again.');
    return data;
  };

  document.getElementById('diyCheckoutForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('button[type="submit"]');
    const payload = Object.fromEntries(new FormData(form).entries());
    diyStatus.textContent = 'Preparing secure checkout…';
    submit.disabled = true;
    try {
      const data = await jsonPost('/api/initiate-payment', {
        ...payload,
        amount: 20000,
        paymentMode: 'paystack',
        orderData: { product: '100m_online_stores', offer: 'diy', amount: 20000, source: 'storelaunch_explainer' },
      });
      if (!data.authorization_url) throw new Error('Checkout link was not returned.');
      modalDiy.hidden = true;
      modalSuccess.hidden = false;
      document.getElementById('successCopy').textContent = 'Redirecting you to Paystack to complete your ₦20,000 payment…';
      window.location.assign(data.authorization_url);
    } catch (error) {
      diyStatus.textContent = error.message;
      submit.disabled = false;
    }
  });

  document.getElementById('dfyForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('button[type="submit"]');
    const payload = Object.fromEntries(new FormData(form).entries());
    dfyStatus.textContent = 'Sending your request…';
    submit.disabled = true;
    try {
      await jsonPost('/api/subscribe', { ...payload, pageEnterAt: Date.now(), offer: 'dfy', product: '100m_online_stores' });
      modalDfy.hidden = true;
      modalSuccess.hidden = false;
      document.getElementById('successCopy').textContent = 'Request received. We will contact you on WhatsApp or email to confirm fit and timing.';
    } catch (error) {
      dfyStatus.textContent = error.message;
      submit.disabled = false;
    }
  });
})();
