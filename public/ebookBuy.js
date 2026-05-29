// External script for ebookBuy page: greeting + delayed Buy button
(function(){
  function init(){
    try{
      console.log('[ebookBuy] init');
    }catch(e){/* ignore */}
    // Mark when the visitor landed on this page (ms since epoch)
    window.__ebookPageEnterAt = window.__ebookPageEnterAt || Date.now();

    // Start server-side session for timing (only for ebookBuy page). We no longer
    // send heartbeats from the client; the server will only receive explicit events
    // (subscribe and payment) to update contacts.
    (async function startSession(){
      try{
        await fetch('/api/start', { method: 'POST', credentials: 'include' });
      }catch(e){ console.warn('[ebookBuy] startSession failed', e); }
    })();

    const params = new URLSearchParams(window.location.search);
    const name = params.get('name') || params.get('full') || '';
    const email = params.get('email') || '';
    const greeting = document.getElementById('greeting');
    if(greeting){
      if (name) greeting.textContent = `Hi ${name.split(' ')[0]}, welcome to...`;
      else greeting.textContent = `Hi, welcome to...`;
    }

    const buyButton = document.getElementById('buyNow');
    if(!buyButton) return;

    // Wire alternate payment UI
    const cryptoToggle = document.getElementById('cryptoToggle');
    const cryptoDropdown = document.getElementById('cryptoDropdown');
    const otherPay = document.getElementById('otherPay');
    const modalOverlay = document.getElementById('modalOverlay');
    const modalContent = document.getElementById('modalContent');
    const modalClose = document.getElementById('modalClose');

    function showModal(html) {
      if (!modalOverlay) return;
      modalContent.innerHTML = html;
      modalOverlay.style.display = 'flex';
      document.body.style.overflow = 'hidden';
      // Wire copy-to-clipboard buttons and confirm payment buttons inside modal
      setupModalButtons();
    }
    function closeModal(){
      if(!modalOverlay) return;
      modalOverlay.style.display = 'none';
      document.body.style.overflow = '';
      modalContent.innerHTML = '';
    }

    // Setup modal buttons: copy-to-clipboard and confirm payment
    function setupModalButtons(){
      try{
        // Setup copy buttons
        const copyButtons = modalContent.querySelectorAll('.copy-addr');
        copyButtons.forEach(btn=>{
          // avoid attaching multiple times
          if(btn.__copyBound) return;
          btn.__copyBound = true;
          btn.addEventListener('click', async (e)=>{
            const addr = btn.getAttribute('data-addr');
            if(!addr) return;
            try{
              await navigator.clipboard.writeText(addr);
              showCopyToast('Copied to clipboard');
            }catch(err){
              // fallback: select and execCommand
              try{
                const ta = document.createElement('textarea'); ta.value = addr; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
                showCopyToast('Copied to clipboard');
              }catch(e){
                alert('Copy failed — please select and copy the address manually.');
              }
            }
          });
        });

        // Setup confirm payment buttons
        const confirmButtons = modalContent.querySelectorAll('.confirm-payment-btn');
        confirmButtons.forEach(btn=>{
          // avoid attaching multiple times
          if(btn.__confirmBound) return;
          btn.__confirmBound = true;
          btn.addEventListener('click', async (e)=>{
            e.preventDefault();
            
            const paymentMethod = btn.getAttribute('data-payment-method');
            const originalText = btn.textContent;
            
            // Update button state
            btn.disabled = true;
            btn.textContent = 'Confirming...';
            
            try {
              // Send request with just the payment method - server will get user details from signupId cookie
              const resp = await fetch('/api/confirm-unconfirmed-payment', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                  paymentMethod: paymentMethod 
                })
              });
              
              const result = await resp.json();
              
              if (!resp.ok) {
                throw new Error(result.error || 'Failed to confirm payment');
              }
              
              // Success
              btn.textContent = 'Confirmed ✓';
              btn.style.background = '#10b981';
              btn.style.color = '#fff';
              showCopyToast('Payment confirmation submitted successfully!');
              
              // Redirect to confirmation page after a brief delay
              setTimeout(() => {
                closeModal();
                // Redirect with payment method parameter
                const redirectUrl = `paymentConfirmation.html?method=${encodeURIComponent(paymentMethod)}`;
                window.location.href = redirectUrl;
              }, 1500);
              
            } catch (err) {
              console.error('Error confirming payment:', err);
              alert('Failed to confirm payment: ' + (err.message || 'Please try again'));
              
              // Reset button state
              btn.disabled = false;
              btn.textContent = originalText;
            }
          });
        });
      }catch(e){
        console.warn('setupModalButtons error:', e);
      }
    }

    // Toast helper
    function showCopyToast(text){
      let t = document.getElementById('copy-toast');
      if(!t){
        t = document.createElement('div'); t.id = 'copy-toast'; t.className = 'copy-toast'; t.textContent = text || 'Copied'; document.body.appendChild(t);
      }
      t.textContent = text || 'Copied';
      // trigger show
      requestAnimationFrame(()=> t.classList.add('show'));
      // hide after 2s
      clearTimeout(t._hideTimer);
      t._hideTimer = setTimeout(()=>{ t.classList.remove('show'); }, 2000);
    }

    if (cryptoToggle && cryptoDropdown) {
      cryptoToggle.addEventListener('click', (e)=>{
        e.stopPropagation();
        cryptoDropdown.style.display = cryptoDropdown.style.display === 'block' ? 'none' : 'block';
      });
      // Close dropdown when clicking elsewhere
      document.addEventListener('click', ()=>{ if(cryptoDropdown) cryptoDropdown.style.display = 'none'; });
      // Wire each crypto option
      document.querySelectorAll('.crypto-option').forEach(btn=>{
        btn.addEventListener('click', (ev)=>{
          ev.preventDefault();
          const token = btn.getAttribute('data-token');
          let html = '';
          if(token === 'USDT.TRON'){
            html = `
              <div class="modal-header">
                <img src="/tether-usdt-logo.svg" alt="USDT" />
                <div>
                  <h3>USDT (TRON)</h3>
                  <div style="font-size:13px;color:#6b6b6b">TRC20 — Low fees</div>
                </div>
              </div>
              <div class="modal-address"><div class="addr">TXTRONWALLETADDRESS12345</div><button class="copy-addr" data-addr="TXTRONWALLETADDRESS12345">Copy</button></div>
              <div class="modal-instructions"><p><span class="network">Network: TRON (TRC-20).</span> Send only USDT via TRON network to this address to make payment. After payment, send a screenshot [...]
              <div class="modal-confirm-section">
                <button class="confirm-payment-btn" data-payment-method="USDT.TRON">Confirm Payment</button>
                <p style="font-size:13px;color:#666;margin-top:8px;">Click this after you've sent the payment to notify us.</p>
              </div>
            `;
          } else if(token === 'USDT.ETH'){
            html = `
              <div class="modal-header">
                <img src="/tether-usdt-logo.svg" alt="USDT" />
                <div>
                  <h3>USDT (Ethereum)</h3>
                  <div style="font-size:13px;color:#6b6b6b">ERC20 — Standard network</div>
                </div>
              </div>
              <div class="modal-address"><div class="addr">0xETHWALLETADDRESSABCDE</div><button class="copy-addr" data-addr="0xETHWALLETADDRESSABCDE">Copy</button></div>
              <div class="modal-instructions"><p><span class="network">Network: Ethereum (ERC-20).</span> Send only USDT via Ethereum (ERC20) network to this address to make payment. After paymen[...]
              <div class="modal-confirm-section">
                <button class="confirm-payment-btn" data-payment-method="USDT.ETH">Confirm Payment</button>
                <p style="font-size:13px;color:#666;margin-top:8px;">Click this after you've sent the payment to notify us.</p>
              </div>
            `;
          } else if(token === 'USDC.SOL'){
            html = `
              <div class="modal-header">
                <img src="/usd-coin-usdc-logo.svg" alt="USDC" />
                <div>
                  <h3>USDC (Solana)</h3>
                  <div style="font-size:13px;color:#6b6b6b">SPL — Fast settlement</div>
                </div>
              </div>
              <div class="modal-address"><div class="addr">SOLWALLETADDRESSXYZ</div><button class="copy-addr" data-addr="SOLWALLETADDRESSXYZ">Copy</button></div>
              <div class="modal-instructions"><p><span class="network">Network: Solana.</span> Send only USDC via Solana (SPL) network to this address to make payment. After payment, send a scree[...]
              <div class="modal-confirm-section">
                <button class="confirm-payment-btn" data-payment-method="USDC.SOL">Confirm Payment</button>
                <p style="font-size:13px;color:#666;margin-top:8px;">Click this after you've sent the payment to notify us.</p>
              </div>
            `;
          }
          html += `<div class="modal-footer">If you need assistance, contact support@example.com</div>`;
          showModal(html);
          cryptoDropdown.style.display = 'none';
        });
      });
    }

    if (otherPay) {
      otherPay.addEventListener('click',(e)=>{
        e.preventDefault();
        const html = `<h3>Other Payment Methods</h3>
          <p>You can pay using PayPal, Wise, Payoneer, Deel, or bank transfer. Use the details below and include your email as reference.</p>
          <div style="margin:12px 0;padding:12px;background:#f7fafc;border-radius:8px;">
            <strong>US Checking Account (Business)</strong><br>
            Bank: Example Bank<br>
            Account name: Example Ltd<br>
            Account number: 0123456789<br>
            Routing (ACH): 111000025
          </div>
          <div style="margin-top:8px;padding:12px;background:#fff;border-radius:8px;border:1px solid #eee;font-size:13px;color:#444">PayPal: payments@example.com<br>Wise: business@example.com<br>[...]
          <p style="margin-top:10px;font-size:13px;color:#666">After payment, forward your receipt email to support@example.com with your order reference.</p>
          <div class="modal-confirm-section">
            <button class="confirm-payment-btn" data-payment-method="Other">Confirm Payment</button>
            <p style="font-size:13px;color:#666;margin-top:8px;">Click this after you've sent the payment to notify us.</p>
          </div>`;
        showModal(html);
      });
    }

    if (modalClose) modalClose.addEventListener('click', closeModal);
    if (modalOverlay) modalOverlay.addEventListener('click', (e)=>{ if(e.target === modalOverlay) closeModal(); });

    // Upsell Modal Logic
    const upsellModal = document.getElementById('upsellModal');
    const upsellCheckboxes = document.querySelectorAll('.upsell-checkbox');
    const orderTotalEl = document.getElementById('orderTotal');
    const btnTotalEl = document.getElementById('btnTotal');
    const upsellSummaryItems = document.getElementById('upsellSummaryItems');
    const proceedBtn = document.getElementById('proceedToVSL');
    const backToStep1 = document.getElementById('backToStep1');

    let selectedUpsells = [];
    const basePrice = 25000;
    
    // Handle back to step 1 link
    if(backToStep1){
      backToStep1.addEventListener('click', () => {
        hideUpsellModal();
      });
    }

    function updateOrderSummary(){
      let total = basePrice;
      let summaryHTML = '';
      
      // Update base price display
      const basePriceDisplay = document.getElementById('basePriceDisplay');
      if(basePriceDisplay) basePriceDisplay.textContent = `₦${basePrice.toLocaleString('en-NG', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
      
      selectedUpsells.forEach(upsell => {
        total += parseFloat(upsell.price);
        summaryHTML += `
          <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:14px;color:#666">
            <span>${upsell.name}</span>
            <span style="font-weight:600">₦${parseFloat(upsell.price).toLocaleString('en-NG', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
          </div>
        `;
      });
      
      if(upsellSummaryItems) upsellSummaryItems.innerHTML = summaryHTML;
      if(orderTotalEl) orderTotalEl.textContent = `₦${total.toLocaleString('en-NG', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
      if(btnTotalEl) btnTotalEl.textContent = `₦${total.toLocaleString('en-NG', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
  }

    // Handle checkbox changes
    upsellCheckboxes.forEach(checkbox => {
      checkbox.addEventListener('change', (e) => {
        const card = e.target.closest('.upsell-card');
        const upsellId = e.target.getAttribute('data-upsell-id');
        const price = parseFloat(card.getAttribute('data-price'));
        
        if(e.target.checked){
          card.classList.add('selected');
          let upsellName = '';
          if(upsellId === '1'){
            upsellName = '3-Month AI Trading Bot Mentorship';
          } else if(upsellId === '2'){
            upsellName = '1-on-1 AI Trading Coaching';
          }
          selectedUpsells.push({ id: upsellId, name: upsellName, price: price });
        } else {
          card.classList.remove('selected');
          selectedUpsells = selectedUpsells.filter(u => u.id !== upsellId);
        }
        
        updateOrderSummary();
      });
    });

    // Make cards clickable - rely on native label behavior
    document.querySelectorAll('.upsell-card').forEach(card => {
      const checkbox = card.querySelector('.upsell-checkbox');
      const label = card.querySelector('label');
      
      if(label) {
        label.addEventListener('click', (e) => {
          // Prevent double-toggle
          if(e.target === checkbox) return;
          e.preventDefault();
          checkbox.checked = !checkbox.checked;
          checkbox.dispatchEvent(new Event('change'));
        });
      }
    });

    function showUpsellModal(){
      if(upsellModal){
        upsellModal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
      }
    }

    function hideUpsellModal(){
      if(upsellModal){
        upsellModal.style.display = 'none';
        document.body.style.overflow = '';
      }
    }

    // Proceed to VSL button handler
    if(proceedBtn){
      proceedBtn.addEventListener('click', () => {
        // Save order data to sessionStorage
        const phoneInput = document.querySelector('#phone');
        const phone = phoneInput ? phoneInput.value : '';
        
        // Track which upsells were selected (use IDs for easier backend processing)
        const upsellsSelected = [];
        selectedUpsells.forEach(upsell => {
          if(upsell.id === '1') upsellsSelected.push('mentorship');
          else if(upsell.id === '2') upsellsSelected.push('coaching');
        });
        
        const orderData = {
          name: name,
          email: email,
          phone: phone,
          basePrice: basePrice,
          upsells: selectedUpsells,
          upsellsSelected: upsellsSelected, // Array of upsell IDs
          countdownStartTime: window.__ebookCountdownStartTime, // Include countdown start time
          countdownDurationMinutes: window.__ebookCountdownDurationMinutes // Include countdown duration
        };
        
        sessionStorage.setItem('orderData', JSON.stringify(orderData));
        
        // Redirect to VSL upsell page with params
        const urlParams = new URLSearchParams({
          name: name,
          email: email,
          phone: phone
        });
        window.location.href = `upsell-vsl.html?${urlParams.toString()}`;
      });
    }

    buyButton.addEventListener('click', async ()=>{
      // Collect any extra fields you want to send (phone/amount can be collected earlier)
      const phoneInput = document.querySelector('#phone');
      const phone = phoneInput ? phoneInput.value : '';

      // Simple client-side validation
      if(!name || !email){
        alert('Name and email required');
        return;
      }

      // Show upsell modal instead of going directly to payment
      showUpsellModal();
      
      /* Original payment code - now handled through VSL page
      try{
        // Send a minimal payment-initiate request. The server will read the httpOnly
        // signupId cookie (if present) to correlate the session and compute timings
        // server-side. Include credentials so cookies are sent when backend is on a
        // different origin. throttling
        // Compute whether the client-side countdown has the buyer inside the offer window
        const boughtWithinOfferWindow = (typeof window.__ebookOfferDeadline === 'number')
          ? (Date.now() <= Number(window.__ebookOfferDeadline))
          : false;

        const resp = await fetch('/api/initiate-payment', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, phone, amount, boughtWithinOfferWindow })
        });

        const data = await resp.json();
        if(!resp.ok) throw new Error(data.error || JSON.stringify(data));

        // Redirect user to Paystack checkout
        if(data.authorization_url){
          window.location.href = data.authorization_url;
        } else {
          alert('Payment initialization failed. Please try again.');
        }
      } catch(err){
        console.error('Payment init error', err);
        alert('Unable to start payment: '+(err.message||err));
      }
      */
    });

    // Show the Buy Now button after a configurable reveal delay (in minutes)
  const minutesDelay = 31.36; // change this value to control when the buy area appears
    const ms = minutesDelay * 60 * 1000;

    // debug badge removed - no on-page debug element in production

    // Expiry length for the offer countdown (in minutes). Adjust as needed.
    const expiryMinutes = 24; //30; // default 30 minutes (change to 60 for 60 minutes)

    // Make sure button and related texts appear after reveal timeout
    // Defensive: if ms is not a finite number, fall back to 30000ms
    const scheduleMs = (Number.isFinite(ms) && ms > 0) ? ms : 30000;
    console.log('[ebookBuy] scheduling reveal in ms=', scheduleMs);
    setTimeout(()=>{
      try{ console.log('[ebookBuy] reveal executed'); }catch(e){}
      const purchaseArea = document.getElementById('purchaseArea');
      const offer = document.getElementById('offerText');
      const secure = document.getElementById('secureMeta');
      const whatYouGet = document.getElementById('whatYouGet');
      const countdownTimer = document.getElementById('countdownTimer');

      if(purchaseArea) {
        purchaseArea.style.display = '';
        // add entrance animation class
        purchaseArea.classList.add('purchase-enter');
        // remove the class after animation completes to keep DOM clean
        purchaseArea.addEventListener('animationend', function handler(){
          purchaseArea.classList.remove('purchase-enter');
          purchaseArea.removeEventListener('animationend', handler);
        });
      }
      if(offer) offer.style.display = '';
      if(secure) secure.style.display = '';
      if(whatYouGet) whatYouGet.style.display = '';
      if(buyButton) buyButton.style.display = '';
      if(countdownTimer) countdownTimer.style.display = '';

  // debug badge removed - nothing to update here

  // start countdown (expiryMinutes -> milliseconds)
  const expiryMs = expiryMinutes * 60 * 1000;
  const countdownStartTime = Date.now(); // Track when countdown started
  const endTime = countdownStartTime + expiryMs;

  // store global timing so click handler can include these values
  window.__ebookPageEnterAt = window.__ebookPageEnterAt || Date.now() - (ms + 200); // approximate if not set
  window.__ebookRevealAt = Date.now();
  window.__ebookOfferDeadline = endTime;
  window.__ebookCountdownStartTime = countdownStartTime; // Store countdown start time
  window.__ebookCountdownDurationMinutes = expiryMinutes; // Store countdown duration

      function formatTimeLeft(msLeft){
        if(msLeft < 0) return '00:00:00';
        const totalSec = Math.floor(msLeft/1000);
        const hours = Math.floor(totalSec/3600);
        const minutes = Math.floor((totalSec % 3600)/60);
        const seconds = totalSec % 60;
        return `${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}`;
      }

      // render immediately
      if(countdownTimer) countdownTimer.textContent = `Time left: ${formatTimeLeft(endTime - Date.now())}`;

      const intervalId = setInterval(()=>{
        const left = endTime - Date.now();
        if(countdownTimer) countdownTimer.textContent = `Time left: ${formatTimeLeft(left)}`;
        if(left <= 0){
          clearInterval(intervalId);
          // mark offer expired visually but don't prevent purchases; purchases after expiry
          // simply won't be flagged as bonus-eligible (we'll compute that server-side too)
          const offerExpired = document.getElementById('offerExpired');
          if(offerExpired) offerExpired.style.display = '';
        }
      }, 500);

    }, ms+200);

    // Heartbeat removed — it previously caused Appwrite validation noise and duplicate
    // Zoho risk. Server-side will rely on /api/subscribe and payment events only.

    // We previously polled for eligibility; that behavior has been removed to avoid
    // repeated server-side Zoho calls. Keep the UI simple and rely on server-side
    // subscribe and payment events to notify Zoho instead.
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
