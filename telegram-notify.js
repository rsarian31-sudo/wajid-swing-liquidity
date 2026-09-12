(function () {
  const KEY = "wajid_telegram_signal_key";
  const INTERVAL = () => document.getElementById("tf")?.value || "15min";

  async function checkTelegramSignal(test = false) {
    try {
      const savedKey = localStorage.getItem(KEY) || "";
      const params = new URLSearchParams({ symbol: "XAU/USD", interval: INTERVAL() });
      if (savedKey) params.set("key", savedKey);
      if (test) params.set("test", "1");

      const response = await fetch(`/api/telegram?${params.toString()}`, { cache: "no-store" });
      const data = await response.json();
      if (!data.success) return data;

      if (data.key && data.notified) {
        localStorage.setItem(KEY, data.key);
      }
      return data;
    } catch (error) {
      return { success: false, error: error?.message || "Notification check failed" };
    }
  }

  window.WajidTelegram = { check: checkTelegramSignal };

  // Background-friendly polling while the site is open. Telegram itself delivers
  // the phone notification, so browser notification permission is not required.
  checkTelegramSignal();
  setInterval(() => checkTelegramSignal(), 60 * 1000);
})();
