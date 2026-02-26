export async function getChatResponse(message: string): Promise<string> {
  try {
    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify({ message }),
      }
    );

    if (!response.ok) {
      throw new Error("Erreur Edge Function");
    }

    const data = await response.json();

    return data.reply;
  } catch (error) {
    console.error(error);
    throw error;
  }
}