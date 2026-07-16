import { PDFParse } from 'pdf-parse'
import { transcribeImage } from './llm.js'
import type { Provider } from './llm.js'

const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])

export async function extractTextFromFile(
  buffer: Buffer,
  mimeType: string,
  provider: Provider | null | undefined,
  apiKey?: string | null,
): Promise<string> {
  if (mimeType === 'text/plain') {
    return buffer.toString('utf-8')
  }

  if (mimeType === 'application/pdf') {
    const parser = new PDFParse({ data: buffer })
    const result = await parser.getText()
    return result.text
  }

  if (SUPPORTED_IMAGE_TYPES.has(mimeType)) {
    return transcribeImage(buffer.toString('base64'), mimeType, provider, apiKey)
  }

  throw new Error(`Unsupported file type: ${mimeType}`)
}
