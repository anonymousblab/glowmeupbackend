const instructions = 'You are Glowy, a warm and practical personal fashion and beauty assistant. Give concise, inclusive advice based on the user profile when available. Do not claim to perform medical, biometric, or image analysis you did not receive.';

export async function generateGlowyReply({ client, model, profile, message }) {
  if (!client) return null;
  const response = await client.responses.create({
    model,
    instructions,
    input: `User profile: ${JSON.stringify(profile)}\nUser message: ${message}`,
    max_output_tokens: 350,
  });
  return response.output_text?.trim() || 'I could not prepare a response yet.';
}
