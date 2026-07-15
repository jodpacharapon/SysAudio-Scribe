import { useEffect } from 'react'
import { BlockNoteView } from '@blocknote/mantine'
import { useCreateBlockNote } from '@blocknote/react'
import type { BlockNoteEditor } from '@blocknote/core'
import type { Page } from '../../../shared/types'
import '@blocknote/core/fonts/inter.css'
import '@blocknote/mantine/style.css'

interface PageEditorProps {
  readonly page: Page
  readonly theme: 'light' | 'dark'
  readonly onUpdateTitle: (id: string, title: string) => void
  readonly onUpdateContent: (id: string, content: any[]) => void
  readonly onEditorReady: (editor: BlockNoteEditor | null) => void
}

export function PageEditor({
  page,
  theme,
  onUpdateTitle,
  onUpdateContent,
  onEditorReady
}: PageEditorProps): JSX.Element {
  // Re-initializes with page's content when the component mounts
  const editor = useCreateBlockNote({
    initialContent: page.content.length > 0 ? page.content : undefined
  })

  // Share the active editor instance with the parent App component
  useEffect(() => {
    onEditorReady(editor)
    return () => {
      onEditorReady(null)
    }
  }, [editor, onEditorReady])

  // Track and propagate content changes to save them to App state / local storage
  useEffect(() => {
    if (!editor) return
    const unsubscribe = editor.onChange(() => {
      onUpdateContent(page.id, editor.document)
    })
    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe()
      }
    }
  }, [editor, page.id, onUpdateContent])

  return (
    <div className="editor-surface">
      <input
        type="text"
        className="page-title-input"
        placeholder="Untitled"
        value={page.title}
        onChange={(event) => onUpdateTitle(page.id, event.target.value)}
      />
      <BlockNoteView editor={editor} theme={theme} />
    </div>
  )
}
