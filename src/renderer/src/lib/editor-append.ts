import type { BlockNoteEditor, PartialBlock } from '@blocknote/core'

function isEmptyBlock(block: { content?: unknown }): boolean {
  return Array.isArray(block.content) && block.content.length === 0
}

/**
 * Appends one transcript segment as its own paragraph block.
 *
 * A fresh BlockNote document already contains one empty paragraph. Inserting after
 * it would leave a blank line at the top, so the first segment replaces it instead.
 */
export function appendTranscript(editor: BlockNoteEditor, text: string): void {
  const document = editor.document
  const lastBlock = document[document.length - 1]
  if (!lastBlock) return

  const paragraph: PartialBlock = { type: 'paragraph', content: text }

  if (isEmptyBlock(lastBlock)) {
    editor.replaceBlocks([lastBlock], [paragraph])
  } else {
    editor.insertBlocks([paragraph], lastBlock, 'after')
  }
}
