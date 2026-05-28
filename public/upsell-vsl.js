// VSL Upsell Page Logic
(function(){
  // Timer configuration (in minutes)
  const OFFER_TIMER_MINUTES = 10; // 10 minutes
  let currentPrice = 700000;
  let offerExpired = false;

  function init(){
    console.log('[upsell-vsl] init');
    
    // Get order data from sessionStorage
    const orderData = sessionStorage.getItem('orderData');
    if(!orderData){
      console.warn('[upsell-vsl] No order data found');
      // Redirect to home if no order data
      window.location.href = '/';
      return;
    }

    const order = JSON.parse(orderData);
    console.log('[upsell-vsl] Order data:', order);

    // Clear old deadline and start fresh timer
    sessionStorage.removeItem('vslOfferDeadline');
    
    // Start countdown timer BEFORE setting up buttons
    startCountdownTimer();

    const acceptBtn = document.getElementById('acceptUpsell');
    const declineLink = document.getElementById('declineUpsell');

    if(acceptBtn){
      acceptBtn.addEventListener('click', async ()=>{
        try {
          // Add VSL upsell to order with current price
          order.vslUpsell = {
            name: 'Altra Forex Gladiator Bot',
            price: currentPrice
          };
          
          // Track YouTube ads in upsellsSelected array
          if(!order.upsellsSelected) order.upsellsSelected = [];
          if(!order.upsellsSelected.includes('forexbot')){
            order.upsellsSelected.push('forexbot');
          }
          
          // Calculate total
          const total = calculateTotal(order);
          
          // Save updated order
          sessionStorage.setItem('orderData', JSON.stringify(order));
          
          // Initiate payment with Paystack inline modal
          await initiatePaymentInline(order, total);
          
        } catch(err){
          console.error('[upsell-vsl] Error:', err);
          alert('Unable to process. Please try again.');
        }
      });
    }

    if(declineLink){
      declineLink.addEventListener('click', async ()=>{
        try {
          // Remove VSL upsell from order if it was added but not paid for
          delete order.vslUpsell;
          
          // Remove forexbot from upsellsSelected if present
          if(order.upsellsSelected){
            order.upsellsSelected = order.upsellsSelected.filter(u => u !== 'forexbot');
          }
          
          // Save updated order
          sessionStorage.setItem('orderData', JSON.stringify(order));
          
          // Calculate total without VSL upsell
          const total = calculateTotal(order);
          
          // Initiate payment with Paystack inline modal
          await initiatePaymentInline(order, total);
          
        } catch(err){
          console.error('[upsell-vsl] Error:', err);
          alert('Unable to process. Please try again.');
        }
      });
    }
  }

  function calculateTotal(order){
    let total = parseFloat(order.basePrice) || 49;
    
    // Add initial upsells if selected
    if(order.upsells && order.upsells.length > 0){
      order.upsells.forEach(upsell => {
        total += parseFloat(upsell.price) || 0;
      });
    }
    
    // Add VSL upsell if selected
    if(order.vslUpsell){
      total += parseFloat(order.vslUpsell.price) || 0;
    }
    
    return total;
  }

  async function initiatePaymentInline(order, amount){
    const params = new URLSearchParams(window.location.search);
    const name = params.get('name') || order.name || '';
    const email = params.get('email') || order.email || '';
    const phone = params.get('phone') || order.phone || '';

    try {
      // First, get the public key
      const publicKey = await getPaystackPublicKey();
      console.log('Paystack public key:', publicKey);
      
      if (!publicKey || !publicKey.startsWith('pk_')) {
        throw new Error('Invalid Paystack public key: ' + publicKey);
      }

      // Create the payment reference with backend
      const resp = await fetch('/api/initiate-payment', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          name, 
          email, 
          phone, 
          amount: amount,
          orderData: order,
          upsellsSelected: order.upsellsSelected || [], // Pass upsells array to backend
          countdownStartTime: order.countdownStartTime, // From ebookBuy.js countdown
          countdownDurationMinutes: order.countdownDurationMinutes // From ebookBuy.js countdown
        })
      });

      const data = await resp.json();
      if(!resp.ok) throw new Error(data.error || JSON.stringify(data));

      console.log('Payment reference:', data.reference);

      // Use Paystack inline popup instead of redirect
      const handler = PaystackPop.setup({
        key: publicKey,
        email: email,
        amount: Math.round(amount * 100), // amount in kobo
        reference: data.reference, // Use 'reference' not 'ref'
        metadata: {
          custom_fields: [
            {
              display_name: "Customer Name",
              variable_name: "customer_name",
              value: name
            }
          ]
        },
        onClose: function(){
          console.log('Payment modal closed');
          // If payment wasn't completed, remove VSL upsell from order
          const currentOrder = JSON.parse(sessionStorage.getItem('orderData') || '{}');
          if(currentOrder.vslUpsell){
            delete currentOrder.vslUpsell;
            if(currentOrder.upsellsSelected){
              currentOrder.upsellsSelected = currentOrder.upsellsSelected.filter(function(u) { return u !== 'youtube_ads'; });
            }
            sessionStorage.setItem('orderData', JSON.stringify(currentOrder));
            console.log('VSL upsell removed from order (payment not completed)');
          }
        },
        callback: function(response){
          console.log('Payment successful:', response);
          // Update the order with the actual Paystack reference (fire and forget)
          fetch('/api/update-order-reference', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              initReference: data.reference,
              actualReference: response.reference
            })
          }).catch(function(e) {
            console.warn('Failed to update order reference:', e);
          });
          // Redirect to thank you page
          window.location.href = '/thankyou-order.html?reference=' + response.reference;
        }
      });

      handler.openIframe();
      
    } catch(err){
      console.error('[upsell-vsl] Payment error:', err);
      alert('Unable to process payment. Please try again. Error: ' + err.message);
    }
  }

  async function getPaystackPublicKey(){
    // Fetch public key from backend endpoint
    try {
      const resp = await fetch('/api/paystack-public-key');
      if (!resp.ok) {
        console.error('Failed to fetch public key, status:', resp.status);
        throw new Error('Failed to fetch public key');
      }
      const data = await resp.json();
      console.log('Public key from server:', data.publicKey);
      return data.publicKey || 'pk_test_90ae6890399e691c1fba88b925408bc616dd381a';
    } catch(err) {
      console.error('Failed to fetch Paystack public key:', err);
      // Fallback to hardcoded test key
      return 'pk_test_90ae6890399e691c1fba88b925408bc616dd381a';
    }
  }

  function startCountdownTimer(){
    const timerDisplay = document.getElementById('timerDisplay');
    const specialPrice = document.getElementById('specialPrice');
    const expiredPrice = document.getElementById('expiredPrice');
    const expiredMessage = document.getElementById('expiredMessage');
    const acceptBtn = document.getElementById('acceptUpsell');

    if(!timerDisplay) return;

    // Check if we already have a deadline stored
    let deadline = sessionStorage.getItem('vslOfferDeadline');
    if(!deadline){
      // Set new deadline
      deadline = Date.now() + (OFFER_TIMER_MINUTES * 60 * 1000);
      sessionStorage.setItem('vslOfferDeadline', deadline);
    } else {
      deadline = Number(deadline);
    }

    function updateTimer(){
      const now = Date.now();
      const timeLeft = deadline - now;

      if(timeLeft <= 0){
        // Timer expired
        offerExpired = true;
        currentPrice = 1400000;
        timerDisplay.textContent = '00:00';
        
        // Update UI to show expired state
        if(specialPrice) specialPrice.style.display = 'none';
        if(expiredPrice) expiredPrice.style.display = 'block';
        if(expiredMessage) expiredMessage.style.display = 'block';
        
        // Update button text
        if(acceptBtn){
          acceptBtn.textContent = '✓ YES! ADD THIS TO MY ORDER FOR ₦1,400,000';
        }

        clearInterval(timerInterval);
        return;
      }

      // Calculate minutes and seconds
      const minutes = Math.floor(timeLeft / 60000);
      const seconds = Math.floor((timeLeft % 60000) / 1000);
      
      timerDisplay.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    // Update immediately
    updateTimer();

    // Update every second
    const timerInterval = setInterval(updateTimer, 1000);
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
