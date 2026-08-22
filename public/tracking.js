(function () {
  "use strict";

  var config = window.STORE_TRACKING_CONFIG || {};
  var query = new URLSearchParams(window.location.search);
  var reference = query.get("reference") || query.get("trxref") || query.get("transaction_id") || "";
  var status = (query.get("status") || "").toLowerCase();
  var successful = !status || ["success", "successful", "paid"].indexOf(status) !== -1;
  var currency = config.currency || "NGN";

  function numberFrom(value) {
    if (value === null || value === undefined || value === "") return null;
    var parsed = Number(String(value).replace(/[^0-9.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }

  function getAmount() {
    var fromQuery = numberFrom(query.get("amount"));
    if (fromQuery !== null) return fromQuery;

    var amountNode = document.querySelector("[data-order-amount]");
    var fromNode = amountNode ? numberFrom(amountNode.textContent) : null;
    if (fromNode !== null) return fromNode;

    var totalNode = document.querySelector("#totalPaid, [data-order-total]");
    return totalNode ? numberFrom(totalNode.textContent) : null;
  }

  function formatAmount(amount) {
    return new Intl.NumberFormat(currency === "NGN" ? "en-NG" : "en-US", {
      style: "currency",
      currency: currency,
      maximumFractionDigits: 2
    }).format(amount);
  }

  function fillOrderDetails() {
    var amount = getAmount();
    document.querySelectorAll("[data-order-reference]").forEach(function (node) {
      if (reference) node.textContent = reference;
    });
    document.querySelectorAll("[data-order-amount]").forEach(function (node) {
      if (amount !== null) node.textContent = formatAmount(amount);
    });
    return amount;
  }

  function once(key) {
    try {
      if (sessionStorage.getItem(key)) return false;
      sessionStorage.setItem(key, "1");
    } catch (_) {}
    return true;
  }

  function fireMetaPurchase(amount) {
    if (!successful || !reference || amount === null || typeof window.fbq !== "function") return;
    var key = "store_purchase_tracked:meta:" + reference;
    if (!once(key)) return;
    window.fbq("track", "Purchase", {
      value: amount,
      currency: currency,
      content_name: config.productName || document.title
    });
  }

  function fireGooglePurchase(amount) {
    if (!successful || !reference || amount === null || typeof window.gtag !== "function") return;
    var key = "store_purchase_tracked:google:" + reference;
    if (!once(key)) return;
    window.gtag("event", "purchase", {
      transaction_id: reference,
      value: amount,
      currency: currency,
      items: [{ item_name: config.productName || document.title, quantity: 1 }]
    });
    if (config.googleAdsConversionId && config.googleAdsConversionLabel) {
      window.gtag("event", "conversion", {
        send_to: config.googleAdsConversionId + "/" + config.googleAdsConversionLabel,
        value: amount,
        currency: currency,
        transaction_id: reference
      });
    }
  }

  function loadMeta() {
    if (!config.metaPixelId) return;
    window.fbq = window.fbq || function () {
      window.fbq.callMethod ? window.fbq.callMethod.apply(window.fbq, arguments) : window.fbq.queue.push(arguments);
    };
    window.fbq.push = window.fbq;
    window.fbq.loaded = true;
    window.fbq.version = "2.0";
    window.fbq.queue = window.fbq.queue || [];
    window.fbq("init", config.metaPixelId);
    window.fbq("track", "PageView");
    var script = document.createElement("script");
    script.async = true;
    script.src = "https://connect.facebook.net/en_US/fbevents.js";
    script.onload = function () { fireMetaPurchase(getAmount()); };
    document.head.appendChild(script);
  }

  function loadGoogle() {
    var tagId = config.googleTagId || config.googleAdsConversionId;
    if (!tagId) return;
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
    window.gtag("js", new Date());
    window.gtag("config", tagId);
    window.gtag("event", "page_view");
    var script = document.createElement("script");
    script.async = true;
    script.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(tagId);
    script.onload = function () { fireGooglePurchase(getAmount()); };
    document.head.appendChild(script);
  }

  function boot() {
    fillOrderDetails();
    loadMeta();
    loadGoogle();

    [0, 250, 1000, 2500].forEach(function (delay) {
      window.setTimeout(function () {
        var amount = fillOrderDetails();
        fireMetaPurchase(amount);
        fireGooglePurchase(amount);
      }, delay);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();