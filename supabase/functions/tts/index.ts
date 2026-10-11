// tts: text -> base64 mp3 via ElevenLabs eleven_flash_v2_5.
const KEY = Deno.env.get('ELEVENLABS_API_KEY')!;
const VOICE = Deno.env.get('ELEVENLABS_VOICE_ID')!;
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' };

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const { text } = await req.json();
  if (!text || text.length > 300) return Response.json({ ok: false, error: 'bad text' }, { headers: cors });

  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=mp3_22050_32`, {
    method: 'POST',
    headers: { 'xi-api-key': KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ text, model_id: 'eleven_flash_v2_5', voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: 1.05 } }),
  });
  if (!r.ok) return Response.json({ ok: false, error: await r.text() }, { headers: cors });
  const buf = new Uint8Array(await r.arrayBuffer());
  let bin = ''; for (const b of buf) bin += String.fromCharCode(b);
  return Response.json({ ok: true, audio_b64: btoa(bin) }, { headers: cors });
});
