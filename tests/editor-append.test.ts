import { describe, expect, test } from 'vitest'
import type { BlockNoteEditor } from '@blocknote/core'
import { appendTranscript, readBlocks, replaceBlocks } from '../src/renderer/src/lib/editor-append'

interface FakeBlock {
  id: string
  type: string
  content: { type: 'text'; text: string }[]
}

function block(id: string, text: string): FakeBlock {
  return { id, type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }
}

/**
 * Stands in for BlockNote's editor.
 *
 * Only the three document operations the module touches are modelled; using the
 * real editor would mean booting ProseMirror against a DOM for no extra signal.
 */
function fakeEditor(initial: FakeBlock[]): BlockNoteEditor {
  let nextId = 100
  const editor = {
    document: [...initial],
    replaceBlocks(remove: FakeBlock[], insert: { content: string }[]) {
      const inserted = insert.map((paragraph) => block(`b${(nextId += 1)}`, paragraph.content))
      const at = editor.document.findIndex((candidate) => candidate.id === remove[0]?.id)
      const removeIds = new Set(remove.map((candidate) => candidate.id))
      const kept = editor.document.filter((candidate) => !removeIds.has(candidate.id))
      kept.splice(at < 0 ? kept.length : at, 0, ...inserted)
      editor.document = kept
      return { insertedBlocks: inserted, removedBlocks: remove }
    },
    insertBlocks(insert: { content: string }[], reference: FakeBlock, placement: string) {
      const inserted = insert.map((paragraph) => block(`b${(nextId += 1)}`, paragraph.content))
      const at = editor.document.findIndex((candidate) => candidate.id === reference.id)
      editor.document.splice(placement === 'after' ? at + 1 : at, 0, ...inserted)
      return inserted
    }
  }
  return editor as unknown as BlockNoteEditor
}

/** Reads the fake document back in its own shape, not BlockNote's generic one. */
function docOf(editor: BlockNoteEditor): FakeBlock[] {
  return editor.document as unknown as FakeBlock[]
}

/** The plain text of each block, in order. */
function textsOf(editor: BlockNoteEditor): (string | undefined)[] {
  return docOf(editor).map((block) => block.content[0]?.text)
}

describe('appendTranscript', () => {
  test('replaces the empty paragraph a fresh document starts with', () => {
    // Otherwise every transcript would open with a blank line.
    const editor = fakeEditor([block('b1', '')])

    appendTranscript(editor, 'first segment')

    expect(docOf(editor)).toHaveLength(1)
    expect(textsOf(editor)[0]).toBe('first segment')
  })

  test('appends after existing content instead of replacing it', () => {
    const editor = fakeEditor([block('b1', 'existing note')])

    appendTranscript(editor, 'new segment')

    expect(textsOf(editor)).toEqual(['existing note', 'new segment'])
  })

  test('returns the id of the block it created', () => {
    const editor = fakeEditor([block('b1', 'existing')])

    const id = appendTranscript(editor, 'segment')

    expect(docOf(editor).some((block) => block.id === id)).toBe(true)
  })

  test('ignores whitespace-only text', () => {
    const editor = fakeEditor([block('b1', 'existing')])

    expect(appendTranscript(editor, '   ')).toBeNull()
    expect(docOf(editor)).toHaveLength(1)
  })

  test('does nothing with an empty document', () => {
    const editor = fakeEditor([])

    expect(appendTranscript(editor, 'text')).toBeNull()
  })
})

describe('readBlocks', () => {
  test('reads the named blocks in document order', () => {
    const editor = fakeEditor([block('b1', 'one'), block('b2', 'two'), block('b3', 'three')])

    expect(readBlocks(editor, ['b3', 'b1'])).toBe('one\nthree')
  })

  test('ignores ids that are no longer in the document', () => {
    // The user can always delete a transcript paragraph by hand.
    const editor = fakeEditor([block('b1', 'one')])

    expect(readBlocks(editor, ['b1', 'deleted'])).toBe('one')
  })

  test('skips blocks the user has emptied', () => {
    const editor = fakeEditor([block('b1', 'one'), block('b2', '')])

    expect(readBlocks(editor, ['b1', 'b2'])).toBe('one')
  })

  test('returns an empty string when nothing matches', () => {
    expect(readBlocks(fakeEditor([block('b1', 'one')]), [])).toBe('')
  })
})

describe('replaceBlocks', () => {
  test('swaps the transcript blocks for the polished paragraphs', () => {
    const editor = fakeEditor([block('b1', 'raw one'), block('b2', 'raw two')])

    replaceBlocks(editor, ['b1', 'b2'], 'polished one\npolished two')

    expect(textsOf(editor)).toEqual(['polished one', 'polished two'])
  })

  test('leaves blocks it was not given untouched', () => {
    // The polish pass must never rewrite notes the user typed themselves.
    const editor = fakeEditor([block('b1', 'my own note'), block('b2', 'raw transcript')])

    replaceBlocks(editor, ['b2'], 'polished')

    expect(textsOf(editor)).toEqual(['my own note', 'polished'])
  })

  test('returns the ids of the replacements so a second pass still works', () => {
    const editor = fakeEditor([block('b1', 'raw')])

    const ids = replaceBlocks(editor, ['b1'], 'polished')

    expect(readBlocks(editor, ids)).toBe('polished')
  })

  test('collapses a polished result that lost a line', () => {
    const editor = fakeEditor([block('b1', 'raw one'), block('b2', 'raw two')])

    const ids = replaceBlocks(editor, ['b1', 'b2'], 'one merged sentence')

    expect(ids).toHaveLength(1)
  })

  test('keeps the original blocks when the polished text is empty', () => {
    const editor = fakeEditor([block('b1', 'raw')])

    const ids = replaceBlocks(editor, ['b1'], '   ')

    expect(ids).toEqual(['b1'])
    expect(textsOf(editor)[0]).toBe('raw')
  })

  test('does nothing when none of the ids are still present', () => {
    const editor = fakeEditor([block('b1', 'raw')])

    expect(replaceBlocks(editor, ['gone'], 'polished')).toEqual([])
    expect(textsOf(editor)[0]).toBe('raw')
  })
})
