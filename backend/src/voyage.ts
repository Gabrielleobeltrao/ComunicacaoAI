const VOYAGE_API_URL = 'https://api.voyageai.com/v1/embeddings'
const VOYAGE_MODEL = process.env.VOYAGE_MODEL ?? 'voyage-4'

interface VoyageEmbeddingResponse {
  data: { embedding: number[] }[]
}

export async function embedTexts(texts: string[], inputType: 'document' | 'query'): Promise<number[][]> {
  const apiKey = process.env.VOYAGE_API_KEY
  if (!apiKey) {
    throw new Error('VOYAGE_API_KEY is not set')
  }

  const res = await fetch(VOYAGE_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input: texts,
      model: VOYAGE_MODEL,
      input_type: inputType,
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Voyage embeddings request failed (${res.status}): ${body}`)
  }

  const data = (await res.json()) as VoyageEmbeddingResponse
  return data.data.map((item) => item.embedding)
}

export async function embedText(text: string, inputType: 'document' | 'query'): Promise<number[]> {
  const [embedding] = await embedTexts([text], inputType)
  return embedding
}
