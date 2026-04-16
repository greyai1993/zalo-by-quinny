const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8618080552:AAF4SH7SpaLgEqHsLcmpc3UzlfWnfVHGyBA';
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || '-1003909331733';

export async function sendTelegramMessage(text: string): Promise<boolean> {
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: CHAT_ID,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      }
    );
    const data = await res.json();
    if (!data.ok) {
      console.error('[Telegram] Send failed:', data.description);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[Telegram] Error:', err);
    return false;
  }
}
