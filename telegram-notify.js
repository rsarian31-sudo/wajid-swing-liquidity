(function () {
  const KEY_PREFIX = "wajid_telegram_signal_key_";
  const PAIRS = ["XAU/USD"];
  const INTERVAL = () => document.getElementById("tf")?.value || "15min";

  async function checkTelegramSignal(symbol, test = false) {
    try {
      const keyName = KEY_PREFIX + symbol.replace("/", "_") + "_" + INTERVAL();
      const savedKey = localStorage.getItem(keyName) || "";
      const params = new URLSearchParams({ symbol, interval: INTERVAL() });
      if (savedKey) params.set("key", savedKey);
      if (test) params.set("test", "1");
      const response = await fetch(`/api/telegram?${params.toString()}`, { cache: "no-store" });
      const data = await response.json();
      if (data.success && data.key && data.notified) localStorage.setItem(keyName, data.key);
      return data;
    } catch (error) {
      return { success: false, error: error?.message || "Notification check failed" };
    }
  }

  window.WajidTelegram = { check: checkTelegramSignal };
  PAIRS.forEach(p => checkTelegramSignal(p));
  setInterval(() => PAIRS.forEach(p => checkTelegramSignal(p)), 60 * 1000);
})();
