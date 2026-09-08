(() => {
  "use strict";

  const offerModal = document.getElementById("offerModal");
  const checkoutModal = document.getElementById("checkoutModal");
  const storePreviewModal = document.getElementById("storePreviewModal");
  const checkoutForm = document.getElementById("checkoutForm");
  const formStatus = document.getElementById("formStatus");
  const offerType = document.getElementById("offerType");
  const offerAmount = document.getElementById("offerAmount");
  const checkoutKicker = document.getElementById("checkoutKicker");
  const checkoutTitle = document.getElementById("checkoutModalTitle");
  const checkoutIntro = document.getElementById("checkoutIntro");
  const checkoutSubmit = document.getElementById("checkoutSubmit");
  const productPrompt = document.getElementById("productPrompt");
  const phoneInput = document.getElementById("phoneInput");
  const phoneHint = document.getElementById("phoneHint");
  const storePreviewTitle = document.getElementById("storePreviewTitle");
  const storePreviewDescription = document.getElementById("storePreviewDescription");
  const storePreviewImage = document.getElementById("storePreviewImage");
  const storePreviewLive = document.getElementById("storePreviewLive");
  const storeCards = [...document.querySelectorAll("[data-store-preview]")];
  const storePrevButton = document.querySelector("[data-store-prev]");
  const storeNextButton = document.querySelector("[data-store-next]");
  const storePageStatus = document.querySelector("[data-store-carousel-status]");
  let storePage = 0;
  let lastTrigger = null;

  const isMobileStoreCarousel = () => window.matchMedia("(max-width: 810px)").matches;
  const renderStorePage = () => {
    const mobile = isMobileStoreCarousel();
    const pageCount = Math.max(1, Math.ceil(storeCards.length / 2));
    storePage = Math.min(storePage, pageCount - 1);
    storeCards.forEach((card, index) => {
      card.hidden = mobile && Math.floor(index / 2) !== storePage;
    });
    if (storePageStatus) {
      const first = storePage * 2 + 1;
      const last = Math.min(first + 1, storeCards.length);
      storePageStatus.textContent = mobile ? `STORES ${first}–${last} OF ${storeCards.length}` : "";
    }
    if (storePrevButton) {
      storePrevButton.hidden = !mobile;
      storePrevButton.disabled = !mobile || storePage <= 0;
    }
    if (storeNextButton) {
      storeNextButton.hidden = !mobile;
      storeNextButton.disabled = !mobile || storePage >= pageCount - 1;
    }
  };
  let isSubmitting = false;

  const setModal = (modal, open) => {
    if (!modal) return;
    modal.hidden = !open;
    document.body.classList.toggle("modal-open", open);
    if (open) {
      const focusable = modal.querySelector("input, button, textarea");
      window.setTimeout(() => focusable?.focus(), 30);
    } else if (lastTrigger && typeof lastTrigger.focus === "function") {
      lastTrigger.focus();
    }
  };

  const closeAll = () => {
    setModal(offerModal, false);
    setModal(checkoutModal, false);
    setModal(storePreviewModal, false);
  };

  const resetStatus = () => {
    if (!formStatus) return;
    formStatus.textContent = "";
    formStatus.className = "form-status";
  };

  const openOffer = (trigger) => {
    lastTrigger = trigger || document.activeElement;
    resetStatus();
    setModal(checkoutModal, false);
    setModal(storePreviewModal, false);
    setModal(offerModal, true);
    window.StoreLaunchTracking?.track?.("view_offer_options");
  };

  const openStorePreview = (trigger) => {
    lastTrigger = trigger || document.activeElement;
    const data = trigger?.dataset || {};
    if (storePreviewTitle) storePreviewTitle.textContent = data.storeName || "Store preview";
    if (storePreviewDescription) {
      storePreviewDescription.textContent = data.storeDescription || "Scroll the full-page capture to see the complete structure.";
    }
    if (storePreviewImage) {
      storePreviewImage.src = data.snapshot || "";
      storePreviewImage.alt = `Full-page portrait preview of ${data.storeName || "the store"}`;
    }
    if (storePreviewLive) {
      storePreviewLive.href = data.storeUrl || "#";
      storePreviewLive.hidden = !data.storeUrl;
    }
    resetStatus();
    setModal(offerModal, false);
    setModal(checkoutModal, false);
    setModal(storePreviewModal, true);
    window.StoreLaunchTracking?.track?.("view_store_preview", { store: data.storeName || "unknown" });
  };

  const openCheckout = (type, trigger) => {
    lastTrigger = trigger || document.activeElement;
    resetStatus();
    setModal(offerModal, false);
    setModal(storePreviewModal, false);
    if (offerType) offerType.value = type;

    const isDiy = type === "diy";
    if (phoneInput) phoneInput.required = !isDiy;
    if (phoneHint) phoneHint.textContent = isDiy ? "(optional)" : "(required)";

    if (isDiy) {
      if (offerAmount) offerAmount.value = "20000";
      if (checkoutKicker) checkoutKicker.textContent = "DIY KIT · ₦20,000";
      if (checkoutTitle) checkoutTitle.textContent = "Put the store system in your hands.";
      if (checkoutIntro) checkoutIntro.textContent = "Enter your details and we will take you to secure payment. Your download and setup instructions come next.";
      if (checkoutSubmit) checkoutSubmit.innerHTML = "CONTINUE TO SECURE PAYMENT <span aria-hidden=\"true\">→</span>";
      if (productPrompt) productPrompt.hidden = true;
      const product = checkoutForm?.elements.product;
      if (product) {
        product.required = false;
        product.value = "";
      }
    } else {
      if (offerAmount) offerAmount.value = "0";
      if (checkoutKicker) checkoutKicker.textContent = "DONE-FOR-YOU IMPLEMENTATION";
      if (checkoutTitle) checkoutTitle.textContent = "Tell us what you want the store to sell.";
      if (checkoutIntro) checkoutIntro.textContent = "Leave your details, phone number, and a short note about the product. We will follow up with the best route for your build.";
      if (checkoutSubmit) checkoutSubmit.innerHTML = "REQUEST A BUILD CONVERSATION <span aria-hidden=\"true\">→</span>";
      if (productPrompt) productPrompt.hidden = false;
      const product = checkoutForm?.elements.product;
      if (product) product.required = true;
    }

    setModal(checkoutModal, true);
    window.StoreLaunchTracking?.track?.("begin_offer_checkout", { offerType: type });
  };

  document.querySelectorAll("[data-open-offer]").forEach((button) => {
    button.addEventListener("click", () => openOffer(button));
  });

  document.querySelectorAll("[data-scroll-offer]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      openOffer(button);
    });
  });

  storeCards.forEach((button) => {
    button.addEventListener("click", () => openStorePreview(button));
  });

  storePrevButton?.addEventListener("click", () => {
    if (!isMobileStoreCarousel()) return;
    storePage = Math.max(storePage - 1, 0);
    renderStorePage();
    window.StoreLaunchTracking?.track?.("view_store_preview_page", { page: storePage + 1 });
  });

  storeNextButton?.addEventListener("click", () => {
    if (!isMobileStoreCarousel()) return;
    const pageCount = Math.max(1, Math.ceil(storeCards.length / 2));
    storePage = Math.min(storePage + 1, pageCount - 1);
    renderStorePage();
    window.StoreLaunchTracking?.track?.("view_store_preview_page", { page: storePage + 1 });
  });

  window.addEventListener("resize", renderStorePage, { passive: true });
  renderStorePage();

  document.querySelectorAll("[data-select-offer]").forEach((button) => {
    button.addEventListener("click", () => openCheckout(button.dataset.selectOffer, button));
  });

  document.querySelectorAll("[data-close-modal]").forEach((button) => {
    button.addEventListener("click", closeAll);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeAll();
  });

  checkoutForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (isSubmitting) return;
    resetStatus();

    const data = new FormData(checkoutForm);
    const type = String(data.get("offerType") || "diy");
    const name = String(data.get("name") || "").trim();
    const email = String(data.get("email") || "").trim();
    const phone = String(data.get("phone") || "").trim();
    const product = String(data.get("product") || "").trim();

    if (!name || !email) {
      formStatus.textContent = "Please enter your name and email so we know where to send the next step.";
      formStatus.classList.add("is-error");
      return;
    }
    if (type === "dfy" && !phone) {
      formStatus.textContent = "Please enter your phone number so we can contact you about the build.";
      formStatus.classList.add("is-error");
      return;
    }
    if (phone && !/^[0-9+\-().\\s]{7,30}$/.test(phone)) {
      formStatus.textContent = "Please enter a valid phone number.";
      formStatus.classList.add("is-error");
      return;
    }
    if (type === "dfy" && !product) {
      formStatus.textContent = "Tell us briefly what you want the store to sell.";
      formStatus.classList.add("is-error");
      return;
    }

    isSubmitting = true;
    const originalText = checkoutSubmit.innerHTML;
    checkoutSubmit.disabled = true;
    checkoutSubmit.setAttribute("aria-busy", "true");
    checkoutSubmit.textContent = type === "diy" ? "OPENING SECURE CHECKOUT…" : "SENDING YOUR REQUEST…";

    try {
      const leadResponse = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name,
          email,
          phone,
          product: type === "diy" ? "StoreLaunch DIY Kit" : product,
          offerType: type,
          pageEnterAt: Date.now()
        })
      });
      const leadResult = await leadResponse.json().catch(() => ({}));
      if (!leadResponse.ok || !leadResult.ok) {
        throw new Error(leadResult.message || leadResult.error || "We could not save your details yet. Please try again.");
      }

      if (type === "diy") {
        const paymentResponse = await fetch("/api/initiate-payment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            name,
            email,
            phone,
            signupId: leadResult.signupId || undefined,
            amount: Number(data.get("amount") || 20000),
            paymentMode: "multiple",
            offerType: "diy",
            orderData: { offerType: "diy", product: "StoreLaunch DIY Kit" }
          })
        });
        const paymentResult = await paymentResponse.json().catch(() => ({}));
        if (!paymentResponse.ok || (!paymentResult.access_code && !paymentResult.authorization_url)) {
          throw new Error(paymentResult.message || paymentResult.error || "Secure payment could not be opened yet. Please try again.");
        }
        window.StoreLaunchTracking?.track?.("begin_payment", { offerType: type, value: Number(data.get("amount") || 20000), currency: "NGN" });
        if (paymentResult.access_code && typeof window.PaystackPop === "function") {
          // The server initializes the transaction with the secret key. Resume that
          // transaction in Paystack's inline popup so the customer stays on this page.
          const popup = new window.PaystackPop();
          popup.resumeTransaction(paymentResult.access_code);
        } else if (paymentResult.authorization_url) {
          // Safe fallback for a blocked/missing popup script.
          window.location.assign(paymentResult.authorization_url);
        } else {
          throw new Error("Secure payment could not be opened yet. Please try again.");
        }
        return;
      }

      formStatus.textContent = "Thanks — your request is in. We will be in touch with the next step.";
      formStatus.classList.add("is-success");
      checkoutSubmit.textContent = "REQUEST RECEIVED ✓";
      window.StoreLaunchTracking?.track?.("dfy_lead", { offerType: type });
    } catch (error) {
      formStatus.textContent = error.message || "Something went wrong. Please try again.";
      formStatus.classList.add("is-error");
      checkoutSubmit.innerHTML = originalText;
    } finally {
      isSubmitting = false;
      checkoutSubmit.disabled = false;
      checkoutSubmit.removeAttribute("aria-busy");
    }
  });

  if ("IntersectionObserver" in window && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const observer = new IntersectionObserver((entries, instance) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          instance.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08, rootMargin: "0px 0px -35px" });
    document.querySelectorAll(".reveal").forEach((element) => observer.observe(element));
  } else {
    document.querySelectorAll(".reveal").forEach((element) => element.classList.add("is-visible"));
  }
})();
