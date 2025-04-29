export default async function stream(url, callback) {
  const response = await fetch(url);
  const reader = response.body.getReader();

  async function processChunk(value) {
    try {
      callback(value.buffer);
    } catch (error) {
      console.error("Error decoding audio data:", error);
    }
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    await processChunk(value);
  }
}
