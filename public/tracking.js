(() => {
  "use strict";

  let config = Object.assign({}, window.STORE_TRACKING_CONFIG || {});
  const params = new URLSearchParams(window.location.search);
  const reference = params.get("reference") || params.get("trxref") || params.get("transaction_id") || "";
  const status = (params.get("status") || "").toLowerCase();
  const successful = !status || ["success", "successful", "paid"].includes(status);
  const currency = () => config.currency || "NGN";
  const productName = () => config.productName || document.title;
  const isThankYou = /thank[-_]?you/i.test(window.location.pathname);
  const isAdmin = /\/admin(?:\/|$)/i.test(window.location.pathname);

  const write = (selector, value) => {
    document.querySelectorAll(selector).forEach((node) => { node.textContent = value; });
  };

  const numberFrom = (value) => {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(String(value).replace(/[^0-9.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  };

  const getAmount = () => {
    const fromQuery = numberFrom(params.get("amount"));
    if (fromQuery !== null) return fromQuery;
    const amountNode = document.querySelector("[data-order-amount]");
    const fromNode = amountNode ? numberFrom(amountNode.textContent) : null;
    if (fromNode !== null) return fromNode;
    const totalNode = document.querySelector("#totalPaid, [data-order-total]");
    return totalNode ? numberFrom(totalNode.textContent) : null;
  };

  const formatAmount = (amount) => {
    try {
      return new Intl.NumberFormat(currency() === "NGN" ? "en-NG" : "en-US", {
        style: "currency",
        currency: currency(),
        maximumFractionDigits: 2
      }).format(amount);
    } catch (_) {
      return String(amount);
    }
  };

  const once = (key) => {
    try {
      if (sessionStorage.getItem(key)) return false;
      sessionStorage.setItem(key, "1");
    } catch (_) {}
    return true;
  };

  const id = () => window.crypto && window.crypto.randomUUID
    ? window.crypto.randomUUID()
    : "store-" + Date.now() + "-" + Math.random().toString(36).slice(2);

  const loadScript = (src, elementId) => {
    if (document.getElementById(elementId)) return;
    const script = document.createElement("script");
    script.id = elementId;
    script.async = true;
    script.src = src;
    document.head.appendChild(script);
  };

  const mergeRemoteConfig = (remote) => {
    Object.entries(remote || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && String(value).trim() !== "") config[key] = value;
    });
  };

  const sendCapi = (eventName, eventId, payload = {}) => {
    if (!config.metaPixelId || !eventName) return;
    fetch("/api/meta-conversion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      keepalive: true,
      body: JSON.stringify({
        eventName,
        eventId,
        eventSourceUrl: window.location.href,
        value: Number(payload.value || 0),
        currency: payload.currency || currency(),
        userData: payload.userData || {},
        customData: payload.customData || {}
      })
    }).catch(() => {});
  };

  const readCheckoutIdentity = (form) => ({
    email: form.querySelector('input[type="email"], input[name*="email" i]')?.value?.trim() || "",
    phone: form.querySelector('input[type="tel"], input[name*="phone" i], input[name*="mobile" i]')?.value?.trim() || ""
  });

  const attachCheckoutTracking = () => {
    if (isThankYou || isAdmin) return;
    document.querySelectorAll("form").forEach((form) => {
      if (!form.querySelector('input[type="email"], input[name*="email" i]')) return;
      form.addEventListener("submit", () => {
        const identity = readCheckoutIdentity(form);
        const eventId = id();
        const payload = {
          value: numberFrom(form.querySelector('input[name*="amount" i]')?.value) || 0,
          userData: identity,
          customData: { content_name: productName(), content_type: "product" }
        };
        sendCapi("InitiateCheckout", eventId, payload);
        if (typeof window.fbq === "function" && config.metaPixelId) {
          window.fbq("track", "InitiateCheckout", { value: payload.value, currency: currency(), content_name: productName() }, { eventID: eventId });
        }
        if (typeof window.gtag === "function") {
          window.gtag("event", "begin_checkout", { value: payload.value, currency: currency(), event_id: eventId });
        }
      }, { passive: true });
    });
  };

  const boot = (remoteConfig) => {
    mergeRemoteConfig(remoteConfig);
    const amount = getAmount();

    if (isThankYou) {
      write("[data-order-reference]", reference || "Payment confirmed");
      if (amount !== null) write("[data-order-amount]", formatAmount(amount));
    }

    if (config.metaPixelId) {
      window.fbq = window.fbq || function () {
        window.fbq.callMethod
          ? window.fbq.callMethod.apply(window.fbq, arguments)
          : window.fbq.queue.push(arguments);
      };
      window.fbq.push = window.fbq;
      window.fbq.loaded = true;
      window.fbq.version = "2.0";
      window.fbq.queue = window.fbq.queue || [];
      window.fbq("init", config.metaPixelId);
      loadScript("https://connect.facebook.net/en_US/fbevents.js", "meta-pixel-script");

      if (isThankYou && successful && reference && amount !== null) {
        const eventId = reference;
        if (once("store_purchase_tracked:meta:" + reference)) {
          window.fbq("track", "Purchase", {
            value: amount,
            currency: currency(),
            content_name: productName(),
            content_type: "product"
          }, { eventID: eventId });
        }
        if (once("store_purchase_tracked:capi:" + reference)) {
          sendCapi("Purchase", eventId, {
            value: amount,
            customData: { content_name: productName(), content_type: "product" }
          });
        }
      } else if (!isAdmin && once("store_view_tracked:" + window.location.pathname)) {
        const viewId = id();
        window.fbq("track", "ViewContent", { content_name: productName(), content_type: "product" }, { eventID: viewId });
        sendCapi("ViewContent", viewId, {
          customData: { content_name: productName(), content_type: "product" }
        });
      }
    }

    const googleIds = [config.googleTagId, config.googleAdsConversionId].filter(Boolean);
    if (googleIds.length) {
      window.dataLayer = window.dataLayer || [];
      window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
      window.gtag("js", new Date());
      googleIds.forEach((trackingId) => window.gtag("config", trackingId));
      window.gtag("event", "page_view");
      loadScript("https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(googleIds[0]), "google-tag-script");

      if (isThankYou && successful && reference && amount !== null && once("store_purchase_tracked:google:" + reference)) {
        window.gtag("event", "purchase", {
          transaction_id: reference,
          value: amount,
          currency: currency(),
          items: [{ item_name: productName(), quantity: 1 }]
        });
        if (config.googleAdsConversionId && config.googleAdsConversionLabel) {
          window.gtag("event", "conversion", {
            send_to: config.googleAdsConversionId + "/" + config.googleAdsConversionLabel,
            transaction_id: reference,
            value: amount,
            currency: currency()
          });
        }
      }
    }

    attachCheckoutTracking();
  };

  fetch("/api/tracking-config", { credentials: "same-origin" })
    .then((response) => response.ok ? response.json() : {})
    .then(boot)
    .catch(() => boot({}));
})();
