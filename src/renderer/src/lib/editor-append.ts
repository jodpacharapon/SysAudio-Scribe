import type { Block, BlockNoteEditor, PartialBlock } from '@blocknote/core'

function isEmptyBlock(block: { content?: unknown }): boolean {
  return Array.isArray(block.content) && block.content.length === 0
}

/** Flattens a block's inline content down to plain text. */
function blockText(block: Block): string {
  if (!('content' in block) || !Array.isArray(block.content)) return ''
  return block.content.map((inline) => ('text' in inline ? String(inline.text) : '')).join('')
}

/**
 * Appends one transcript segment as its own paragraph block.
 *
 * A fresh BlockNote document already contains one empty paragraph. Inserting after
 * it would leave a blank line at the top, so the first segment replaces it instead.
 *
 * Returns the new block's id so the caller can find this paragraph again later —
 * the polish pass rewrites exactly the blocks it transcribed, and nothing else
 * the user may have typed around them.
 */
export function appendTranscript(editor: BlockNoteEditor, text: string): string | null {
  if (!text.trim()) return null

  const document = editor.document
  const lastBlock = document[document.length - 1]
  if (!lastBlock) return null

  const paragraph: PartialBlock = { type: 'paragraph', content: text }

  if (isEmptyBlock(lastBlock)) {
    const result = editor.replaceBlocks([lastBlock], [paragraph])
    return result.insertedBlocks[0]?.id ?? null
  }

  const inserted = editor.insertBlocks([paragraph], lastBlock, 'after')
  return inserted[0]?.id ?? null
}

/** Current text of the given blocks, in document order, one line each. */
export function readBlocks(editor: BlockNoteEditor, blockIds: readonly string[]): string {
  const wanted = new Set(blockIds)
  return editor.document
    .filter((block) => wanted.has(block.id))
    .map(blockText)
    .filter((text) => text.trim().length > 0)
    .join('\n')
}

/**
 * Swaps the given blocks for the polished text.
 *
 * Returns the ids of the replacement blocks, so a second polish pass still knows
 * which part of the document belongs to the transcript.
 */
export function replaceBlocks(
  editor: BlockNoteEditor,
  blockIds: readonly string[],
  text: string
): string[] {
  const wanted = new Set(blockIds)
  const existing = editor.document.filter((block) => wanted.has(block.id))
  if (existing.length === 0) return []

  const paragraphs: PartialBlock[] = text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => ({ type: 'paragraph', content: line }))
  if (paragraphs.length === 0) return blockIds.slice()

  const result = editor.replaceBlocks(existing, paragraphs)
  return result.insertedBlocks.map((block) => block.id)
}
