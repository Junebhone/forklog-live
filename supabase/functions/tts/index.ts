// tts: text -> base64 mp3 via ElevenLabs eleven_flash_v2_5. STUB_MODE=1 returns a short silent clip.
import { bytesToBase64, STUB_MODE } from '../_shared/gemini.ts';
import sample from './sample.json' with { type: 'json' };

const KEY = Deno.env.get('ELEVENLABS_API_KEY') ?? '';
const VOICE = Deno.env.get('ELEVENLABS_VOICE_ID') ?? '';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const json = (b: unknown) => Response.json(b, { headers: cors });

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const t0 = Date.now();
  try {
    const { text } = await req.json();
    if (typeof text !== 'string' || !text.trim() || text.length > 300) return json({ ok: false, error: 'bad text' });
    if (STUB_MODE) return json(sample);
    if (!KEY || !VOICE) return json({ ok: false, error: 'ELEVENLABS_API_KEY / ELEVENLABS_VOICE_ID not set' });

    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=mp3_22050_32`, {
      method: 'POST',
      headers: { 'xi-api-key': KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ text, model_id: 'eleven_flash_v2_5', voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: 1.05 } }),
    });
    if (!r.ok) return json({ ok: false, error: `elevenlabs ${r.status}: ${(await r.text()).slice(0, 200)}` });
    const audio_b64 = bytesToBase64(new Uint8Array(await r.arrayBuffer()));
    console.log(`tts eleven_flash_v2_5 ${Date.now() - t0}ms ${text.length}ch`);
    return json({ ok: true, audio_b64 });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message });
  }
});
