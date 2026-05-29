// Thank You Page Logic - Display Order Details
(function(){
  function init(){
    console.log('[thankyou-order] init');
    
    // Get order data from URL params or sessionStorage
    const params = new URLSearchParams(window.location.search);
    const reference = params.get('reference');
    
    // --- Telegram invite link integration ---
    const telegramLink = params.get('telegram');
    
    if (telegramLink) {
      const telegramSection = document.getElementById('telegramSection');
      const telegramBtn = document.getElementById('telegramBtn');
      const telegramFallback = document.getElementById('telegramFallback');
    
      if (telegramSection && telegramBtn) {
        telegramBtn.href = telegramLink;
        telegramSection.classList.remove('hidden');
    
        if (telegramFallback) {
          telegramFallback.classList.add('hidden');
        }
      }
    } else {
      const telegramFallback = document.getElementById('telegramFallback');
    
      if (telegramFallback) {
        telegramFallback.classList.remove('hidden');
      }
    }
    // --- end telegram invite link integration ---

    
    // Try to get order data from sessionStorage
    let orderData = sessionStorage.getItem('orderData');
    
    if(orderData){
      orderData = JSON.parse(orderData);
      displayOrderDetails(orderData, reference);
      
      // Clear sessionStorage after displaying
      sessionStorage.removeItem('orderData');
    } else {
      // If no order data in storage, try to fetch from server using reference
      if(reference){
        fetchOrderDetails(reference);
      } else {
        // Show default/generic confirmation
        displayDefaultConfirmation();
      }
    }
  }

  function displayOrderDetails(order, reference){
    // Order Number
    const orderNumber = reference || generateOrderNumber();
    const orderNumberEl = document.getElementById('orderNumber');
    if(orderNumberEl) orderNumberEl.textContent = '#' + orderNumber;
    
    // Order Date
    const orderDateEl = document.getElementById('orderDate');
    if(orderDateEl){
      const now = new Date();
      orderDateEl.textContent = now.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    }
    
    // Customer Email
    const emailEl = document.getElementById('customerEmail');
    if(emailEl && order.email){
      emailEl.textContent = order.email;
    }
    
    // Order Items
    const orderItemsEl = document.getElementById('orderItems');
    if(orderItemsEl){
      let itemsHTML = '';
      let total = 0;
      
      // Base product
      itemsHTML += `
        <div class="order-item">
          <span>✅ 10 High-Converting Funnel Templates</span>
          <span style="font-weight:600">$${formatUSD(order.basePrice || 97)}</span>
        </div>
      `;
      total += parseFloat(order.basePrice) || 97;
      
      // Upsells from initial modal
      if(order.upsells && order.upsells.length > 0){
        order.upsells.forEach(upsell => {
          itemsHTML += `
            <div class="order-item">
              <span>✅ ${upsell.name}</span>
              <span style="font-weight:600">$${formatUSD(upsell.price)}</span>
            </div>
          `;
          total += parseFloat(upsell.price);
        });
      }
      
      // VSL Upsell
      if(order.vslUpsell){
        itemsHTML += `
          <div class="order-item">
            <span>✅ ${order.vslUpsell.name}</span>
            <span style="font-weight:600">$${formatUSD(order.vslUpsell.price)}</span>
          </div>
        `;
        total += parseFloat(order.vslUpsell.price);
      }
      
      orderItemsEl.innerHTML = itemsHTML;
      
      // Total
      const totalEl = document.getElementById('totalPaid');
      if(totalEl){
        totalEl.textContent = '$' + formatUSD(total);
      }
    }
  }

  function displayDefaultConfirmation(){
    const orderNumberEl = document.getElementById('orderNumber');
    if(orderNumberEl) orderNumberEl.textContent = '#' + generateOrderNumber();
    
    const orderDateEl = document.getElementById('orderDate');
    if(orderDateEl){
      const now = new Date();
      orderDateEl.textContent = now.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    }
    
    const orderItemsEl = document.getElementById('orderItems');
    if(orderItemsEl){
      orderItemsEl.innerHTML = `
        <div class="order-item">
          <span>Freedom Trader's Starter Kit</span>
          <span style="font-weight:600">$49.00</span>
        </div>
      `;
    }
    
    const totalEl = document.getElementById('totalPaid');
    if(totalEl){
      totalEl.textContent = '$49.00';
    }
  }

  async function fetchOrderDetails(reference){
    try {
      const resp = await fetch(`/api/order-details?reference=${encodeURIComponent(reference)}`, {
        credentials: 'include'
      });
      
      if(resp.ok){
        const data = await resp.json();
        if(data.order){
          displayOrderDetails(data.order, reference);
          return;
        }
      }
    } catch(err){
      console.error('[thankyou-order] Error fetching order:', err);
    }
    
    // Fallback to default
    displayDefaultConfirmation();
  }

  function generateOrderNumber(){
    const timestamp = Date.now().toString().slice(-6);
    const random = Math.random().toString(36).substr(2, 4).toUpperCase();
    return `ORD-${timestamp}${random}`;
  }

  function formatUSD(amount){
    return parseFloat(amount).toFixed(2);
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
