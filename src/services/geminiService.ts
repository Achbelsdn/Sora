// src/services/geminiService.ts
// Service front-end pour appeler l'endpoint de chat (edge function Supabase ou route /api/chat)

export async function getChatResponse(message: string): Promise<string> {
  // Assure-toi que ton application a un proxy ou route qui mappe '/api/chat' vers la fonction edge
  const endpoint = (window as any).__OPENROUTER_CHAT_ENDPOINT || '/api/chat';

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Chat error ${res.status}: ${t}`);
  }
  const d = await res.json();
  if (!d.success) throw new Error(d.error || 'Error response from chat');
  return d.answer;
}